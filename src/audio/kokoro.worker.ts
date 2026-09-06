/**
 * Kokoro synthesis Web Worker.
 *
 * Runs the 82M-parameter ONNX model FAR AWAY from the UI thread. Inference,
 * model download, and weight parsing all happen here; the main thread only
 * receives small PCM chunks to play. This is what prevents the browser hard
 * lockup: nothing heavier than an AudioBuffer copy ever touches main-thread.
 *
 * Protocol (main -> worker):
 *   { type: 'preload' }                          warm the model early
 *   { type: 'speak', token, text, voice, speed } synthesize + stream chunks
 *   { type: 'cancel', token }                     drop everything for token
 * Protocol (worker -> main):
 *   { type: 'progress', loaded, total }           model download progress
 *   { type: 'ready' }                             model loaded
 *   { type: 'load-error', error }                 model failed to load
 *   { type: 'chunk', token, sampleRate, pcm }     pcm: Float32Array (transferred)
 *   { type: 'done', token }                       stream finished
 *   { type: 'error', token, error }               synthesis failed
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

interface WorkerScope {
  postMessage(message: any, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;

let tts: any = null;
let loadPromise: Promise<any> | null = null;
let currentToken = 0;

function post(message: any, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

async function ensureLoaded(): Promise<any> {
  if (tts) return tts;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // Bundled into this worker chunk (never parsed on the main thread).
    const { KokoroTTS } = await import('kokoro-js');
    const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8', // ~86MB, near-fp32 quality, WASM runs anywhere
      device: 'wasm',
      progress_callback: (p: any) => {
        if (p && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
          post({ type: 'progress', loaded: p.loaded, total: p.total });
        }
      },
    });
    tts = instance;
    post({ type: 'ready' });
    return instance;
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null; // allow retry
    post({ type: 'load-error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

scope.onmessage = async (event: MessageEvent) => {
  const msg = event.data || {};

  if (msg.type === 'preload') {
    try {
      await ensureLoaded();
    } catch {
      // load-error already posted; speak() will surface it on demand.
    }
    return;
  }

  if (msg.type === 'cancel') {
    if (typeof msg.token === 'number') currentToken = msg.token;
    return;
  }

  if (msg.type !== 'speak') return;

  const { token, text, voice, speed } = msg;
  currentToken = token;
  try {
    const t = await ensureLoaded();
    if (token !== currentToken) return; // cancelled during load
    const { TextSplitterStream } = await import('kokoro-js');
    const splitter = new TextSplitterStream();
    const stream = t.stream(splitter, { voice, speed });
    splitter.push(text);
    splitter.close();

    for await (const { audio } of stream) {
      if (token !== currentToken) return; // interrupted: drop chunk
      const src: Float32Array = audio.data as Float32Array;
      const copy = new Float32Array(src.length);
      copy.set(src);
      post(
        { type: 'chunk', token, sampleRate: audio.sampling_rate as number, pcm: copy },
        [copy.buffer]
      );
    }
    if (token !== currentToken) return;
    post({ type: 'done', token });
  } catch (err) {
    if (token !== currentToken) return;
    post({ type: 'error', token, error: err instanceof Error ? err.message : String(err) });
  }
};
