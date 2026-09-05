import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sun, 
  Sparkles, 
  Layers, 
  Eye, 
  Sliders, 
  ChevronDown, 
  ChevronUp, 
  Info,
  Terminal,
  Volume2,
  VolumeX,
  X,
  Compass,
  Mic, 
  MicOff,
  Brain
} from 'lucide-react';
import { PerformanceStats, RenderSettings } from '../renderer/types';
import { WebGPUDebugModal } from './WebGPUDebugModal';
import { sound } from '../audio/soundEffects';

interface Props {
  settings: RenderSettings;
  stats: PerformanceStats;
  onUpdateSettings: (newSettings: Partial<RenderSettings>) => void;
  onSelectPreset: (preset: 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset') => void;
  onResetCamera: () => void;
  isVoiceActive?: boolean;
  toggleVoiceMode?: () => void;
  onOpenMemoryManager?: () => void;
}

export const MinimalUI: React.FC<Props> = ({
  settings,
  stats,
  onUpdateSettings,
  onSelectPreset,
  onResetCamera,
  isVoiceActive,
  toggleVoiceMode,
  onOpenMemoryManager,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);

  const debugModeNames: Record<number, string> = {
    1: 'Surface Normals',
    2: 'Diffuse GI Irradiance',
    3: 'Volumetric Godrays Only',
    4: 'Ambient Occlusion',
    5: 'Direct Sun & Shadows',
    6: 'Raymarch Complexity Heatmap',
  };

  const handleAudioToggle = () => {
    const nextAudio = !settings.audioEnabled;
    sound.enabled = nextAudio;
    onUpdateSettings({ audioEnabled: nextAudio });
    if (nextAudio) {
      sound.playToggle(true);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6 select-none overflow-hidden">
      {/* Top Bar: Minimalist Quick Controls */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex items-center justify-between w-full"
      >
        {/* Empty placeholder for clean spacing */}
        <div />

        {/* Top Right Quick Actions */}
        <div className="pointer-events-auto flex items-center gap-2">
          
          {/* AI Cross-Session Memory & Profile Button */}
          {onOpenMemoryManager && (
            <motion.button
              whileTap={{ scale: 0.93 }}
              id="ai-memory-manager-btn"
              onClick={() => {
                sound.playTap();
                onOpenMemoryManager();
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium backdrop-blur-xl border bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all shadow-sm"
              title="View & manage AI cross-session cloud memory"
            >
              <Brain className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">AI Memory</span>
            </motion.button>
          )}

          {/* Agent Voice Toggle */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => {
              if (toggleVoiceMode) toggleVoiceMode();
            }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur-xl border transition-all ${
              isVoiceActive
                ? 'bg-rose-500/25 border-rose-400/40 text-rose-200 shadow-md'
                : 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:bg-neutral-900/60'
            }`}
            title="Talk to Gemini Agent"
          >
            {isVoiceActive ? <Mic className="h-3.5 w-3.5 text-rose-400" /> : <MicOff className="h-3.5 w-3.5 text-neutral-400" />}
            <span className="hidden sm:inline">Voice</span>
          </motion.button>

          {/* Audio Feedback Toggle */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            id="toggle-audio-btn"
            onClick={handleAudioToggle}
            className={`flex items-center gap-1.5 rounded-full p-2 text-xs backdrop-blur-xl border transition-colors ${
              settings.audioEnabled
                ? 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:text-white hover:bg-neutral-900/60'
                : 'bg-neutral-900/30 border-white/5 text-neutral-500 hover:text-neutral-300'
            }`}
            title={settings.audioEnabled ? 'Mute synthesized sound effects' : 'Unmute sound effects'}
            aria-label="Toggle Sound Effects"
          >
            {settings.audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </motion.button>

          {/* WebGPU Diagnostics & Debug Console */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            id="toggle-debug-console-btn"
            onClick={() => {
              sound.playTap();
              setShowDebugModal(true);
            }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur-xl border transition-all ${
              settings.debugMode !== 0
                ? 'bg-sky-500/25 border-sky-400/40 text-sky-200 shadow-md'
                : 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:bg-neutral-900/60'
            }`}
            title="Open WebGPU Diagnostics & Layer Debugger"
          >
            <Terminal className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">Debug</span>
          </motion.button>

          {/* Compare with Original SVG Button */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            id="toggle-svg-compare-btn"
            onClick={() => {
              sound.playToggle(!settings.showOriginalSvg);
              onUpdateSettings({ showOriginalSvg: !settings.showOriginalSvg });
            }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium backdrop-blur-xl border transition-all ${
              settings.showOriginalSvg
                ? 'bg-amber-500/25 border-amber-400/40 text-amber-200 shadow-md'
                : 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:bg-neutral-900/60'
            }`}
            title="Toggle original 2D SVG drawing"
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Original SVG</span>
          </motion.button>

          {/* Controls Help Toggle */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            id="controls-help-btn"
            onClick={() => {
              sound.playTap();
              setShowHelp(!showHelp);
            }}
            className="rounded-full bg-neutral-950/45 p-2 text-neutral-300 backdrop-blur-xl border border-white/10 hover:bg-neutral-900/60 transition-colors"
            title="Camera & Navigation Controls Guide"
            aria-label="Help Guide"
          >
            <Info className="h-4 w-4" />
          </motion.button>
        </div>
      </motion.div>

      {/* Active Debug Mode Notice Chip */}
      <AnimatePresence>
        {settings.debugMode !== 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto self-center mt-3 flex items-center gap-3 px-4 py-1.5 rounded-full bg-sky-950/70 border border-sky-400/30 text-sky-200 text-xs backdrop-blur-xl shadow-lg"
          >
            <span className="font-medium">
              Layer Active: {debugModeNames[settings.debugMode]}
            </span>
            <button
              onClick={() => {
                sound.playTap();
                onUpdateSettings({ debugMode: 0 });
              }}
              className="text-sky-400 hover:text-white px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 font-medium text-[11px] transition-colors"
            >
              Exit Debug View
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Controls Guide Card */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            className="pointer-events-auto absolute top-16 right-6 w-72 rounded-2xl bg-neutral-950/75 p-4 text-xs text-neutral-300 backdrop-blur-2xl border border-white/10 shadow-2xl space-y-2.5 z-20"
          >
            <div className="flex items-center justify-between font-semibold text-white border-b border-white/10 pb-2">
              <span className="flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-amber-300" />
                Camera Navigation
              </span>
              <button
                onClick={() => {
                  sound.playTap();
                  setShowHelp(false);
                }}
                className="text-neutral-400 hover:text-white p-1"
                aria-label="Close Guide"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 font-mono text-[11px] text-neutral-300">
              <div className="flex justify-between">
                <span className="text-neutral-400">Left Click + Drag:</span>
                <span className="text-amber-200">Orbit View</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Right Click / Shift:</span>
                <span className="text-amber-200">Pan Target</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Scroll Wheel:</span>
                <span className="text-amber-200">Zoom In/Out</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Double Click:</span>
                <span className="text-amber-200">Reset View</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Original SVG Reference Picture-in-Picture Modal */}
      <AnimatePresence>
        {settings.showOriginalSvg && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            className="pointer-events-auto absolute top-16 left-6 w-80 sm:w-96 rounded-2xl bg-neutral-950/80 p-3.5 backdrop-blur-2xl border border-white/15 shadow-2xl z-30"
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-xs font-medium text-neutral-200">
              <span>Original 2D Vector Drawing</span>
              <button
                onClick={() => {
                  sound.playTap();
                  onUpdateSettings({ showOriginalSvg: false });
                }}
                className="text-neutral-400 hover:text-white p-1"
                aria-label="Close SVG comparison"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-sky-100">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" className="w-full h-auto block">
                <defs>
                  <linearGradient id="svg_sky_preview" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8fd3ff"/>
                    <stop offset="100%" stopColor="#dff6ff"/>
                  </linearGradient>
                  <linearGradient id="svg_grass_preview" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#72c968"/>
                    <stop offset="100%" stopColor="#3e9c4a"/>
                  </linearGradient>
                </defs>
                <rect width="1200" height="800" fill="url(#svg_sky_preview)"/>
                <circle cx="145" cy="135" r="65" fill="#ffd84d" stroke="#e5a928" strokeWidth="8"/>
                <path d="M0 440 L150 280 L250 390 L390 245 L540 410 L690 270 L820 400 L960 250 L1200 440 L1200 800 L0 800 Z" fill="#8ab6a1"/>
                <path d="M0 455 C130 420 230 455 350 438 C470 420 570 455 700 438 C850 415 950 450 1200 425 L1200 800 L0 800 Z" fill="url(#svg_grass_preview)"/>
                <rect x="405" y="350" width="385" height="275" rx="4" fill="#f7c56b" stroke="#553b2b" strokeWidth="8"/>
                <path d="M355 360 L595 160 L840 360 Z" fill="#df6659" stroke="#553b2b" strokeWidth="9"/>
                <rect x="710" y="200" width="65" height="125" fill="#ad5a4c" stroke="#553b2b" strokeWidth="7"/>
                <rect x="440" y="405" width="105" height="105" fill="#79d4f4" stroke="#553b2b" strokeWidth="7"/>
                <rect x="645" y="405" width="105" height="105" fill="#79d4f4" stroke="#553b2b" strokeWidth="7"/>
                <rect x="545" y="475" width="105" height="150" fill="#8e633f" stroke="#553b2b" strokeWidth="8"/>
                <path d="M600 625 C560 655 505 692 475 800 H720 C690 700 645 655 600 625 Z" fill="#d5b78b"/>
                <circle cx="245" cy="220" r="75" fill="#4fa94d"/>
                <text x="600" y="750" textAnchor="middle" fontFamily="sans-serif" fontSize="30" fontWeight="bold" fill="#5c3a2b">
                  MY HAPPY HOME
                </text>
              </svg>
            </div>
            <p className="text-[11px] text-neutral-400 mt-2 text-center">
              Target Reference: 2D drawing translated into full 3D photorealistic WebGPU raytracing.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Floating Control Bar (Minimalist Frosted Glass with Fluid Motion) */}
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="pointer-events-auto mx-auto w-full max-w-2xl"
      >
        <div className="rounded-2xl bg-neutral-950/50 backdrop-blur-2xl border border-white/10 shadow-2xl p-3 sm:p-4 text-xs text-neutral-200">
          {/* Main Primary Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* View Presets */}
            <div className="flex items-center gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
              {(
                [
                  { id: 'svg_perspective', label: 'SVG View' },
                  { id: 'cinematic', label: 'Cinematic' },
                  { id: 'meadow', label: 'Meadow' },
                  { id: 'sunset', label: 'Golden Sunset' },
                ] as const
              ).map((preset) => {
                const isActive = settings.cameraPreset === preset.id;
                return (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    key={preset.id}
                    id={`preset-${preset.id}-btn`}
                    onClick={() => {
                      sound.playPresetChime();
                      onSelectPreset(preset.id);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-white/15 text-white shadow-sm font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {preset.label}
                  </motion.button>
                );
              })}
            </div>

            {/* Atmosphere & Lighting Drawer Toggle */}
            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.93 }}
                id="expand-pipeline-controls-btn"
                onClick={() => {
                  sound.playTap();
                  setExpanded(!expanded);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${
                  expanded
                    ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 font-medium shadow-sm'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-neutral-300'
                }`}
                title="Adjust Atmosphere & Lighting Parameters"
                aria-label="Toggle Lighting Controls"
              >
                <Sliders className="h-3.5 w-3.5 text-amber-300" />
                <span className="font-medium text-xs">Lighting</span>
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5 text-neutral-400" />
                )}
              </motion.button>
            </div>
          </div>

          {/* Smooth Expandable Parameters Panel with AnimatePresence */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 14 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-5 pb-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
                  {/* Sun Time of Day */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-neutral-300">
                      <span className="flex items-center gap-1">
                        <Sun className="h-3 w-3 text-amber-300" /> Time of Day
                      </span>
                      <span className="font-mono text-neutral-400">
                        {Math.round(settings.timeOfDay * 24)}:00
                      </span>
                    </div>
                    <input
                      id="time-of-day-slider"
                      type="range"
                      min="0.15"
                      max="0.88"
                      step="0.01"
                      value={settings.timeOfDay}
                      onInput={(e) => sound.playSliderTick(parseFloat((e.target as HTMLInputElement).value))}
                      onChange={(e) => onUpdateSettings({ timeOfDay: parseFloat(e.target.value) })}
                      className="w-full accent-amber-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Godray Intensity */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-neutral-300">
                      <span>Godray In-Scattering</span>
                      <span className="font-mono text-neutral-400">
                        {settings.godrayIntensity.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      id="godray-intensity-slider"
                      type="range"
                      min="0.2"
                      max="2.5"
                      step="0.1"
                      value={settings.godrayIntensity}
                      onInput={(e) => sound.playSliderTick(parseFloat((e.target as HTMLInputElement).value))}
                      onChange={(e) => onUpdateSettings({ godrayIntensity: parseFloat(e.target.value) })}
                      className="w-full accent-amber-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* GI Bounce Intensity */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-neutral-300">
                      <span>Indirect GI Bounce</span>
                      <span className="font-mono text-neutral-400">
                        {settings.giIntensity.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      id="gi-intensity-slider"
                      type="range"
                      min="0.2"
                      max="2.0"
                      step="0.1"
                      value={settings.giIntensity}
                      onInput={(e) => sound.playSliderTick(parseFloat((e.target as HTMLInputElement).value))}
                      onChange={(e) => onUpdateSettings({ giIntensity: parseFloat(e.target.value) })}
                      className="w-full accent-emerald-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Ambient Occlusion */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-neutral-300">
                      <span>Ambient Occlusion</span>
                      <span className="font-mono text-neutral-400">
                        {settings.aoIntensity.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      id="ao-intensity-slider"
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.1"
                      value={settings.aoIntensity}
                      onInput={(e) => sound.playSliderTick(parseFloat((e.target as HTMLInputElement).value))}
                      onChange={(e) => onUpdateSettings({ aoIntensity: parseFloat(e.target.value) })}
                      className="w-full accent-neutral-300 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* WebGPU Diagnostics & Debug Console Modal */}
      <WebGPUDebugModal
        isOpen={showDebugModal}
        onClose={() => setShowDebugModal(false)}
        stats={stats}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </div>
  );
};
