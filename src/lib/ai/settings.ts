export type AiProvider = "nvidia" | "openrouter" | "openai" | "anthropic";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export const AI_SETTINGS_STORAGE_KEY = "hooddesk-ai-settings";

export const AI_PROVIDER_OPTIONS: Array<{
  id: AiProvider;
  label: string;
  modelPlaceholder: string;
  defaultModel: string;
}> = [
  {
    id: "nvidia",
    label: "NVIDIA",
    modelPlaceholder: "meta/llama-3.1-70b-instruct",
    defaultModel: "meta/llama-3.1-70b-instruct",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    modelPlaceholder: "openai/gpt-4o-mini",
    defaultModel: "openai/gpt-4o-mini",
  },
  {
    id: "openai",
    label: "OpenAI",
    modelPlaceholder: "gpt-4o-mini",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    modelPlaceholder: "claude-3-5-haiku-latest",
    defaultModel: "claude-3-5-haiku-latest",
  },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "nvidia",
  model: AI_PROVIDER_OPTIONS[0].defaultModel,
  apiKey: "",
};

export function getProviderOption(provider: AiProvider) {
  return AI_PROVIDER_OPTIONS.find((option) => option.id === provider) ?? AI_PROVIDER_OPTIONS[0];
}

export function loadAiSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.sessionStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider = AI_PROVIDER_OPTIONS.some((option) => option.id === parsed.provider)
      ? (parsed.provider as AiProvider)
      : DEFAULT_AI_SETTINGS.provider;
    return {
      provider,
      model:
        typeof parsed.model === "string" && parsed.model
          ? parsed.model
          : getProviderOption(provider).defaultModel,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}
