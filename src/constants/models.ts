export interface AIModelInfo {
  id: string;
  /** Exact model ID to send to the provider API. */
  apiModelId: string;
  name: string;
  provider: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude';
  providerId: 'gemini' | 'openai' | 'spacexai' | 'anthropic';
  badge?: string;
  /** Verified context window as of Sept 2026 (for prompt budgeting). */
  contextWindow?: number;
  /** Date this entry was last verified against official provider docs. */
  verifiedAsOf?: string;
}

export const PROVIDER_LIST: Array<{
  id: 'gemini' | 'openai' | 'spacexai' | 'anthropic';
  name: 'Gemini' | 'ChatGPT' | 'Grok' | 'Claude';
  keyPlaceholder: string;
}> = [
  { id: 'gemini', name: 'Gemini', keyPlaceholder: 'Google AI Studio API Key (Optional)' },
  { id: 'openai', name: 'ChatGPT', keyPlaceholder: 'OpenAI API Key (sk-...)' },
  { id: 'spacexai', name: 'Grok', keyPlaceholder: 'Grok API Key (xai-...)' },
  { id: 'anthropic', name: 'Claude', keyPlaceholder: 'Anthropic API Key (sk-ant-...)' },
];

/**
 * SUPPORTED MODELS — verified live as of September 12, 2026.
 *
 * Sources checked:
 * - Gemini: https://ai.google.dev/gemini-api/docs/models + GA notes:
 *   gemini-3.5-flash (May 19 2026), gemini-3.6-flash (July 21 2026),
 *   gemini-3.7-flash (Aug 13 2026), gemini-3.8-flash (Sept 2 2026).
 *   gemini-3-flash deprecated July 31 2026 (kept ONLY as last-resort fallback).
 *   gemini-1.5-flash and all 1.5/2.0 variants are shut down — NEVER listed.
 *   BenchLM Sept 4 2026 ranking confirms 3.5/3.6/3.7/3.8 Flash.
  * - OpenAI: https://developers.openai.com/api/docs/models — gpt-5.6-luna
  *   (June 26 2026, 1.05M ctx).
  * - SpaceXAI (rebranded from xAI July 6, 2026 after SpaceX acquisition Feb 2026):
  *   https://docs.x.ai/developers/models/grok-4.6 — grok-4.6 (Aug 12 2026, 500K ctx).
  *   SpaceXAI is the company/brand, Grok is the product surfaced in the UI.
  *   API endpoint (api.x.ai) and key prefix (xai-...) unchanged as of Sept 2026 docs.
  *   NOTE: the API ID uses a DOT (grok-4.6), not a hyphen.
  * - Anthropic: https://platform.claude.com/docs/en/models/overview — claude-sonnet-5
  *   (June 30 2026).
  */
export const SUPPORTED_MODELS: AIModelInfo[] = [
  // Gemini (API ID == UI ID, 1M context) — primary 3.8, auto fallback 3.7 -> 3.6 -> 3.5 -> 3-flash (last resort). 1.5-flash NEVER used (deprecated/shut down).
  { id: 'gemini-3.8-flash', apiModelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Primary', contextWindow: 1_000_000, verifiedAsOf: '2026-09-12' },
  { id: 'gemini-3.7-flash', apiModelId: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Fallback Tier 1', contextWindow: 1_000_000, verifiedAsOf: '2026-09-12' },
  { id: 'gemini-3.6-flash', apiModelId: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Fallback Tier 2', contextWindow: 1_000_000, verifiedAsOf: '2026-09-12' },
  { id: 'gemini-3.5-flash', apiModelId: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Fallback Tier 3', contextWindow: 1_000_000, verifiedAsOf: '2026-09-12' },
  { id: 'gemini-3-flash', apiModelId: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'Gemini', providerId: 'gemini', badge: 'Last resort', contextWindow: 1_000_000, verifiedAsOf: '2026-09-12' },

  // ChatGPT (OpenAI) — efficiency-focused GPT-5.6 Luna
  { id: 'gpt-5.6-luna', apiModelId: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'ChatGPT', providerId: 'openai', contextWindow: 1_050_000, verifiedAsOf: '2026-09-06' },

  // Grok (SpaceXAI brand) — 500K context. API ID keeps the DOT.
  { id: 'grok-4.6', apiModelId: 'grok-4.6', name: 'Grok 4.6', provider: 'Grok', providerId: 'spacexai', contextWindow: 500_000, verifiedAsOf: '2026-09-06' },

  // Claude (Anthropic) — strictly efficiency-focused Claude Sonnet 5
  { id: 'claude-sonnet-5', apiModelId: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Claude', providerId: 'anthropic', contextWindow: 1_000_000, verifiedAsOf: '2026-09-06' },
];

/** Default model when nothing valid is stored/selected. */
export const DEFAULT_MODEL_ID = 'gemini-3.8-flash';

/**
 * Ordered fallback cascade for Gemini Flash models.
 * Verified Sept 12, 2026. If Gemini 3.8 Flash hits high demand/quota,
 * cascade 3.8 -> 3.7 -> 3.6 -> 3.5 -> 3-flash (last resort).
 * gemini-1.5-flash is deprecated/shut down and is NEVER in this chain.
 * In particular: 3.6-flash -> 3.5-flash -> 3-flash.
 */
export const GEMINI_FALLBACK_CASCADE = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash',
] as const;

/** Default efficiency model mapped to each provider. */
export const PROVIDER_DEFAULT_MODELS: Record<
  'gemini' | 'openai' | 'spacexai' | 'anthropic',
  string
> = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-5.6-luna',
  spacexai: 'grok-4.6',
  anthropic: 'claude-sonnet-5',
};

/**
 * Normalize any stored/selected value to the canonical UI `id`.
 * - Deprecated Gemini ids (1.5/2.x) remap to the supported cascade target
 *   (3.5-flash) so stale localStorage can never request a dead model.
 * - Unsupported/retired model ids fall back to the default below.
 * - Supported model aliases are canonicalized to their UI id
 *   so state NEVER holds a non-id value.
 */
export function normalizeModelId(stored: string | null | undefined): string {
  if (!stored) return DEFAULT_MODEL_ID;
  const deprecatedRemap: Record<string, string> = {
    'gemini-1.5-flash': 'gemini-3.5-flash',
    'gemini-1.5-flash-001': 'gemini-3.5-flash',
    'gemini-1.5-flash-002': 'gemini-3.5-flash',
    'gemini-1.5-flash-8b': 'gemini-3.5-flash',
    'gemini-1.5-pro': 'gemini-3.5-flash',
    'gemini-2.0-flash': 'gemini-3.5-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
  };
  if (deprecatedRemap[stored]) return deprecatedRemap[stored];
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
