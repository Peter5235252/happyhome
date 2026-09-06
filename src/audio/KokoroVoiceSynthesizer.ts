/**
 * KokoroVoiceSynthesizer — free, flagship-natural neural speech synthesis.
 *
 * Replaces the browser Web Speech API entirely (no speechSynthesis anywhere).
 *
 * Engine: Kokoro-82M (hexgrad, Apache 2.0) via `kokoro-js`, running 100%
 * on-device with ONNX Runtime (WASM, q8 ~86MB, cached by the browser after
 * first download). No accounts, no API keys, no per-character billing, no
 * text ever leaves the device. Verified Sept 2026:
 * - https://www.npmjs.com/package/kokoro-js (v1.2.1)
 * - https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
 *
 * THREADING: all synthesis runs in `kokoro.worker.ts` (Web Worker). The main
 * thread only plays PCM chunks through Web Audio. Running inference on the UI
 * thread hard-locked the browser, so the worker boundary is load-bearing: no
 * model import, download parsing, or inference may ever run here.
 *
 * Interruption: sentence-streamed synthesis is played chunk-by-chunk. stop()
 * kills playback instantly, cancels the worker job, and invalidates the
 * generation token, so barge-in is immediate.
 */

export interface VoiceSynthesizerOptions {
  /** Playback speed 0.5–2.0 (Kokoro native). Default 1.0. */
  rate?: number;
  /** Accepted for interface compatibility; neural timbre is fixed per voice. */
  pitch?: number;
  /** Gain 0.0–1.0. Default 1.0. */
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export interface TtsVoiceOption {
  id: string;
  label: string;
}

/** Curated flagship English voices (kokoro-js ships 29; these are the standouts). */
export const VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: 'af_heart', label: 'Heart — warm female (flagship)' },
  { id: 'af_bella', label: 'Bella — bright female' },
  { id: 'af_sarah', label: 'Sarah — soft female' },
  { id: 'am_adam', label: 'Adam — natural male' },
  { id: 'am_michael', label: 'Michael — deep male' },
  { id: 'bf_emma', label: 'Emma — warm British female' },
];

export const DEFAULT_VOICE_ID = 'af_heart';
const VOICE_STORAGE_KEY = 'happyhome_tts_voice';

export type TtsEngineStatus = 'unloaded' | 'loading' | 'ready' | 'error';

interface PcmChunk {
  sampleRate: number;
  pcm: Float32Array;
}

/** Pure text cleanup (exported for tests). */
export function cleanTextForSpeech(text: string): string {
  return (text || '')
    .replace(/\[\d+,\s*\d+,\s*\d+\]/g, '') // raw vector dumps like [0, 1, 2] (before brackets are stripped)
    .replace(/[*_~`#[\]()]/g, '') // markdown symbols
    .replace(/\s+/g, ' ')
    .trim();
}

function loadStoredVoice(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(VOICE_STORAGE_KEY);
      if (v && VOICE_OPTIONS.some((o) => o.id === v)) return v;
    }
  } catch {}
  return DEFAULT_VOICE_ID;
}

export class KokoroVoiceSynthesizer {
  private worker: Worker | null = null;
  private status: TtsEngineStatus = 'unloaded';
  private loadError: any = null;
  private voiceId: string = loadStoredVoice();

  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private playResolvers: Set<() => void> = new Set();
  private genToken = 0;
  private isSpeaking = false;

  // Single-flight streamed playback state for the current speak().
  // waiters is a SET (not one slot): back-to-back speak() calls must wake
  // every parked loop, or a superseded loop would hang forever holding a
  // promise its caller still awaits.
  private pendingChunks: PcmChunk[] = [];
  private streamDone = false;
  private streamError: any = null;
  private waiters: Set<() => void> = new Set();
  private onProgress?: (fraction: number) => void;

  /** bytesLoaded/bytesTotal progress listener for model download UI. */
  public setProgressListener(cb?: (fraction: number) => void): void {
    this.onProgress = cb;
  }

  public getStatus(): TtsEngineStatus {
    return this.status;
  }

  public getLoadError(): any {
    return this.loadError;
  }

  public getVoice(): string {
    return this.voiceId;
  }

  public setVoice(id: string): boolean {
    if (!VOICE_OPTIONS.some((o) => o.id === id)) return false;
    this.voiceId = id;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(VOICE_STORAGE_KEY, id);
    } catch {}
    return true;
  }

  private ensureWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    if (!this.worker) {
      // Vite bundles this as a separate worker chunk (model code included),
      // so nothing heavy is ever parsed on the main thread.
      this.worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => this.handleWorkerMessage(e.data);
      this.worker.onerror = (e: ErrorEvent) => {
        console.error('Neural voice worker error:', e.message || e);
      };
    }
    return this.worker;
  }

  private handleWorkerMessage(msg: any): void {
    if (!msg) return;
    if (msg.type === 'progress') {
      if (typeof msg.loaded === 'number' && typeof msg.total === 'number' && msg.total > 0) {
        try {
          this.onProgress?.(msg.loaded / msg.total);
        } catch {}
      }
      return;
    }
    if (msg.type === 'ready') {
      this.status = 'ready';
      this.loadError = null;
      return;
    }
    if (msg.type === 'load-error') {
      this.status = 'error';
      this.loadError = msg.error;
      return;
    }
    // Stream messages carry generation tokens; stale ones are dropped.
    if (typeof msg.token !== 'number' || msg.token !== this.genToken) return;
    if (msg.type === 'chunk') {
      this.pendingChunks.push({ sampleRate: msg.sampleRate, pcm: msg.pcm as Float32Array });
      this.wakeAll();
    } else if (msg.type === 'done') {
      this.streamDone = true;
      this.wakeAll();
    } else if (msg.type === 'error') {
      this.streamError = msg.error || 'Synthesis failed in voice worker.';
      this.wakeAll();
    }
  }

  /** Start downloading/loading the model early (e.g. on voice-mode open). */
  public preload(): Promise<void> {
    const w = this.ensureWorker();
    if (!w) return Promise.resolve();
    if (this.status !== 'ready') this.status = 'loading';
    try {
      w.postMessage({ type: 'preload' });
    } catch {}
    return Promise.resolve();
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      this.audioCtx = new AC();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => undefined);
    }
    return this.audioCtx;
  }

  private playChunk(data: Float32Array, sampleRate: number, volume: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.audioCtx;
      const out = this.gainNode;
      if (!ctx || !out) {
        resolve();
        return;
      }
      try {
        const buffer = ctx.createBuffer(1, data.length, sampleRate);
        buffer.getChannelData(0).set(data);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume));
        src.connect(gain);
        gain.connect(out);
        // done() is idempotent: natural end and stop() both settle it, and
        // stop() must ALWAYS settle it or awaiting speak() calls hang forever.
        const done = () => {
          if (!this.playResolvers.has(done)) return;
          this.playResolvers.delete(done);
          this.activeSources.delete(src);
          try {
            src.disconnect();
          } catch {}
          try {
            gain.disconnect();
          } catch {}
          resolve();
        };
        this.playResolvers.add(done);
        this.activeSources.add(src);
        src.onended = done;
        src.start();
      } catch {
        resolve();
      }
    });
  }

  private waitForChunk(): Promise<void> {
    return new Promise((resolve) => {
      const w = () => {
        this.waiters.delete(w);
        resolve();
      };
      this.waiters.add(w);
    });
  }

  private wakeAll(): void {
    for (const w of [...this.waiters]) {
      try {
        w();
      } catch {}
    }
    this.waiters.clear();
  }

  /**
   * Speaks text with the neural voice. Synthesis runs in the worker; this
   * thread only plays audio. Resolves on completion, interruption, or failure
   * (failures surface via onError — there is intentionally no robotic Web
   * Speech fallback).
   */
  public speak(text: string, options: VoiceSynthesizerOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) {
        resolve();
        return;
      }
      if (typeof window === 'undefined') {
        resolve();
        return;
      }

      // Claim a fresh generation token FIRST so any parked loop sees itself
      // as stale, then tear down its playback and wake it to exit.
      const myToken = ++this.genToken;
      const alive = () => myToken === this.genToken;
      this.stopInternal();
      this.wakeAll();

      const worker = this.ensureWorker();
      if (!worker) {
        try {
          options.onError?.(new Error('Web Workers are unavailable in this browser.'));
        } catch {}
        resolve();
        return;
      }
      if (this.status !== 'ready') this.status = 'loading';

      const speed = Math.max(0.5, Math.min(2.0, options.rate ?? 1.0));
      const volume = options.volume ?? 1.0;
      this.isSpeaking = true;
      this.pendingChunks = [];
      this.streamDone = false;
      this.streamError = null;
      let started = false;
      const finishSpeaking = () => {
        if (!alive()) return;
        this.isSpeaking = false;
      };

      try {
        worker.postMessage({ type: 'speak', token: myToken, text: cleaned, voice: this.voiceId, speed });
      } catch (err) {
        this.isSpeaking = false;
        try {
          options.onError?.(err);
        } catch {}
        resolve();
        return;
      }

      if (!this.ensureAudioContext()) {
        this.isSpeaking = false;
        try {
          options.onError?.(new Error('Web Audio is unavailable in this browser.'));
        } catch {}
        resolve();
        return;
      }

      void (async () => {
        try {
          for (;;) {
            if (!alive()) return; // interrupted: drop everything
            const next = this.pendingChunks.shift();
            if (next) {
              if (!started) {
                started = true;
                this.isSpeaking = true;
                try {
                  options.onStart?.();
                } catch {}
              }
              await this.playChunk(next.pcm, next.sampleRate, volume);
              continue;
            }
            if (this.streamError) throw new Error(String(this.streamError));
            if (this.streamDone) break;
            await this.waitForChunk();
          }

          finishSpeaking();
          try {
            options.onEnd?.();
          } catch {}
        } catch (err) {
          if (!alive()) return;
          console.error('Neural voice synthesis failed:', err);
          this.isSpeaking = false;
          try {
            options.onError?.(err);
          } catch {}
        } finally {
          // Every exit path settles: interruption must never hang callers.
          resolve();
        }
      })();
    });
  }

  private stopInternal(): void {
    for (const src of this.activeSources) {
      try {
        src.onended = null;
      } catch {}
      try {
        src.stop();
      } catch {}
      try {
        src.disconnect();
      } catch {}
    }
    this.activeSources.clear();
    // Settle every pending playChunk so no awaiting speak() hangs.
    for (const done of [...this.playResolvers]) {
      try {
        done();
      } catch {}
    }
    this.playResolvers.clear();
  }

  /** Instantly stops playback, cancels the worker job, drops queued audio. */
  public stop(): void {
    this.genToken++;
    try {
      this.worker?.postMessage({ type: 'cancel', token: this.genToken });
    } catch {}
    this.stopInternal();
    this.pendingChunks = [];
    this.streamDone = true;
    this.streamError = null;
    // Wake every parked speak() loop so each exits via !alive() and settles.
    this.wakeAll();
    this.isSpeaking = false;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

/** App-wide neural voice singleton (same role the old speechSynthesis wrapper had). */
export const naturalVoice = new KokoroVoiceSynthesizer();
