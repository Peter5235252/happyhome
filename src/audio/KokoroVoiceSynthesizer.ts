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
 * Interruption: sentence-streamed synthesis (TextSplitterStream) is played
 * chunk-by-chunk through Web Audio. stop() kills all active sources instantly
 * and invalidates in-flight generation, so barge-in is immediate — the same
 * seamless-interruption contract the old engine provided.
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
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type TtsEngineStatus = 'unloaded' | 'loading' | 'ready' | 'error';

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
  private tts: any = null;
  private loadPromise: Promise<any> | null = null;
  private status: TtsEngineStatus = 'unloaded';
  private loadError: any = null;
  private voiceId: string = loadStoredVoice();

  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private playResolvers: Set<() => void> = new Set();
  private genToken = 0;
  private isSpeaking = false;
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

  /** Start downloading/loading the model early (e.g. on voice-mode open). */
  public preload(): Promise<void> {
    return this.ensureLoaded()
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async ensureLoaded(): Promise<any> {
    if (this.tts) return this.tts;
    if (this.loadPromise) return this.loadPromise;
    if (typeof window === 'undefined') {
      throw new Error('Kokoro TTS requires a browser environment.');
    }

    this.status = 'loading';
    this.loadError = null;
    this.loadPromise = (async () => {
      // Dynamic import keeps kokoro + onnxruntime out of the main bundle chunk.
      const { KokoroTTS } = await import('kokoro-js');
      const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8', // ~86MB, near-fp32 quality, runs everywhere (WASM)
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
            try {
              this.onProgress?.(p.loaded / p.total);
            } catch {}
          }
        },
      });
      this.tts = instance;
      this.status = 'ready';
      return instance;
    })();

    try {
      return await this.loadPromise;
    } catch (err) {
      this.status = 'error';
      this.loadError = err;
      this.loadPromise = null; // allow retry on next speak()
      throw err;
    }
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

  /**
   * Speaks text with the neural voice. Resolves on completion, interruption,
   * or load failure (failures surface via onError — there is intentionally no
   * robotic Web Speech fallback).
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

      // Interrupt anything in flight, then claim a fresh generation token.
      this.stopInternal();
      const myToken = ++this.genToken;
      const alive = () => myToken === this.genToken;

      const speed = Math.max(0.5, Math.min(2.0, options.rate ?? 1.0));
      const volume = options.volume ?? 1.0;
      this.isSpeaking = true;
      let started = false;
      const finishSpeaking = () => {
        if (!alive()) return;
        this.isSpeaking = false;
      };

      void (async () => {
        try {
          const tts = await this.ensureLoaded();
          if (!alive()) return; // stopped while loading
          if (!this.ensureAudioContext()) {
            throw new Error('Web Audio is unavailable in this browser.');
          }
          const { TextSplitterStream } = await import('kokoro-js');
          const splitter = new TextSplitterStream();
          const stream = tts.stream(splitter, { voice: this.voiceId, speed });
          splitter.push(cleaned);
          splitter.close();

          for await (const { audio } of stream) {
            if (!alive()) return; // interrupted mid-generation: drop chunk
            if (!started) {
              started = true;
              this.isSpeaking = true;
              try {
                options.onStart?.();
              } catch {}
            }
            await this.playChunk(audio.data as Float32Array, audio.sampling_rate as number, volume);
            if (!alive()) return;
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

  /** Instantly stops playback and discards in-flight generation (barge-in). */
  public stop(): void {
    this.genToken++;
    this.stopInternal();
    this.isSpeaking = false;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

/** App-wide neural voice singleton (same role the old speechSynthesis wrapper had). */
export const naturalVoice = new KokoroVoiceSynthesizer();
