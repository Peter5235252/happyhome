import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Terminal, 
  CheckCircle2, 
  AlertTriangle, 
  Copy, 
  Check, 
  Eye, 
  Cpu, 
  Layers, 
  Sliders, 
  X,
  RefreshCw
} from 'lucide-react';
import { DebugRenderMode, PerformanceStats, RenderSettings } from '../renderer/types';
import { sound } from '../audio/soundEffects';

interface WebGPUDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: PerformanceStats | null;
  settings: RenderSettings;
  onUpdateSettings: (newSettings: Partial<RenderSettings>) => void;
}

export const WebGPUDebugModal: React.FC<WebGPUDebugModalProps> = ({
  isOpen,
  onClose,
  stats,
  settings,
  onUpdateSettings,
}) => {
  const [copied, setCopied] = useState(false);
  const diagnostics = stats?.diagnostics;

  const debugModes: { id: DebugRenderMode; label: string; desc: string }[] = [
    { id: 0, label: 'Beauty (Full PBR + GI + Godrays)', desc: 'Final composited render with ACES tone mapping' },
    { id: 1, label: 'Surface Normals', desc: 'World-space normal vectors mapped to RGB colors' },
    { id: 2, label: 'Diffuse GI Irradiance', desc: 'Indirect multi-bounce color bleeding from meadow and walls' },
    { id: 3, label: 'Volumetric Godrays Only', desc: 'Isolated Mie forward in-scattering beam accumulation' },
    { id: 4, label: 'Ambient Occlusion', desc: '5-tap contact shadow darkening in crevices and eaves' },
    { id: 5, label: 'Direct Sun & Soft Shadow', desc: 'Direct sunlight visibility factor with penumbra' },
    { id: 6, label: 'Raymarch Complexity Heatmap', desc: 'Raymarch iteration count (Blue = fast, Red = heavy)' },
  ];

  const handleCopyReport = () => {
    sound.playTap();
    const report = {
      timestamp: new Date().toISOString(),
      gpuAdapter: diagnostics?.adapterName || stats?.gpuName || 'Unknown',
      vendor: diagnostics?.vendor || 'Unknown',
      architecture: diagnostics?.architecture || 'Unknown',
      fps: stats?.fps || 0,
      frameTimeMs: stats?.frameTimeMs || 0,
      resolution: stats?.resolution ? `${stats.resolution[0]}x${stats.resolution[1]}` : 'Unknown',
      resolutionScale: settings.resolutionScale,
      debugMode: settings.debugMode,
      shaderStatus: diagnostics?.shaderStatus || 'Unknown',
      shaderErrors: diagnostics?.shaderErrors || [],
      validationErrors: diagnostics?.validationErrors || [],
      limits: diagnostics?.limits || {},
    };

    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            id="debug-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              sound.playTap();
              onClose();
            }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            id="debug-modal-container"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-neutral-950/50 text-neutral-100 border border-white/10 shadow-2xl backdrop-blur-2xl overflow-hidden z-10"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-neutral-100">
                    WebGPU Diagnostics & Debug Console
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Real-time pipeline inspection, shader validation, and render layer isolation
                  </p>
                </div>
              </div>

              <button
                id="debug-close-btn"
                onClick={() => {
                  sound.playTap();
                  onClose();
                }}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close Debug Panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {/* 1. Hardware & Pipeline Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 text-[11px] font-medium">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    GPU Adapter
                  </div>
                  <div className="font-semibold text-neutral-200 truncate" title={diagnostics?.adapterName}>
                    {diagnostics?.adapterName || 'WebGPU Device'}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {diagnostics?.vendor} · {diagnostics?.architecture}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 text-[11px] font-medium">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    Shader Pipeline
                  </div>
                  <div className="flex items-center gap-1.5 font-semibold">
                    {diagnostics?.shaderStatus === 'ok' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Compiled Ready</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                        <span className="text-rose-400">Compilation Issue</span>
                      </>
                    )}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    Native WGSL · Full-Screen Raymarch
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                  <div className="flex items-center gap-1.5 text-neutral-400 text-[11px] font-medium">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    Resolution Scale
                  </div>
                  <div className="flex items-center gap-1">
                    {[0.5, 0.75, 1.0].map((scale) => (
                      <button
                        key={scale}
                        onClick={() => {
                          sound.playTap();
                          onUpdateSettings({ resolutionScale: scale });
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                          settings.resolutionScale === scale
                            ? 'bg-neutral-100 text-neutral-900 shadow-sm'
                            : 'bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
                        }`}
                      >
                        {scale}x
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {stats?.resolution ? `${stats.resolution[0]} × ${stats.resolution[1]}` : ''}
                  </div>
                </div>
              </div>

              {/* 2. Render Layer Isolations (Debug Modes) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide text-neutral-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    Layer Isolation & Debug Buffers
                  </span>
                  <span className="text-[10px] text-neutral-500">Switch to inspect individual shading components</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {debugModes.map((mode) => {
                    const isActive = settings.debugMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        id={`debug-mode-${mode.id}`}
                        onClick={() => {
                          sound.playTap();
                          onUpdateSettings({ debugMode: mode.id });
                        }}
                        className={`text-left p-2.5 rounded-xl border transition-all ${
                          isActive
                            ? 'bg-sky-500/15 border-sky-500/40 text-neutral-100 shadow-sm'
                            : 'bg-white/[0.02] border-white/5 text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`font-medium ${isActive ? 'text-sky-300 font-semibold' : ''}`}>
                            {mode.label}
                          </span>
                          {isActive && <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-mono">Active</span>}
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-tight">{mode.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. WGSL Shader & Validation Messages Log */}
              <div className="space-y-2">
                <span className="text-xs font-semibold tracking-wide text-neutral-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-neutral-400" />
                  WebGPU Runtime & Validation Log
                </span>

                <div className="p-3 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] leading-relaxed max-h-36 overflow-y-auto space-y-1">
                  {diagnostics?.shaderErrors && diagnostics.shaderErrors.length > 0 ? (
                    diagnostics.shaderErrors.map((msg, i) => (
                      <div key={i} className="text-amber-400 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{msg}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>WGSL Shader parsed, type-checked, and compiled successfully without warnings.</span>
                    </div>
                  )}

                  {diagnostics?.validationErrors && diagnostics.validationErrors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <div className="text-rose-400 font-semibold mb-1">Uncaptured Validation Errors:</div>
                      {diagnostics.validationErrors.map((err, idx) => (
                        <div key={idx} className="text-rose-300 text-[10px]">{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-white/10 bg-white/[0.02]">
              <div className="text-[11px] text-neutral-400">
                {stats?.fps} FPS · {stats?.frameTimeMs} ms
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="debug-copy-report-btn"
                  onClick={handleCopyReport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-colors text-xs font-medium border border-white/5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied Report' : 'Copy Diagnostics'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
