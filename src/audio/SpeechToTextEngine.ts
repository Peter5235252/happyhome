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
   * Proactively triggers browser microphone permission prompt
   */
  public static async requestMicrophoneAccess(): Promise<{ granted: boolean; error?: string }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'MediaDevices API not available in this environment.' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Clean up stream tracks immediately after user grants permission
      stream.getTracks().forEach(track => track.stop());
      return { granted: true };
    } catch (err: any) {
      console.warn("Microphone access request result:", err);
      const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      return { 
        granted: false, 
        error: isDenied 
          ? 'Microphone access was denied. Please allow microphone permission in your browser.' 
          : err.message || 'Could not access microphone.' 
      };
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
      console.warn("Speech recognition event error:", event.error);
      if (event.error === 'not-allowed') {
        this.callbacks.onError?.('Microphone access was denied. Please allow microphone permission.');
        this.stop();
      } else if (event.error === 'no-speech') {
        // Normal when quiet, keep listening if autoRestart is active
      }
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
