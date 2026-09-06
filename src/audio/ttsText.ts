/**
 * Shared pure helpers for the neural voice pipeline (imported by both the
 * main-thread engine and kokoro.worker.ts — no DOM/Web Audio here so the
 * worker bundle stays lean and everything stays unit-testable).
 */

/** Text cleanup shared by engine pre-checks and worker input. */
export function cleanTextForSpeech(text: string): string {
  return (text || '')
    .replace(/\[\d+,\s*\d+,\s*\d+\]/g, '') // raw vector dumps like [0, 1, 2] (before brackets are stripped)
    .replace(/[*_~`#[\]()]/g, '') // markdown symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when text has any letter/number worth synthesizing (skips "...", "--"). */
export function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text || '');
}

export interface ExtractedPcm {
  data: Float32Array;
  sampleRate: number;
}

/**
 * Extract PCM from a kokoro-js/transformers RawAudio chunk in a
 * version-tolerant way.
 *
 * Root cause of the production "Cannot read properties of undefined (reading
 * 'length')": kokoro-js 1.2.1's README only ever calls `audio.save()`, so it
 * never shows the property name — but transformers.js v3 `RawAudio` stores
 * samples in `.audio`, NOT `.data`. Code reading `.data` gets `undefined`
 * and crashes on `.length` for EVERY utterance. Accept both shapes so neither
 * library version can break synthesis again.
 */
export function extractPcm(audio: unknown): ExtractedPcm | null {
  if (!audio || typeof audio !== 'object') return null;
  const a = audio as {
    audio?: unknown;
    data?: unknown;
    sampling_rate?: unknown;
    sampleRate?: unknown;
  };
  const raw = a.audio ?? a.data;
  if (!(raw instanceof Float32Array) || raw.length === 0) return null;
  const sr = a.sampling_rate ?? a.sampleRate;
  const sampleRate =
    typeof sr === 'number' && Number.isFinite(sr) && sr > 0 ? sr : 24000;
  return { data: raw, sampleRate };
}
