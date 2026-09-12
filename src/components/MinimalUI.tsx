import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sun, 
  Sparkles, 
  Layers, 
  Sliders, 
  ChevronDown, 
  ChevronUp, 
  Info,
  Terminal,
  Volume2,
  X,
  Compass,
  Mic, 
  MicOff,
  Brain,
  Loader2
} from 'lucide-react';
import { PerformanceStats, RenderSettings } from '../renderer/types';
import { WebGPUDebugModal } from './WebGPUDebugModal';
import { sound } from '../audio/soundEffects';
import { AudioSettings } from '../audio/audioEngines';

interface Props {
  settings: RenderSettings;
  stats: PerformanceStats;
  audioSettings?: AudioSettings;
  onOpenAudioSettings?: () => void;
  onUpdateSettings: (newSettings: Partial<RenderSettings>) => void;
  onSelectPreset: (preset: 'home_perspective' | 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset') => void;
  onResetCamera: () => void;
  isVoiceActive?: boolean;
  voiceState?: 'idle' | 'listening' | 'thinking' | 'speaking';
  toggleVoiceMode?: () => void;
  onOpenMemoryManager?: () => void;
}

export const MinimalUI: React.FC<Props> = ({
  settings,
  stats,
  audioSettings,
  onOpenAudioSettings,
  onUpdateSettings,
  onSelectPreset,
  onResetCamera,
  isVoiceActive,
  voiceState,
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
          
          {/* AI Voice Engine Quick Switcher */}
          {onOpenAudioSettings && (
            <motion.button
              whileTap={{ scale: 0.93 }}
              id="ai-audio-engine-btn"
              onClick={() => {
                sound.playTap();
                onOpenAudioSettings();
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium backdrop-blur-xl border bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10 transition-all shadow-sm"
              title="Select AI Audio Engine (Cartesia Sonic, OpenAI, Web Neural)"
            >
              <Volume2 className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">
                {audioSettings?.engine === 'cartesia' ? 'Sonic' : audioSettings?.engine === 'openai' ? 'OpenAI' : 'Web Voice'}
              </span>
            </motion.button>
          )}

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
              voiceState === 'thinking'
                ? 'thinking-glass-container text-neutral-200 shadow-md'
                : isVoiceActive
                ? 'bg-rose-500/25 border-rose-400/40 text-rose-200 shadow-md'
                : 'bg-neutral-950/45 border-white/10 text-neutral-300 hover:bg-neutral-900/60'
            }`}
            title="Talk to Gemini Agent"
          >
            {voiceState === 'thinking' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-current" />
            ) : isVoiceActive ? (
              <Mic className="h-3.5 w-3.5 text-rose-400" />
            ) : (
              <MicOff className="h-3.5 w-3.5 text-neutral-400" />
            )}
            <span className="hidden sm:inline">
              {voiceState === 'thinking' ? 'Thinking…' : 'Voice'}
            </span>
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
            <div className="flex flex-wrap items-center gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
              {(
                [
                  { id: 'home_perspective', label: 'Home View' },
                  { id: 'cinematic', label: 'Cinematic' },
                  { id: 'meadow', label: 'Meadow' },
                  { id: 'sunset', label: 'Sunset' },
                  { id: 'garden_bench', label: 'Bench' },
                  { id: 'roof_chimney', label: 'Roof' },
                  { id: 'kite_flight', label: 'Kite' },
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
                      onSelectPreset(preset.id as any);
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

                  {/* Level of Detail (LOD) Mode */}
                  <div className="space-y-1.5 sm:col-span-2 pt-2 border-t border-white/5">
                    <div className="flex justify-between text-neutral-300 items-center">
                      <span className="font-medium text-amber-200">Level of Detail (LOD) Pipeline</span>
                      <span className="font-mono text-[11px] text-neutral-400">
                        Bias: {(settings.lodBias || 1.0).toFixed(2)}x
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {(
                        [
                          { id: 'auto', label: 'Adaptive Auto' },
                          { id: 'ultra', label: 'Ultra High Poly' },
                          { id: 'balanced', label: 'Balanced' },
                          { id: 'performance', label: 'Fast LOD' },
                        ] as const
                      ).map((m) => {
                        const isSelected = (settings.lodMode || 'auto') === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              sound.playTap();
                              onUpdateSettings({ lodMode: m.id });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                              isSelected
                                ? 'bg-amber-500/25 border border-amber-400/40 text-amber-200 font-semibold shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400'
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Terrain & Environment */}
                  <div className="space-y-1.5 sm:col-span-2 pt-2 border-t border-white/5">
                    <div className="flex justify-between items-center text-neutral-300">
                      <span className="font-medium text-amber-200/90">Terrain & Environment</span>
                      <button
                        id="toggle-base-cottage-btn"
                        onClick={() => {
                          sound.playTap();
                          onUpdateSettings({ showBaseCottage: !(settings.showBaseCottage ?? true) });
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                          (settings.showBaseCottage ?? true)
                            ? 'bg-amber-500/20 border-amber-400/30 text-amber-200'
                            : 'bg-white/5 border-white/10 text-neutral-400'
                        }`}
                      >
                        {(settings.showBaseCottage ?? true) ? 'Cottage: Visible' : 'Cottage: Hidden'}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {(
                        [
                          { id: 'meadow', label: 'Meadow' },
                          { id: 'courtyard', label: 'Courtyard' },
                          { id: 'desert', label: 'Desert Dunes' },
                          { id: 'water', label: 'Mirror Lake' },
                          { id: 'void', label: 'Obsidian Void' },
                          { id: 'alien', label: 'Cyber Grid' },
                        ] as const
                      ).map((env) => {
                        const isSelected = (settings.environmentStyle || 'meadow').toLowerCase() === env.id;
                        return (
                          <button
                            key={env.id}
                            id={`env-style-${env.id}-btn`}
                            onClick={() => {
                              sound.playTap();
                              onUpdateSettings({ environmentStyle: env.id });
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                              isSelected
                                ? 'bg-amber-500/25 border border-amber-400/40 text-amber-200 font-semibold shadow-sm'
                                : 'bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-400'
                            }`}
                          >
                            {env.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Simulation Animation Speed */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <div className="flex justify-between text-neutral-300">
                      <span>Simulation Clock Speed (Smoke, Wind, Kite)</span>
                      <span className="font-mono text-neutral-400">
                        {(settings.simulationSpeed || 1.0).toFixed(1)}x
                      </span>
                    </div>
                    <input
                      id="simulation-speed-slider"
                      type="range"
                      min="0.0"
                      max="3.0"
                      step="0.1"
                      value={settings.simulationSpeed ?? 1.0}
                      onInput={(e) => sound.playSliderTick(parseFloat((e.target as HTMLInputElement).value))}
                      onChange={(e) => onUpdateSettings({ simulationSpeed: parseFloat(e.target.value) })}
                      className="w-full accent-amber-400 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
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
