/**
 * SpeechToTextEngine
 * High-performance, streaming voice transcription using browser Web Speech API.
 * Features real-time interim results, automatic silence detection, and auto-recovery.
 */

export interface STTCallbacks {
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onStateChange?: (state: 'idle' | 'listening' | 'transcribing' | 'error') => void;
  onError?: (error: string) => void;
}

export class SpeechToTextEngine {
  private recognition: any = null;
  private isListening: boolean = false;
  private silenceTimer: any = null;
  private callbacks: STTCallbacks = {};
  private currentTranscript: string = '';
  private autoRestart: boolean = false;

  constructor(callbacks: STTCallbacks = {}) {
    this.callbacks = callbacks;
    this.initRecognition();
  }

  public static isSupported(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  /**
   * Proactively triggers browser microphone permission prompt.
   * Call this BEFORE starting SpeechRecognition to avoid `not-allowed` warnings.
   * Returns guidance for permanently-blocked state so the caller can show
   * browser UI instructions instead of silently retrying getUserMedia.
   */
  public static async requestMicrophoneAccess(): Promise<{ granted: boolean; error?: string; permanentlyBlocked?: boolean }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'MediaDevices API not available (needs HTTPS / localhost).' };
    }
    // If the browser already reports a hard block, getUserMedia will never prompt —
    // tell the caller so it can show "click the lock icon" guidance with feedback.
    try {
      const prior = await SpeechToTextEngine.getMicrophonePermissionState();
      if (prior === 'denied') {
        return {
          granted: false,
          permanentlyBlocked: true,
          error: 'Microphone is blocked for this site. Click the lock/tune icon in the address bar → Site settings → Allow microphone, then click Retry.'
        };
      }
    } catch {
      // Ignore probe failures, fall through to real request
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Clean up stream tracks immediately after user grants permission
      stream.getTracks().forEach(track => track.stop());
      return { granted: true };
    } catch (err: any) {
      // Expected UX outcome (user dismissed/blocked) — don't spam console warning.
      // Caller surfaces this via micError banner with typed-input fallback.
      const name = err?.name || '';
      const isDenied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
      const isHardBlock = isDenied && (err?.message || '').toLowerCase().includes('denied by system');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        return { granted: false, error: 'No microphone was found. Please connect a microphone and click Retry.' };
      }
      return {
        granted: false,
        permanentlyBlocked: isHardBlock,
        error: isDenied
          ? 'Microphone access was denied. Click Allow when the browser prompts, or use the lock icon in the address bar → Allow microphone, then click Retry.'
          : err.message || 'Could not access microphone.'
      };
    }
  }

  /**
   * Non-intrusive permission check (no prompt). Returns 'granted' | 'denied' | 'prompt' | 'unknown'.
   */
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

  private initRecognition() {
    if (!SpeechToTextEngine.isSupported()) {
      return;
    }

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.callbacks.onStateChange?.('listening');
    };

    this.recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      const activeText = (final || interim).trim();
      if (activeText) {
        this.currentTranscript = activeText;
        this.callbacks.onInterimTranscript?.(activeText);

        // Reset silence timer on every new speech token
        this.resetSilenceTimer();
      }
    };

    this.recognition.onerror = (event: any) => {
      const errType = event?.error as string | undefined;
      // Benign / expected conditions: stay silent, keep listening if autoRestart is active.
      // Must NOT surface as warnings — avoids "STT Error: Microphone access was denied" spam
      // when the denial is already handled via requestMicrophoneAccess + micError banner.
      if (errType === 'no-speech' || errType === 'aborted') {
        return;
      }
      if (errType === 'not-allowed' || errType === 'service-not-allowed') {
        this.callbacks.onError?.('Microphone access was denied. Please allow microphone permission.');
        this.stop();
        return;
      }
      if (errType === 'audio-capture') {
        this.callbacks.onError?.('No microphone was found. Please connect a microphone and try again.');
        this.stop();
        return;
      }
      if (errType === 'network') {
        // Transient network blip for the recognition service — autoRestart will recover.
        return;
      }
      console.warn("Speech recognition event error:", errType);
    };

    this.recognition.onend = () => {
      if (this.autoRestart && this.isListening) {
        try {
          this.recognition.start();
        } catch {
          // Ignored if already started
        }
      } else {
        this.isListening = false;
        this.callbacks.onStateChange?.('idle');
      }
    };
  }

  private resetSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    // After 1.3 seconds of silence following speech, finalize the command
    this.silenceTimer = setTimeout(() => {
      if (this.currentTranscript.trim()) {
        const final = this.currentTranscript.trim();
        this.currentTranscript = '';
        this.callbacks.onFinalTranscript?.(final);
      }
    }, 1300);
  }

  public start() {
    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) {
      this.callbacks.onError?.('Speech recognition is not supported in this browser.');
      return;
    }

    this.autoRestart = true;
    this.currentTranscript = '';
    try {
      this.recognition.start();
    } catch (e) {
      // If already started, it's fine
    }
  }

  public stop() {
    this.autoRestart = false;
    this.isListening = false;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }
    this.callbacks.onStateChange?.('idle');
  }

  public cancel() {
    this.autoRestart = false;
    this.isListening = false;
    this.currentTranscript = '';
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
    }
    this.callbacks.onStateChange?.('idle');
  }
}
