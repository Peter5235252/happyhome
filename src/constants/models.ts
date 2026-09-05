export interface AIModelInfo {
  id: string;
  name: string;
  provider: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude' | 'Mistral';
  providerId: 'gemini' | 'openai' | 'xai' | 'anthropic' | 'mistral';
  badge?: string;
}

export const PROVIDER_LIST: Array<{
  id: 'gemini' | 'openai' | 'xai' | 'anthropic' | 'mistral';
  name: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude' | 'Mistral';
  keyPlaceholder: string;
}> = [
  { id: 'gemini', name: 'Gemini', keyPlaceholder: 'Google AI Studio API Key (Optional)' },
  { id: 'openai', name: 'ChatGPT', keyPlaceholder: 'OpenAI API Key (sk-...)' },
  { id: 'xai', name: 'Grok', keyPlaceholder: 'xAI API Key (xai-...)' },
  { id: 'anthropic', name: 'Claude', keyPlaceholder: 'Anthropic API Key (sk-ant-...)' },
  { id: 'mistral', name: 'Mistral', keyPlaceholder: 'Mistral API Key' },
];

export const SUPPORTED_MODELS: AIModelInfo[] = [
  // Gemini
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Gemini', providerId: 'gemini' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Gemini', providerId: 'gemini' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Gemini', providerId: 'gemini' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Gemini', providerId: 'gemini' },

  // ChatGPT (OpenAI)
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'ChatGPT', providerId: 'openai' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'ChatGPT', providerId: 'openai' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'ChatGPT', providerId: 'openai' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'ChatGPT', providerId: 'openai' },

  // Grok (xAI)
  { id: 'grok-4.6', name: 'Grok 4.6', provider: 'Grok', providerId: 'xai' },

  // Mistral
  { id: 'mistral-large-3', name: 'Mistral Large 3', provider: 'Mistral', providerId: 'mistral' },
  { id: 'mistral-small-4', name: 'Mistral Small 4', provider: 'Mistral', providerId: 'mistral' },
  { id: 'mistral-medium-3.5', name: 'Mistral Medium 3.5', provider: 'Mistral', providerId: 'mistral' },

  // Claude (Anthropic)
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Claude', providerId: 'anthropic' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'Claude', providerId: 'anthropic' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', provider: 'Claude', providerId: 'anthropic' },
];
