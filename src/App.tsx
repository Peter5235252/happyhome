/**
 * Happy Home - Photorealistic WebGPU Raytracer & Global Illumination Pipeline
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { WebGPURenderer } from './renderer/WebGPURenderer';
import { PerformanceStats, RenderSettings, DynamicObject } from './renderer/types';
import { MinimalUI } from './components/MinimalUI';
import { WebGPUFallbackNotice } from './components/WebGPUFallbackNotice';
import { SpeechToTextEngine } from './audio/SpeechToTextEngine';
import { naturalVoice } from './audio/NaturalVoiceSynthesizer';
import { VoiceAssistantPill } from './components/VoiceAssistantPill';
import { MemoryManagerModal } from './components/MemoryManagerModal';
import { SUPPORTED_MODELS } from './constants/models';
import { 
  fetchUserMemoryProfile, 
  saveUserMemoryProfile, 
  upsertMemoryItem, 
  UserMemoryProfile 
} from './lib/firebase';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGPURenderer | null>(null);
  
  const [initError, setInitError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  const [stats, setStats] = useState<PerformanceStats>({
    fps: 60,
    frameTimeMs: 16.6,
    gpuName: 'WebGPU Pipeline',
    resolution: [1200, 800],
    sampleIndex: 0,
    diagnostics: {
      adapterName: 'WebGPU Pipeline',
      vendor: 'Direct Ingress',
      architecture: 'Native',
      limits: {},
      shaderStatus: 'compiling',
      shaderErrors: [],
      validationErrors: [],
    },
  });

  const [dynamicObjects, setDynamicObjects] = useState<DynamicObject[]>([]);

  // Cross-Session AI Memory & User Profile State
  const [userMemory, setUserMemory] = useState<UserMemoryProfile | null>(null);
  const [showMemoryModal, setShowMemoryModal] = useState<boolean>(false);

  const loadMemoryProfile = useCallback(async () => {
    try {
      const mem = await fetchUserMemoryProfile();
      setUserMemory(mem);
    } catch (e) {
      console.error("Failed to load user memory:", e);
    }
  }, []);

  useEffect(() => {
    loadMemoryProfile();
  }, [loadMemoryProfile]);

  // Agentic Voice Pipeline State & Model Selector
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<string>('');
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('voice_assistant_model') || 'gemini-3.6-flash';
  });
  const [micError, setMicError] = useState<string | null>(null);

  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('voice_assistant_api_keys');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const handleSelectModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem('voice_assistant_model', modelId);
  }, []);

  const handleUpdateApiKey = useCallback((providerId: string, key: string) => {
    setApiKeys(prev => {
      const updated = { ...prev, [providerId]: key.trim() };
      localStorage.setItem('voice_assistant_api_keys', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const sttRef = useRef<SpeechToTextEngine | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Seamless Interruption Handler
  const handleInterrupt = useCallback(() => {
    // Abort pending fetch if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Stop audio speech synthesis immediately
    naturalVoice.stop();
    // Return immediately to listening state
    setVoiceState('listening');
    if (sttRef.current) {
      sttRef.current.start();
    }
  }, []);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setDynamicObjects(dynamicObjects);
    }
  }, [dynamicObjects]);

  const [settings, setSettings] = useState<RenderSettings>({
    timeOfDay: 0.35,
    godraysEnabled: true,
    godrayIntensity: 1.2,
    giEnabled: true,
    giIntensity: 1.0,
    aoIntensity: 1.0,
    reflectionsEnabled: true,
    smokeSpeed: 1.0,
    windSpeed: 1.0,
    cloudDensity: 0.8,
    cameraPreset: 'svg_perspective',
    showOriginalSvg: false,
    debugMode: 0,
    resolutionScale: 1.0,
    audioEnabled: true,
  });

  // Sync settings directly to WebGPU renderer
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.settings = { ...settings };
    }
  }, [settings]);

  // Session consolidation and cloud persistence
  const summarizeAndSaveSession = useCallback(async (historyToSummarize: Array<{ role: string; content: string }>) => {
    if (!historyToSummarize || historyToSummarize.length === 0) return;
    try {
      const modelInfo = SUPPORTED_MODELS.find(m => m.id === selectedModel);
      const providerId = modelInfo?.providerId || 'gemini';
      const apiKey = apiKeys[providerId] || undefined;

      const res = await fetch('/api/summarize-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyToSummarize,
          currentMemory: userMemory,
          model: selectedModel,
          apiKey
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          await saveUserMemoryProfile({
            summary: data.summary,
            facts: data.facts || []
          });

          // Granular items
          if (Array.isArray(data.items)) {
            for (const item of data.items) {
              if (item.text) {
                await upsertMemoryItem({
                  category: item.category || 'preference',
                  text: item.text
                });
              }
            }
          }

          // Reload fresh profile
          await loadMemoryProfile();
        }
      }
    } catch (err) {
      console.error("Session summarization and save failed:", err);
    }
  }, [selectedModel, apiKeys, userMemory, loadMemoryProfile]);

  // Handle agent message dispatch
  const handleUserVoiceMessage = useCallback(async (userPrompt: string) => {
    if (!userPrompt.trim()) return;

    // Interrupt any existing speech before processing new message
    naturalVoice.stop();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setVoiceState('thinking');
    setTranscript(userPrompt);

    try {
      const modelInfo = SUPPORTED_MODELS.find(m => m.id === selectedModel);
      const providerId = modelInfo?.providerId || 'gemini';
      const apiKey = apiKeys[providerId] || undefined;

      const res = await fetch('/api/voice-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          message: userPrompt,
          model: selectedModel,
          apiKey,
          history: conversationHistory,
          context: {
            dynamicObjects,
            dynamicObjectsCount: dynamicObjects.length,
            memory: userMemory,
            settings: {
              timeOfDay: settings.timeOfDay,
              godrayIntensity: settings.godrayIntensity,
              giIntensity: settings.giIntensity,
              aoIntensity: settings.aoIntensity,
              godraysEnabled: settings.godraysEnabled,
              giEnabled: settings.giEnabled,
              cameraPreset: settings.cameraPreset,
            }
          }
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // If aborted during processing, do not continue
      if (abortController.signal.aborted) return;

      // Execute chained tool calls on the 3D scene
      if (data.functionCalls && data.functionCalls.length > 0) {
        for (const call of data.functionCalls) {
          if (call.name === 'createObject') {
            const args = call.args;
            setDynamicObjects(prev => [...prev, args]);
            setLastAction(`Added ${args.label || args.shape || 'object'}`);
          } else if (call.name === 'batchCreateObjects') {
            const { objects } = call.args;
            if (Array.isArray(objects)) {
              setDynamicObjects(prev => [...prev, ...objects]);
              setLastAction(`Spawned ${objects.length} 3D objects`);
            }
          } else if (call.name === 'modifyObject') {
            const { index, label, ...updates } = call.args;
            setDynamicObjects(prev => {
              return prev.map((obj, i) => {
                if (index !== undefined && i === index) {
                  return { ...obj, ...updates };
                }
                if (label && obj.label && obj.label.toLowerCase().includes(label.toLowerCase())) {
                  return { ...obj, ...updates };
                }
                return obj;
              });
            });
            setLastAction(`Modified ${label || `object #${index}`}`);
          } else if (call.name === 'removeObject') {
            const { index, label } = call.args;
            setDynamicObjects(prev => {
              return prev.filter((obj, i) => {
                if (index !== undefined && i === index) return false;
                if (label && obj.label && obj.label.toLowerCase().includes(label.toLowerCase())) return false;
                return true;
              });
            });
            setLastAction(`Removed ${label || `object #${index}`}`);
          } else if (call.name === 'clearObjects') {
            setDynamicObjects([]);
            setLastAction('Cleared scene objects');
          } else if (call.name === 'setLighting') {
            const { timeOfDay, godrayIntensity, giIntensity, aoIntensity, reflectionsEnabled } = call.args;
            setSettings(prev => ({
              ...prev,
              ...(timeOfDay !== undefined ? { timeOfDay } : {}),
              ...(godrayIntensity !== undefined ? { godrayIntensity } : {}),
              ...(giIntensity !== undefined ? { giIntensity } : {}),
              ...(aoIntensity !== undefined ? { aoIntensity } : {}),
              ...(reflectionsEnabled !== undefined ? { reflectionsEnabled } : {}),
            }));
            if (rendererRef.current && timeOfDay !== undefined) {
              rendererRef.current.settings.timeOfDay = timeOfDay;
            }
            setLastAction(`Adjusted lighting (Time: ${timeOfDay !== undefined ? timeOfDay.toFixed(2) : 'updated'})`);
          } else if (call.name === 'setAtmosphere') {
            const { smokeSpeed, windSpeed, cloudDensity, audioEnabled } = call.args;
            setSettings(prev => ({
              ...prev,
              ...(smokeSpeed !== undefined ? { smokeSpeed } : {}),
              ...(windSpeed !== undefined ? { windSpeed } : {}),
              ...(cloudDensity !== undefined ? { cloudDensity } : {}),
              ...(audioEnabled !== undefined ? { audioEnabled } : {}),
            }));
            setLastAction('Updated atmosphere');
          } else if (call.name === 'setCamera') {
            const args = call.args;
            if (args.preset) {
              setSettings(prev => ({ ...prev, cameraPreset: args.preset }));
            }
            if (rendererRef.current) {
              rendererRef.current.setCamera(args);
            }
            setLastAction(`Choreographed camera view`);
          }
        }
      }

      const speech = data.speechText || "I've sculpted the scene to match your vision.";
      setLastResponse(speech);

      // Record in conversation history for multi-turn context
      setConversationHistory(prev => [
        ...prev.slice(-8),
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: speech }
      ]);

      // Synthesize hyperrealistic natural voice
      setVoiceState('speaking');
      await naturalVoice.speak(speech, {
        rate: 1.0,
        pitch: 1.0,
        onEnd: () => {
          setVoiceState('listening');
        },
        onError: () => {
          setVoiceState('listening');
        }
      });

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Ignored, user interrupted
        return;
      }
      console.error("Voice command processing failed:", err);
      setVoiceState('listening');
      setLastResponse("I had trouble reaching the voice server. Please try again.");
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, [dynamicObjects, settings, selectedModel, apiKeys, conversationHistory, userMemory]);

  const handleRequestMicPermission = useCallback(async () => {
    const result = await SpeechToTextEngine.requestMicrophoneAccess();
    if (result.granted) {
      setMicError(null);
      if (sttRef.current) {
        sttRef.current.start();
        setVoiceState('listening');
      }
    } else {
      setMicError(result.error || 'Microphone access was denied. Please allow microphone permission.');
    }
  }, []);

  const toggleVoiceMode = useCallback(() => {
    if (isVoiceActive) {
      // Session ending: Consolidate cross-session memory into cloud Firestore
      if (conversationHistory.length > 0) {
        summarizeAndSaveSession(conversationHistory);
      }

      // Deactivate
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (sttRef.current) {
        sttRef.current.stop();
        sttRef.current = null;
      }
      naturalVoice.stop();
      setIsVoiceActive(false);
      setVoiceState('idle');
      setTranscript('');
      setMicError(null);
      return;
    }

    // Activate Voice Mode
    setIsVoiceActive(true);
    setVoiceState('listening');
    setTranscript('');
    setMicError(null);
    setLastAction(null);

    // Initial greeting personalized with remembered profile if available
    const welcome = userMemory?.facts && userMemory.facts.length > 0
      ? "Welcome back! I remember your preferences. How would you like to reshape the scene?"
      : "Voice mode active. How would you like to reshape the scene?";
    setLastResponse(welcome);
    naturalVoice.speak(welcome, {
      onEnd: () => {
        setVoiceState('listening');
      }
    });

    // Start STT Engine with real-time continuous interruption detection
    const stt = new SpeechToTextEngine({
      onInterimTranscript: (text) => {
        // Seamless Interruption: if AI is speaking or thinking, cut it off the moment user speaks
        if (naturalVoice.getIsSpeaking() || voiceState === 'speaking' || voiceState === 'thinking') {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          naturalVoice.stop();
        }
        setVoiceState('listening');
        setTranscript(text);
      },
      onFinalTranscript: (text) => {
        handleUserVoiceMessage(text);
      },
      onError: (err) => {
        console.warn("STT Error:", err);
        if (err.toLowerCase().includes('denied') || err.toLowerCase().includes('permission') || err.toLowerCase().includes('not-allowed')) {
          setMicError(err);
        }
      },
      onStateChange: (sttState) => {
        if (sttState === 'listening' && voiceState !== 'speaking' && voiceState !== 'thinking') {
          setVoiceState('listening');
        }
      }
    });

    stt.start();
    sttRef.current = stt;
  }, [isVoiceActive, conversationHistory, summarizeAndSaveSession, handleUserVoiceMessage, voiceState, userMemory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        e.key.toLowerCase() === 't' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        toggleVoiceMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleVoiceMode]);

  // Camera interaction state
  const isDraggingRef = useRef<boolean>(false);
  const dragButtonRef = useRef<number>(0);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchDistRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let localRenderer: WebGPURenderer | null = null;

    async function init() {
      if (!canvasRef.current) return;
      setInitError(null);

      // Clean up any existing renderer before creating a new one
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }

      try {
        const renderer = new WebGPURenderer(canvasRef.current, (newStats) => {
          if (!isCancelled) {
            setStats(newStats);
          }
        });
        localRenderer = renderer;

        await renderer.init();

        if (isCancelled) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
        setIsReady(true);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('WebGPU Init Error:', err);
        setInitError(err?.message || 'Failed to initialize WebGPU render pipeline.');
        setIsReady(false);
      }
    }

    init();

    return () => {
      isCancelled = true;
      if (localRenderer) {
        localRenderer.destroy();
        localRenderer = null;
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      setIsReady(false);
    };
  }, []);

  const handleRetryInit = useCallback(() => {
    setIsReady(false);
    setInitError(null);
    if (!canvasRef.current) return;

    if (rendererRef.current) {
      rendererRef.current.destroy();
      rendererRef.current = null;
    }

    const renderer = new WebGPURenderer(canvasRef.current, (newStats) => {
      setStats(newStats);
    });
    rendererRef.current = renderer;

    renderer.init()
      .then(() => setIsReady(true))
      .catch((err) => {
        setInitError(err?.message || 'Failed to initialize WebGPU render pipeline.');
        setIsReady(false);
      });
  }, []);

  // Handle Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // high fidelity with smooth performance
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);

      if (w > 0 && h > 0) {
        if (rendererRef.current) {
          rendererRef.current.resize(w, h);
        } else {
          canvas.width = w;
          canvas.height = h;
        }
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);

    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Update renderer settings whenever state updates
  const handleUpdateSettings = useCallback((newSettings: Partial<RenderSettings>) => {
    setSettings((prev) => {
      const updated = { 
        ...prev, 
        ...newSettings,
        godraysEnabled: true,
        giEnabled: true,
      };
      if (rendererRef.current) {
        rendererRef.current.settings = { ...rendererRef.current.settings, ...updated };
      }
      return updated;
    });
  }, []);

  const handleSelectPreset = useCallback((preset: 'svg_perspective' | 'cinematic' | 'meadow' | 'sunset') => {
    if (rendererRef.current) {
      rendererRef.current.setPreset(preset);
      setSettings((prev) => ({
        ...prev,
        cameraPreset: preset,
        timeOfDay: rendererRef.current?.settings.timeOfDay ?? prev.timeOfDay,
      }));
    }
  }, []);

  const handleResetCamera = useCallback(() => {
    handleSelectPreset('svg_perspective');
  }, [handleSelectPreset]);

  // Mouse & Touch Controls
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragButtonRef.current = e.button;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !rendererRef.current) return;

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    const cam = rendererRef.current.camera;

    if (dragButtonRef.current === 0 && !e.shiftKey) {
      // Left Click: Orbit
      cam.azimuth -= dx * 0.006;
      cam.elevation = Math.max(0.6, Math.min(1.55, cam.elevation - dy * 0.005));
    } else {
      // Right Click or Shift+Left Click: Pan
      const panSpeed = cam.distance * 0.0015;
      cam.target[0] -= dx * panSpeed * Math.cos(cam.azimuth);
      cam.target[1] += dy * panSpeed;
      cam.target[2] += dx * panSpeed * Math.sin(cam.azimuth);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!rendererRef.current) return;
    const cam = rendererRef.current.camera;
    cam.distance = Math.max(4.0, Math.min(24.0, cam.distance + e.deltaY * 0.01));
  };

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      lastMousePosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchDistRef.current = null;
    } else if (e.touches.length === 2) {
      isDraggingRef.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDistRef.current = Math.hypot(dx, dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!rendererRef.current) return;
    const cam = rendererRef.current.camera;

    if (e.touches.length === 1 && isDraggingRef.current) {
      const dx = e.touches[0].clientX - lastMousePosRef.current.x;
      const dy = e.touches[0].clientY - lastMousePosRef.current.y;
      lastMousePosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      cam.azimuth -= dx * 0.007;
      cam.elevation = Math.max(0.6, Math.min(1.55, cam.elevation - dy * 0.006));
    } else if (e.touches.length === 2 && touchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = touchDistRef.current - dist;
      touchDistRef.current = dist;

      cam.distance = Math.max(4.0, Math.min(24.0, cam.distance + delta * 0.02));
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    touchDistRef.current = null;
  };

  return (
    <div 
      className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none font-sans"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Primary WebGPU Canvas */}
      <canvas
        id="webgpu-canvas"
        ref={canvasRef}
        className="block w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleResetCamera}
      />

      {/* WebGPU Fallback / Unavailable Notification */}
      {initError && (
        <WebGPUFallbackNotice
          errorMessage={initError}
          onRetry={handleRetryInit}
        />
      )}

      {/* Minimalist Frosted Glass UI */}
      {isReady && (
        <>
          <MinimalUI
            settings={settings}
            stats={stats}
            onUpdateSettings={handleUpdateSettings}
            onSelectPreset={handleSelectPreset}
            onResetCamera={handleResetCamera}
            isVoiceActive={isVoiceActive}
            toggleVoiceMode={toggleVoiceMode}
            onOpenMemoryManager={() => setShowMemoryModal(true)}
          />
          <VoiceAssistantPill
            isActive={isVoiceActive}
            state={voiceState}
            transcript={transcript}
            lastResponse={lastResponse}
            lastAction={lastAction}
            selectedModel={selectedModel}
            apiKeys={apiKeys}
            micError={micError}
            onRequestMicPermission={handleRequestMicPermission}
            onSubmitTextCommand={(text) => handleUserVoiceMessage(text)}
            onSelectModel={handleSelectModel}
            onUpdateApiKey={handleUpdateApiKey}
            onInterrupt={handleInterrupt}
            onOpenMemoryManager={() => setShowMemoryModal(true)}
            onToggle={() => {
              if (voiceState === 'speaking' || voiceState === 'thinking') {
                handleInterrupt();
              } else if (voiceState === 'listening') {
                if (sttRef.current) sttRef.current.stop();
                setVoiceState('idle');
              } else {
                if (sttRef.current) sttRef.current.start();
                setVoiceState('listening');
              }
            }}
            onClose={() => {
              toggleVoiceMode();
            }}
          />
          <MemoryManagerModal
            isOpen={showMemoryModal}
            onClose={() => setShowMemoryModal(false)}
            onMemoryChanged={loadMemoryProfile}
          />
        </>
      )}
    </div>
  );
}
