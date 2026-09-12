export type AudioEngineId = 'gemini' | 'cartesia' | 'openai' | 'browser';

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  gender: 'female' | 'male' | 'neutral';
}

export interface AudioEngineConfig {
  id: AudioEngineId;
  name: string;
  tag: string;
  description: string;
  voices: VoiceOption[];
  defaultVoiceId: string;
}

export const AUDIO_ENGINES: AudioEngineConfig[] = [
  {
    id: 'gemini',
    name: 'Gemini Audio',
    tag: 'Google AI Neural',
    description: 'Ultra-expressive, native Google AI Studio neural voice with natural conversational cadence.',
    defaultVoiceId: 'Puck',
    voices: [
      { id: 'Puck', name: 'Puck', description: 'Energetic & Cheerful', gender: 'neutral' },
      { id: 'Charon', name: 'Charon', description: 'Deep & Grounded', gender: 'male' },
      { id: 'Kore', name: 'Kore', description: 'Warm & Soothing', gender: 'female' },
      { id: 'Fenrir', name: 'Fenrir', description: 'Direct & Authoritative', gender: 'male' },
      { id: 'Aoede', name: 'Aoede', description: 'Bright & Engaging', gender: 'female' },
    ]
  },
  {
    id: 'cartesia',
    name: 'Cartesia Sonic',
    tag: 'Ultra-Natural',
    description: 'State-space conversational neural model with micro-intonations, breath dynamics, and sub-100ms response.',
    defaultVoiceId: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', // Skylar
    voices: [
      { id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', name: 'Skylar', description: 'Warm & Natural', gender: 'female' },
      { id: '47c38ca4-5f35-497b-b1a3-415245fb35e1', name: 'Daniel', description: 'Calm & Confident', gender: 'male' },
      { id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', name: 'Jacqueline', description: 'Engaging & Smooth', gender: 'female' },
      { id: 'ef191366-f52f-447a-a398-ed8c0f2943a1', name: 'Archie', description: 'Articulate British', gender: 'male' },
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI Audio',
    tag: 'Studio Neural',
    description: 'Conversational studio neural TTS powered by OpenAI.',
    defaultVoiceId: 'nova',
    voices: [
      { id: 'nova', name: 'Nova', description: 'Warm & Animated', gender: 'female' },
      { id: 'alloy', name: 'Alloy', description: 'Crisp & Balanced', gender: 'neutral' },
      { id: 'echo', name: 'Echo', description: 'Smooth & Warm', gender: 'male' },
      { id: 'onyx', name: 'Onyx', description: 'Deep & Resonant', gender: 'male' },
      { id: 'shimmer', name: 'Shimmer', description: 'Clear & Expressive', gender: 'female' },
    ]
  },
  {
    id: 'browser',
    name: 'Web Neural',
    tag: 'Built-in OS',
    description: 'Standard local system voice synthesizer. No API key needed, offline-capable.',
    defaultVoiceId: 'auto',
    voices: [
      { id: 'auto', name: 'Native System Voice', description: 'Device prioritized voice', gender: 'neutral' }
    ]
  }
];

export interface AudioSettings {
  engine: AudioEngineId;
  voiceId: string;
  cartesiaKey?: string;
  geminiKey?: string;
  openAiKey?: string;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  engine: 'gemini',
  voiceId: 'Puck',
  cartesiaKey: '',
  geminiKey: '',
  openAiKey: '',
};

/**
 * Returns the corresponding preferred voice audio engine for a chosen model provider
 */
export function getPreferredAudioEngineForProvider(providerId: string): { engine: AudioEngineId; voiceId: string } {
  switch (providerId) {
    case 'gemini':
      return { engine: 'gemini', voiceId: 'Puck' };
    case 'openai':
      return { engine: 'openai', voiceId: 'nova' };
    case 'xai':
    case 'anthropic':
      // For text-first LLM providers, pair with ultra-natural Cartesia or high-fidelity Gemini
      return { engine: 'cartesia', voiceId: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' };
    default:
      return { engine: 'gemini', voiceId: 'Puck' };
  }
}
