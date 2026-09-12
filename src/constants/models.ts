export interface AIModelInfo {
  id: string;
  /** Exact model ID to send to the provider API. */
  apiModelId: string;
  name: string;
  provider: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude';
  providerId: 'gemini' | 'openai' | 'xai' | 'anthropic';
  badge?: string;
  /** Verified context window as of Sept 2026 (for prompt budgeting). */
  contextWindow?: number;
  /** Date this entry was last verified against official provider docs. */
  verifiedAsOf?: string;
}

export const PROVIDER_LIST: Array<{
  id: 'gemini' | 'openai' | 'xai' | 'anthropic';
  name: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude';
  keyPlaceholder: string;
}> = [
  { id: 'gemini', name: 'Gemini', keyPlaceholder: 'Google AI Studio API Key (Optional)' },
  { id: 'openai', name: 'ChatGPT', keyPlaceholder: 'OpenAI API Key (sk-...)' },
  { id: 'xai', name: 'Grok', keyPlaceholder: 'xAI API Key (xai-...)' },
  { id: 'anthropic', name: 'Claude', keyPlaceholder: 'Anthropic API Key (sk-ant-...)' },
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
 */
export const SUPPORTED_MODELS: AIModelInfo[] = [
  // Gemini (API ID == UI ID, 1M context) — primary engine is Gemini 3.8 Flash, with automatic high-demand quota fallback to Gemini 3.7 Flash and Gemini 3.6 Flash
  { id: 'gemini-3.8-flash', apiModelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Primary', contextWindow: 1_000_000, verifiedAsOf: '2026-09-11' },
  { id: 'gemini-3.7-flash', apiModelId: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Fallback Tier 1', contextWindow: 1_000_000, verifiedAsOf: '2026-09-11' },
  { id: 'gemini-3.6-flash', apiModelId: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Fallback Tier 2', contextWindow: 1_000_000, verifiedAsOf: '2026-09-11' },

  // ChatGPT (OpenAI) — efficiency-focused GPT-5.6 Luna
  { id: 'gpt-5.6-luna', apiModelId: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'ChatGPT', providerId: 'openai', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },

  // Grok (xAI) — 500K context. API ID keeps the DOT.
  { id: 'grok-4.6', apiModelId: 'grok-4.6', name: 'Grok 4.6', provider: 'Grok', providerId: 'xai', contextWindow: 500_000, verifiedAsOf: '2026-09-06' },

  // Claude (Anthropic) — strictly efficiency-focused Claude Sonnet 5
  { id: 'claude-sonnet-5', apiModelId: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Claude', providerId: 'anthropic', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
];

/** Default model when nothing valid is stored/selected. */
export const DEFAULT_MODEL_ID = 'gemini-3.8-flash';

/**
 * Ordered fallback cascade for Gemini Flash models.
 * If Gemini 3.8 Flash encounters high demand or exceeded quota warnings,
 * the engine automatically falls back to Gemini 3.7 Flash, and if high demand persists,
 * cascades to Gemini 3.6 Flash.
 */
export const GEMINI_FALLBACK_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
] as const;

/** Default efficiency model mapped to each provider. */
export const PROVIDER_DEFAULT_MODELS: Record<
  'gemini' | 'openai' | 'xai' | 'anthropic',
  string
> = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-5.6-luna',
  xai: 'grok-4.6',
  anthropic: 'claude-sonnet-5',
};

/**
 * Normalize any stored/selected value to the canonical UI `id`.
 * - Historic bug: the app once stored "claude-fable-5.1" (dot), which is not a
 *   valid Anthropic API ID (must be "claude-fable-5-1" with hyphen).
 * - Supported model aliases are canonicalized to their UI id
 *   so state NEVER holds a non-id value.
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
