/**
 * SpeechToTextEngine
 * High-accuracy, low-latency voice transcription pipeline with instant acoustic barge-in/interruption:
 * 1. Low-latency MediaRecorder capture & VAD (Voice Activity Detection)
 * 2. Instant Barge-In detection via onSpeechStart (triggers when user starts talking even during AI playback)
 * 3. High-precision Gemini 3.8 Flash Audio transcription via /api/transcribe
 * 4. Instant streaming interim feedback for live on-screen text typing
 */

export interface STTCallbacks {
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onSpeechStart?: () => void;
  onAudioLevel?: (level: number) => void;
  onStateChange?: (state: 'idle' | 'listening' | 'transcribing' | 'error') => void;
  onError?: (error: string) => void;
  getApiKey?: () => string | undefined;
  /** Returns the AI's last spoken line for TTS-echo suppression. */
  getLastSpoken?: () => string | undefined;
  /** Returns true while TTS is playing (mic should ignore echo). */
  isTtsSpeaking?: () => boolean;
}

export class SpeechToTextEngine {
  private isListening: boolean = false;
  private callbacks: STTCallbacks = {};
  private currentInterim: string = '';
  private isTranscribing: boolean = false;

  // Audio Pipeline
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // Voice Activity Detection (VAD) & Barge-in / Interruption
  private hasSpokenInChunk: boolean = false;
  private silenceStartTime: number | null = null;
  private consecutiveSpeechFrames: number = 0;
  private readonly SILENCE_DURATION_MS: number = 950;
  // 0.02 ignores low-level TTS bleed + fan noise; 0.012 was so sensitive the
  // AI's own speaker output counted as "user speech" and got transcribed.
  private readonly SPEECH_RMS_THRESHOLD: number = 0.02;
  private readonly SPEECH_START_FRAMES: number = 3; // ~50ms sustained energy (rejects clicks/pops)

  // Optional Browser Live Interim Feedback
  private liveInterimRecognition: any = null;

  constructor(callbacks: STTCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public updateCallbacks(callbacks: Partial<STTCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public static isSupported(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      (typeof MediaRecorder !== 'undefined' || !!(window.AudioContext || (window as any).webkitAudioContext))
    );
  }

  public static async requestMicrophoneAccess(): Promise<{ granted: boolean; error?: string; permanentlyBlocked?: boolean }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'MediaDevices API not available (requires HTTPS or localhost).' };
    }
    try {
      const prior = await SpeechToTextEngine.getMicrophonePermissionState();
      if (prior === 'denied') {
        return {
          granted: false,
          permanentlyBlocked: true,
          error: 'Microphone is blocked for this site. Click the lock/tune icon in your address bar → Site settings → Allow microphone, then click Retry.'
        };
      }
    } catch {}

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      stream.getTracks().forEach(track => track.stop());
      return { granted: true };
    } catch (err: any) {
      const name = err?.name || '';
      const isDenied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
      const isHardBlock = isDenied && (err?.message || '').toLowerCase().includes('denied by system');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return { granted: false, error: 'No microphone was detected. Please connect a microphone and click Retry.' };
      }
      return {
        granted: false,
        permanentlyBlocked: isHardBlock,
        error: isDenied
          ? 'Microphone access was denied. Click Allow when prompted, or use the lock icon in the address bar to Allow microphone.'
          : err.message || 'Could not access microphone.'
      };
    }
  }

  public static async getMicrophonePermissionState(): Promise<string> {
    try {
      const perms: any = (navigator as any)?.permissions;
      if (!perms?.query) return 'unknown';
      const status = await perms.query({ name: 'microphone' as any });
      return status?.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    this.currentInterim = '';
    this.recordedChunks = [];
    this.hasSpokenInChunk = false;
    this.silenceStartTime = null;
    this.consecutiveSpeechFrames = 0;
    this.isListening = true;
    this.callbacks.onStateChange?.('listening');

    try {
      // 1. Acquire clean microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      this.mediaStream = stream;

      // 2. Setup Web Audio Analyser for VAD and live volume metering
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      // 256-point FFT is half the CPU of 512 and plenty for RMS VAD.
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.35;
      source.connect(this.analyser);

      // 3. Start MediaRecorder
      this.startMediaRecorder(stream);

      // 4. Start concurrent VAD audio loop
      this.startVADLoop();

      // 5. Start lightweight interim speech recognizer (for instant live typing feedback)
      this.startInterimVisualizer();

    } catch (err: any) {
      console.error("Failed to start SpeechToTextEngine:", err);
      const isDenied = (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError');
      if (isDenied) {
        this.callbacks.onError?.('Microphone access was denied. Please allow microphone permissions in your browser.');
      } else {
        this.callbacks.onError?.(err?.message || 'Could not access microphone.');
      }
      this.stop();
    }
  }

  private startMediaRecorder(stream: MediaStream): void {
    try {
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '';
          }
        }
      }

      // 32kbps mono Opus is fully intelligible for STT at half the bytes/CPU
      // of 64kbps, and keeps /api/transcribe payloads small on weak PCs.
      const options = mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined;
      const recorder = new MediaRecorder(stream, options);
      this.mediaRecorder = recorder;
      this.recordedChunks = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (this.hasSpokenInChunk && this.recordedChunks.length > 0) {
          const mime = recorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.recordedChunks, { type: mime });
          this.recordedChunks = [];
          this.hasSpokenInChunk = false;
          this.silenceStartTime = null;

          // Dispatch to Gemini 3.5 Transcribe / 3.7 Flash for high-precision transcription
          this.transcribeAudioWithGemini(audioBlob, mime);
        } else {
          this.recordedChunks = [];
          this.hasSpokenInChunk = false;
          this.silenceStartTime = null;
        }

        // If user is still listening, spin up the next recorder chunk seamlessly
        if (this.isListening && this.mediaStream && this.mediaStream.active) {
          try {
            this.startMediaRecorder(this.mediaStream);
          } catch {}
        }
      };

      // Collect data every 500ms (was 200ms): fewer Blob events + less
      // main-thread churn on low-power CPUs, still fine for 950ms VAD window.
      recorder.start(500);
    } catch (e) {
      console.warn("MediaRecorder start error:", e);
    }
  }

  private startVADLoop(): void {
    if (!this.analyser) return;

    const dataArray = new Float32Array(this.analyser.fftSize);

    const checkAudio = () => {
      if (!this.isListening || !this.analyser) return;

      this.analyser.getFloatTimeDomainData(dataArray);

      // Compute RMS volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Notify UI for dynamic audio ripples
      this.callbacks.onAudioLevel?.(Math.min(rms * 9.0, 1.0));

      const now = performance.now();

      if (rms > this.SPEECH_RMS_THRESHOLD) {
        // While the AI itself is speaking, the mic hears the speaker output.
        // Count it for barge-in metering but do NOT mark the chunk as user
        // speech — otherwise the TTS echo gets transcribed and re-injected as
        // the next user prompt (the reported self-talk hallucination loop).
        const ttsActive = this.callbacks.isTtsSpeaking?.() === true;
        this.consecutiveSpeechFrames++;
        if (this.consecutiveSpeechFrames >= this.SPEECH_START_FRAMES) {
          // Trigger instant acoustic barge-in / interruption
          this.callbacks.onSpeechStart?.();
          if (!ttsActive) {
            this.hasSpokenInChunk = true;
          }
          this.silenceStartTime = null;
        }
      } else {
        this.consecutiveSpeechFrames = 0;
        if (this.hasSpokenInChunk) {
          // User spoke earlier in this chunk, now quiet
          if (this.silenceStartTime === null) {
            this.silenceStartTime = now;
          } else if (now - this.silenceStartTime >= this.SILENCE_DURATION_MS) {
            // Silence after speech detected -> stop current chunk and transcribe
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
              try {
                this.mediaRecorder.stop();
              } catch {}
            }
          }
        }
      }

      this.animFrameId = requestAnimationFrame(checkAudio);
    };

    this.animFrameId = requestAnimationFrame(checkAudio);
  }

  private startInterimVisualizer(): void {
    try {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRec) return;

      this.liveInterimRecognition = new SpeechRec();
      this.liveInterimRecognition.continuous = true;
      this.liveInterimRecognition.interimResults = true;
      this.liveInterimRecognition.lang = 'en-US';

      this.liveInterimRecognition.onresult = (event: any) => {
        if (!this.isListening) return;
        // Ignore interim results while TTS is playing: Web Speech hears the
        // speaker and would set hasSpokenInChunk + currentInterim to the AI's
        // own words, which then become fallback "user" prompts.
        if (this.callbacks.isTtsSpeaking?.() === true) return;
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          interim += event.results[i][0].transcript;
        }
        const text = interim.trim();
        if (text) {
          this.currentInterim = text;
          // Trigger instant barge-in
          this.callbacks.onSpeechStart?.();
          this.callbacks.onInterimTranscript?.(text);
          this.hasSpokenInChunk = true;
        }
      };

      this.liveInterimRecognition.onerror = (e: any) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
      };

      this.liveInterimRecognition.start();
    } catch {}
  }

  private async transcribeAudioWithGemini(blob: Blob, mimeType: string): Promise<void> {
    // Drop sub-2KB chunks (silence/clicks) locally — avoids a network round-trip
    // and gives the generative transcriber nothing to hallucinate on.
    if (blob.size < 2000) {
      if (this.currentInterim) {
        const fallbackText = this.currentInterim;
        this.currentInterim = '';
        this.callbacks.onFinalTranscript?.(fallbackText);
      }
      return;
    }
    // Cap pathological chunks (~30s+ at 32kbps) so weak PCs never POST 25MB.
    if (blob.size > 1_500_000) {
      blob = blob.slice(0, 1_500_000, blob.type);
    }

    this.isTranscribing = true;
    this.callbacks.onStateChange?.('transcribing');

    try {
      const base64 = await this.blobToBase64(blob);
      const apiKey = this.callbacks.getApiKey?.();
      const lastSpoken = this.callbacks.getLastSpoken?.();

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64,
          mimeType: mimeType || 'audio/webm',
          apiKey,
          lastSpoken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const transcript = (data.transcript || '').trim();

      if (transcript) {
        this.currentInterim = '';
        this.callbacks.onFinalTranscript?.(transcript);
      } else if (this.currentInterim) {
        // Fallback to interim transcript if Gemini returned blank
        const fallbackText = this.currentInterim;
        this.currentInterim = '';
        this.callbacks.onFinalTranscript?.(fallbackText);
      }
    } catch (err: any) {
      console.warn("Gemini transcription failed, using interim fallback:", err);
      if (this.currentInterim) {
        const fallback = this.currentInterim;
        this.currentInterim = '';
        this.callbacks.onFinalTranscript?.(fallback);
      }
    } finally {
      this.isTranscribing = false;
      if (this.isListening) {
        this.callbacks.onStateChange?.('listening');
      }
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        resolve(res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  public stop(): void {
    this.isListening = false;
    this.hasSpokenInChunk = false;
    this.silenceStartTime = null;
    this.consecutiveSpeechFrames = 0;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.liveInterimRecognition) {
      try {
        this.liveInterimRecognition.stop();
      } catch {}
      this.liveInterimRecognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach(t => t.stop());
      } catch {}
      this.mediaStream = null;
    }

    this.callbacks.onStateChange?.('idle');
  }

  public cancel(): void {
    this.currentInterim = '';
    this.recordedChunks = [];
    this.hasSpokenInChunk = false;
    this.consecutiveSpeechFrames = 0;
    this.stop();
  }
}
