const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');

// Add Voice logic inside App function
const voiceLogic = `
  // Setup WebSocket connection for Gemini Live API
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<any>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setDynamicObjects(dynamicObjects);
    }
  }, [dynamicObjects]);

  const toggleVoiceMode = async () => {
    if (isVoiceActive) {
      if (wsRef.current) wsRef.current.close();
      if (processorRef.current) processorRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
      setIsVoiceActive(false);
      return;
    }

    try {
      const ws = new WebSocket(\`ws://\${location.host}/live\`);
      wsRef.current = ws;

      const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
      const outputAudioCtx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = inputAudioCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputAudioCtx.createMediaStreamSource(stream);
      const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(inputAudioCtx.destination);

      const pcmToBase64 = (f32Array: Float32Array) => {
        const i16Array = new Int16Array(f32Array.length);
        for (let i = 0; i < f32Array.length; i++) {
          let s = Math.max(-1, Math.min(1, f32Array[i]));
          i16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(i16Array.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      };

      let audioQueue: AudioBuffer[] = [];
      let isPlaying = false;

      const playNext = () => {
        if (audioQueue.length === 0) {
          isPlaying = false;
          return;
        }
        isPlaying = true;
        const buffer = audioQueue.shift()!;
        const source = outputAudioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(outputAudioCtx.destination);
        source.onended = playNext;
        source.start();
      };

      const playAudioChunk = async (base64Audio: string) => {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const i16Array = new Int16Array(bytes.buffer);
        const f32Array = new Float32Array(i16Array.length);
        for(let i = 0; i < i16Array.length; i++) {
          f32Array[i] = i16Array[i] / 32768.0;
        }
        
        const audioBuffer = outputAudioCtx.createBuffer(1, f32Array.length, 24000);
        audioBuffer.getChannelData(0).set(f32Array);
        
        audioQueue.push(audioBuffer);
        if (!isPlaying) {
          playNext();
        }
      };

      processor.onaudioprocess = (e: any) => {
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
          playAudioChunk(msg.audio);
        }
        if (msg.interrupted) {
          audioQueue = [];
        }
        if (msg.toolCall && msg.toolCall.name === 'createObject') {
          const args = msg.toolCall.args;
          setDynamicObjects(prev => [...prev, args]);
        }
      };

      ws.onclose = () => {
        setIsVoiceActive(false);
      };

      setIsVoiceActive(true);
    } catch(err) {
      console.error(err);
    }
  };
`;

app = app.replace('const [settings, setSettings]', voiceLogic + '\n  const [settings, setSettings]');
app = app.replace('onResetCamera={handleResetCamera}', 'onResetCamera={handleResetCamera}\n          isVoiceActive={isVoiceActive}\n          toggleVoiceMode={toggleVoiceMode}');

fs.writeFileSync('src/App.tsx', app);
