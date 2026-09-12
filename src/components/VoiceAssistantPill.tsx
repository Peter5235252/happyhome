import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  Loader2, 
  X, 
  Square, 
  Check, 
  Key, 
  ChevronDown, 
  Brain,
  Send,
  AlertCircle
} from 'lucide-react';
import { SUPPORTED_MODELS, PROVIDER_LIST, PROVIDER_DEFAULT_MODELS, findModelInfo } from '../constants/models';
import { sound } from '../audio/soundEffects';

export interface VoiceAssistantPillProps {
  isActive: boolean;
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  transcript: string;
  lastResponse: string;
  lastAction: string | null;
  selectedModel: string;
  apiKeys: Record<string, string>;
  micError?: string | null;
  isRequestingMic?: boolean;
  onRequestMicPermission?: () => void;
  onSubmitTextCommand?: (text: string) => void;
  onSelectModel: (modelId: string) => void;
  onUpdateApiKey: (providerId: string, key: string) => void;
  onToggle: () => void;
  onInterrupt?: () => void;
  onOpenMemoryManager?: () => void;
  onClose: () => void;
}

export const VoiceAssistantPill: React.FC<VoiceAssistantPillProps> = ({
  isActive,
  state,
  transcript,
  lastResponse,
  selectedModel,
  apiKeys,
  micError,
  isRequestingMic,
  onRequestMicPermission,
  onSubmitTextCommand,
  onSelectModel,
  onUpdateApiKey,
  onToggle,
  onInterrupt,
  onOpenMemoryManager,
  onClose,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  // Resolve via shared helper (matches id OR API alias, explicit default).
  // Previously this matched `id` only with a hardcoded-index Gemini fallback,
  // so any alias/stale value rendered as Gemini even after picking another model.
  const currentModel = findModelInfo(selectedModel);
  const [activeProviderTab, setActiveProviderTab] = useState<'gemini' | 'openai' | 'spacexai' | 'anthropic'>(
    currentModel.providerId
  );

  // Sync provider tab when model changes externally
  useEffect(() => {
    if (currentModel) {
      setActiveProviderTab(currentModel.providerId);
    }
  }, [currentModel?.providerId]);

  const activeProviderInfo = PROVIDER_LIST.find(p => p.id === activeProviderTab) || PROVIDER_LIST[0];

  const handleSendTyped = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedInput.trim()) return;
    sound.playTap();
    onSubmitTextCommand?.(typedInput.trim());
    setTypedInput('');
  };

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          key="voice-assistant-pill"
          initial={{ opacity: 0, y: -110, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -110, x: '-50%' }}
          transition={{
            y: { duration: 0.38, ease: [0.16, 1, 0.3, 1] },
            opacity: { duration: 0.26, ease: 'easeOut' },
          }}
          // Glass on the animated layer itself (same pattern as MinimalUI bars/buttons):
          // backdrop-filter is part of the compositing layer, so blur fades WITH
          // the slide/fade from frame 1 instead of popping in after it finishes.
          style={{
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            backdropFilter: 'blur(24px) saturate(180%)',
          }}
          className={`pointer-events-auto fixed top-4 left-1/2 z-50 flex flex-col items-center max-w-lg w-[94vw] sm:w-[32rem] transform-gpu rounded-2xl backdrop-blur-xl border transition-colors duration-500 ${
            state === 'thinking'
              ? 'thinking-glass-container'
              : 'bg-[rgba(10,10,10,0.55)] border-white/10 shadow-2xl'
          }`}
        >
          {/* Content — no separate glass layer so there is only one composited backdrop */}
          <div
            className="w-full p-3.5 text-neutral-100 overflow-hidden transform-gpu"
          >
            {/* Header bar */}
            <div className="flex items-center justify-between gap-3">
              {/* Status indicator & control */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={!!isRequestingMic}
                  onClick={() => {
                    sound.playTap();
                    if (isRequestingMic) return;
                    if (micError && onRequestMicPermission) {
                      onRequestMicPermission();
                    } else if (state === 'speaking' || state === 'thinking') {
                      (onInterrupt || onToggle)();
                    } else {
                      onToggle();
                    }
                  }}
                  className={`flex items-center justify-center h-7 w-7 rounded-lg transition-all ${
                    micError
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                      : state === 'listening'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                      : state === 'speaking'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30'
                      : state === 'thinking'
                      ? 'thinking-button-shift hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30'
                      : 'bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10'
                  }`}
                  title={
                    micError
                      ? 'Click to grant microphone permission'
                      : state === 'speaking' || state === 'thinking'
                      ? 'Click to Interrupt AI'
                      : state === 'listening'
                      ? 'Pause Listening'
                      : 'Resume Listening'
                  }
                >
                  {state === 'thinking' || isRequestingMic ? (
                    <Loader2 className={`h-3.5 w-3.5 animate-spin ${state === 'thinking' ? 'text-current' : 'text-sky-400'}`} />
                  ) : state === 'speaking' ? (
                    <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : micError ? (
                    <MicOff className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium tracking-wide transition-colors ${state === 'thinking' ? 'thinking-text-shift' : 'text-neutral-200'}`}>
                    {micError ? 'Mic Access Needed' : state === 'listening' ? 'Listening' : state === 'thinking' ? 'Thinking...' : state === 'speaking' ? 'Speaking' : 'Paused'}
                  </span>

                  {/* Status dot */}
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      micError
                        ? 'bg-amber-400'
                        : state === 'listening'
                        ? 'bg-amber-400'
                        : state === 'speaking'
                        ? 'bg-emerald-400'
                        : state === 'thinking'
                        ? 'thinking-dot-shift'
                        : 'bg-neutral-500'
                    }`}
                  />
                </div>
              </div>

              {/* Action summary, Model info & Controls */}
              <div className="flex items-center gap-2">
                {/* Seamless Interrupt Button when Speaking */}
                {(state === 'speaking' || state === 'thinking') && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => {
                      sound.playTap();
                      (onInterrupt || onToggle)();
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 text-[11px] text-neutral-300 hover:text-rose-300 transition-colors"
                    title="Interrupt AI speaking immediately"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                    <span>Interrupt</span>
                  </motion.button>
                )}

                {/* Model tag with quick toggle */}
                <button
                  onClick={() => {
                    sound.playTap();
                    setShowMenu(prev => !prev);
                  }}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] transition-colors border ${
                    showMenu
                      ? 'bg-white/15 text-white border-white/30'
                      : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                  title="Switch AI model and configure API keys"
                >
                  <span className="truncate max-w-[110px]">{currentModel.name}</span>
                  <ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
                </button>

                {/* Minimalist AI Memory Manager Quick Button */}
                {onOpenMemoryManager && (
                  <button
                    onClick={() => {
                      sound.playTap();
                      onOpenMemoryManager();
                    }}
                    className="flex items-center justify-center h-6 w-6 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                    title="View & manage AI cross-session memory summary"
                  >
                    <Brain className="h-3.5 w-3.5" />
                  </button>
                )}

                <button
                  onClick={() => {
                    sound.playTap();
                    onClose();
                  }}
                  className="flex items-center justify-center h-6 w-6 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close Voice Assistant"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Microphone Permission Recovery Banner */}
            {micError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-[11px] leading-tight">{micError}</span>
                </div>
                {onRequestMicPermission && (
                  <button
                    type="button"
                    disabled={!!isRequestingMic}
                    onClick={() => {
                      sound.playTap();
                      onRequestMicPermission();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-wait text-black text-[11px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5"
                  >
                    {isRequestingMic && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isRequestingMic ? 'Requesting…' : 'Allow Mic'}
                  </button>
                )}
              </motion.div>
            )}

            {/* Dropdown Menu for Models and API Keys */}
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="mt-3 pt-3 border-t border-white/10 space-y-3 overflow-hidden"
                >
                  {/* Provider Toolbar */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5 text-xs">
                    {PROVIDER_LIST.map((provider) => {
                      const isSelected = activeProviderTab === provider.id;
                      const hasActiveModel = currentModel.providerId === provider.id;
                      const modelNameForProvider = PROVIDER_DEFAULT_MODELS[provider.id] || currentModel.name;
                      return (
                        <button
                          key={provider.id}
                          onClick={() => {
                            sound.playTap();
                            setActiveProviderTab(provider.id);
                            const autoModelId = PROVIDER_DEFAULT_MODELS[provider.id];
                            if (autoModelId) {
                              onSelectModel(autoModelId);
                            }
                          }}
                          title={`${provider.name} (Model: ${modelNameForProvider})`}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-white/20 text-white border border-white/20'
                              : 'bg-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/10 border border-transparent'
                          }`}
                        >
                          <span>{provider.name}</span>
                          {hasActiveModel && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Minimalist API Key Input for Provider */}                  <div className="pt-2 border-t border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span className="flex items-center gap-1">
                        <Key className="h-3 w-3 text-neutral-400" />
                        <span>{activeProviderInfo.name} API Key</span>
                      </span>
                      {apiKeys[activeProviderTab] && (
                        <span className="text-emerald-400 text-[10px]">Configured</span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="password"
                        value={apiKeys[activeProviderTab] || ''}
                        onChange={(e) => onUpdateApiKey(activeProviderTab, e.target.value)}
                        placeholder={activeProviderInfo.keyPlaceholder}
                        className="w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-white/30 transition-colors"
                      />
                      {apiKeys[activeProviderTab] && (
                        <button
                          onClick={() => {
                            sound.playTap();
                            onUpdateApiKey(activeProviderTab, '');
                          }}
                          className="absolute right-2 text-neutral-500 hover:text-neutral-300 text-[11px]"
                          title="Clear API Key"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AI Cross-Session Memory & Profile Button */}
                  {onOpenMemoryManager && (
                    <div className="pt-2 border-t border-white/5">
                      <button
                        onClick={() => {
                          sound.playTap();
                          setShowMenu(false);
                          onOpenMemoryManager();
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-300 text-xs font-medium transition-all group"
                      >
                        <span className="flex items-center gap-2">
                          <Brain className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                          <span>AI Memory & Profile Settings</span>
                        </span>
                        <span className="text-[10px] text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                          Cloud Memory
                        </span>
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Dynamic Dialogue Box for Transcripts & Responses */}
            {(transcript || lastResponse) && !showMenu && (
              <div
                className="mt-2.5 pt-2.5 border-t border-white/10 space-y-1.5 text-xs overflow-hidden"
              >
                {transcript && (
                  <p className="text-amber-200/90 leading-relaxed italic">
                    "{transcript}"
                  </p>
                )}
                {lastResponse && (
                  <p className="text-neutral-200 leading-relaxed font-normal whitespace-pre-wrap selection:bg-white/20">
                    {lastResponse}
                  </p>
                )}
              </div>
            )}

            {/* Quick Text Command Input Bar (Supports Instant Prompting Without Mic) */}
            <form onSubmit={handleSendTyped} className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-1.5">
              <input
                type="text"
                value={typedInput}
                onChange={(e) => setTypedInput(e.target.value)}
                placeholder={state === 'thinking' ? "Thinking..." : "Type command or speak..."}
                className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none border transition-all ${
                  state === 'thinking'
                    ? 'thinking-inner-shift'
                    : 'bg-black/40 border-white/10 focus:border-white/30'
                }`}
              />
              <button
                type="submit"
                disabled={!typedInput.trim() || state === 'thinking'}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white transition-colors"
                title="Send Command"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
