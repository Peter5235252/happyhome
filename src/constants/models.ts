export interface AIModelInfo {
  id: string;
  /** Exact model ID to send to the provider API. */
  apiModelId: string;
  name: string;
  provider: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude' | 'Mistral';
  providerId: 'gemini' | 'openai' | 'xai' | 'anthropic' | 'mistral';
  badge?: string;
  /** Verified context window as of Sept 2026 (for prompt budgeting). */
  contextWindow?: number;
  /** Date this entry was last verified against official provider docs. */
  verifiedAsOf?: string;
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

/**
 * SUPPORTED MODELS — verified live as of September 6, 2026.
 *
 * Sources checked:
 * - Gemini: https://ai.google.dev/gemini-api/docs/models + Sept 2 2026 GA note for
 *   gemini-3.8-flash; BenchLM Sept 4 2026 ranking confirms 3.5/3.6/3.7/3.8 Flash.
 * - OpenAI: https://developers.openai.com/api/docs/models — gpt-5.6-luna, gpt-5.6-terra,
 *   gpt-5.6-sol (June 26 2026, 1.05M ctx) + gpt-6-astra (Sept 3 2026, 1.05M ctx).
 * - xAI: https://docs.x.ai/developers/models/grok-4.6 — grok-4.6 (Aug 12 2026, 500K ctx).
 *   NOTE: the API ID uses a DOT (grok-4.6), not a hyphen.
 * - Anthropic: https://platform.claude.com/docs/en/models/overview — claude-sonnet-5
 *   (June 30 2026), claude-opus-5 (July 24 2026), claude-fable-5-1 (Sept 1 2026, 1M ctx).
 *   NOTE: the Fable 5.1 API ID uses a HYPHEN (claude-fable-5-1), NOT a dot.
 *   The old app value "claude-fable-5.1" was an invalid ID and returned model-not-found.
 * - Mistral: https://docs.mistral.ai + https://mistral.ai/models/ — Mistral Large 3
 *   (Dec 2 2025), Mistral Small 4 (Mar 16 2026), Mistral Medium 3.5 (Apr 29 2026).
 *   The stable API aliases are mistral-large-latest / mistral-small-latest /
 *   mistral-medium-latest. Versioned display names (Large 3 etc.) are kept as UI ids
 *   but mapped to the -latest alias for actual API calls.
 */
export const SUPPORTED_MODELS: AIModelInfo[] = [
  // Gemini (API ID == UI ID, 1M context)
  { id: 'gemini-3.5-flash', apiModelId: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Gemini', providerId: 'gemini', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
  { id: 'gemini-3.6-flash', apiModelId: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Gemini', providerId: 'gemini', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
  { id: 'gemini-3.7-flash', apiModelId: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Gemini', providerId: 'gemini', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
  { id: 'gemini-3.8-flash', apiModelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'New', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },

  // ChatGPT (OpenAI) — 1.05M context, 128K max output
  { id: 'gpt-5.6-luna', apiModelId: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'ChatGPT', providerId: 'openai', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },
  { id: 'gpt-5.6-terra', apiModelId: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'ChatGPT', providerId: 'openai', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },
  { id: 'gpt-5.6-sol', apiModelId: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'ChatGPT', providerId: 'openai', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },
  { id: 'gpt-6-astra', apiModelId: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'ChatGPT', providerId: 'openai', badge: 'New', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },

  // Grok (xAI) — 500K context. API ID keeps the DOT.
  { id: 'grok-4.6', apiModelId: 'grok-4.6', name: 'Grok 4.6', provider: 'Grok', providerId: 'xai', contextWindow: 500_000, verifiedAsOf: '2026-09-06' },

  // Mistral — UI id is the versioned display name, apiModelId is the stable alias.
  { id: 'mistral-large-3', apiModelId: 'mistral-large-latest', name: 'Mistral Large 3', provider: 'Mistral', providerId: 'mistral', contextWindow: 256_000, verifiedAsOf: '2026-09-06' },
  { id: 'mistral-small-4', apiModelId: 'mistral-small-latest', name: 'Mistral Small 4', provider: 'Mistral', providerId: 'mistral', contextWindow: 256_000, verifiedAsOf: '2026-09-06' },
  { id: 'mistral-medium-3.5', apiModelId: 'mistral-medium-latest', name: 'Mistral Medium 3.5', provider: 'Mistral', providerId: 'mistral', contextWindow: 256_000, verifiedAsOf: '2026-09-06' },

  // Claude (Anthropic) — 1M context. Fable 5.1 API ID uses HYPHEN.
  { id: 'claude-sonnet-5', apiModelId: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Claude', providerId: 'anthropic', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
  { id: 'claude-opus-5', apiModelId: 'claude-opus-5', name: 'Claude Opus 5', provider: 'Claude', providerId: 'anthropic', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
  { id: 'claude-fable-5-1', apiModelId: 'claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'Claude', providerId: 'anthropic', badge: 'New', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
];

/** Default model when nothing valid is stored/selected. */
export const DEFAULT_MODEL_ID = 'gemini-3.6-flash';

/**
 * Normalize any stored/selected value to the canonical UI `id`.
 * - Historic bug: the app once stored "claude-fable-5.1" (dot), which is not a
 *   valid Anthropic API ID (must be "claude-fable-5-1" with hyphen).
 * - API aliases (e.g. "mistral-large-latest") are canonicalized to their UI id
 *   (e.g. "mistral-large-3") so state NEVER holds a non-id value. Letting an
 *   alias into state was the "selects X, shows Gemini" bug: the model pill only
 *   matched `id` and fell back to the Gemini entry for anything else.
 */
export function normalizeModelId(stored: string | null | undefined): string {
  if (!stored) return DEFAULT_MODEL_ID;
  if (stored === 'claude-fable-5.1') return 'claude-fable-5-1';
  const byId = SUPPORTED_MODELS.find((m) => m.id === stored);
  if (byId) return byId.id;
  const byApi = SUPPORTED_MODELS.find((m) => m.apiModelId === stored);
  if (byApi) return byApi.id;
  return DEFAULT_MODEL_ID;
}

/** Resolve the exact string to send to the provider API (verified Sept 2026). */
export function resolveApiModelId(uiModelId: string): string {
  const normalized = normalizeModelId(uiModelId);
  const found = SUPPORTED_MODELS.find((m) => m.id === normalized || m.apiModelId === normalized);
  return found?.apiModelId ?? DEFAULT_MODEL_ID;
}

/** Look up display info for any stored/selected value (id or API alias). */
export function findModelInfo(stored: string | null | undefined): AIModelInfo {
  const normalized = normalizeModelId(stored);
  return (
    SUPPORTED_MODELS.find((m) => m.id === normalized) ??
    SUPPORTED_MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ??
    SUPPORTED_MODELS[0]
  );
}
