/**
 * Post-Vite-build step: stage the single-threaded ONNX Runtime Web binaries
 * next to Vite's emitted threaded (jsep) ones in dist/assets/.
 *
 * Why: onnxruntime-web picks its .mjs/.wasm pair at runtime based on the
 * environment. Threaded builds need cross-origin isolation (COOP/COEP), which
 * this app deliberately does not set (it would break Firebase/embeds), so
 * production browsers request the single-threaded pair
 * (ort-wasm-simd-threaded.mjs/.wasm). Vite only emits the threaded pair it
 * sees statically imported — without this copy, first voice use 404s and the
 * neural voice fails to load. Both pairs are lazy (fetched only when voice
 * synthesis runs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const assetsDir = path.join(repoRoot, 'dist', 'assets');
const ortDist = path.join(repoRoot, 'node_modules', 'onnxruntime-web', 'dist');

const FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

if (!fs.existsSync(assetsDir)) {
  throw new Error(`copy-ort-wasm: ${assetsDir} missing — run 'vite build' first.`);
}

for (const file of FILES) {
  const src = path.join(ortDist, file);
  if (!fs.existsSync(src)) {
    throw new Error(`copy-ort-wasm: ${src} missing — is onnxruntime-web installed?`);
  }
  const dest = path.join(assetsDir, file);
  fs.copyFileSync(src, dest);
  console.log(`copy-ort-wasm: staged ${file} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
}
