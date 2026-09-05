import React from 'react';
import { AlertTriangle, RefreshCw, Cpu, CheckCircle } from 'lucide-react';

interface Props {
  errorMessage: string;
  onRetry: () => void;
}

export const WebGPUFallbackNotice: React.FC<Props> = ({ errorMessage, onRetry }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/90 p-6 text-neutral-100 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900/80 p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4 text-amber-400">
          <AlertTriangle className="h-6 w-6 shrink-0" />
          <h2 className="text-xl font-semibold tracking-tight text-white">
            WebGPU Pipeline Required
          </h2>
        </div>

        <p className="text-sm leading-relaxed text-neutral-300 mb-4">
          This photorealistic raytracing & global illumination pipeline is built purely in native 
          <span className="font-semibold text-white"> WebGPU (WGSL)</span> with real-time volumetric godrays. 
          Per pipeline specifications, <span className="text-amber-300 font-medium">WebGL fallback is strictly disabled</span>.
        </p>

        <div className="rounded-xl border border-white/5 bg-black/40 p-4 mb-6 text-xs text-neutral-400 font-mono overflow-auto max-h-32">
          {errorMessage || 'navigator.gpu interface is undefined or GPUAdapter request failed.'}
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            How to Proceed:
          </p>
          <ul className="text-xs space-y-2 text-neutral-300">
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Use a modern WebGPU-enabled browser such as <strong>Google Chrome (v113+)</strong> or <strong>Microsoft Edge</strong>.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Ensure <strong>Hardware Acceleration</strong> is turned ON in browser settings.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>If on Linux or virtualized graphics, visit <code className="text-neutral-200 bg-white/10 px-1 py-0.5 rounded">chrome://flags/#enable-unsafe-webgpu</code>.</span>
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            id="retry-webgpu-btn"
            onClick={onRetry}
            className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 px-5 py-2.5 text-sm font-medium text-white transition duration-150 border border-white/15"
          >
            <RefreshCw className="h-4 w-4" />
            Retry WebGPU Detection
          </button>
        </div>
      </div>
    </div>
  );
};
