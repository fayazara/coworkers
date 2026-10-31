/**
 * Chat models bots can run on. Every call goes through AI Gateway on the
 * Worker's `AI` binding: "@cf/…" ids run on Workers AI, "<provider>/<model>"
 * ids are AI Gateway catalog models, billed with Unified Billing credits or a
 * provider key stored on the gateway. Shared with the client: no server-only
 * imports.
 *
 * Ids are the gateway's own spelling (`claude-sonnet-5.5`, not
 * `claude-sonnet-5-5`); see https://developers.cloudflare.com/ai/models/.
 * Only models that call tools are listed, since bots cannot work without
 * them. Anything else can still be entered as a custom id. Each provider's
 * first model is the one picked when you switch to it: a balanced choice,
 * not the most expensive.
 */

export type ProviderId =
  | "workers-ai"
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "command-code"

export interface ModelProvider {
  id: ProviderId
  name: string
  /** Shown under the picker. */
  billing: string
}

export interface ModelInfo {
  id: string
  provider: ProviderId
  name: string
  /** A few words on what it is good at. */
  blurb: string
  /** Tokens. */
  context: number
  /**
   * USD per million input and output tokens (short-context rate). Absent
   * where the catalog does not list one.
   */
  price?: [input: number, output: number]
}

export const PROVIDERS: ModelProvider[] = [
  {
    id: "workers-ai",
    name: "Workers AI",
    billing: "Runs on Cloudflare's GPUs. Nothing to set up.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    billing: "Unified Billing credits or an Anthropic key on the gateway.",
  },
  {
    id: "openai",
    name: "OpenAI",
    billing: "Unified Billing credits or an OpenAI key on the gateway.",
  },
  {
    id: "google",
    name: "Google",
    billing:
      "Unified Billing credits or a Google AI Studio key on the gateway.",
  },
  {
    id: "xai",
    name: "xAI",
    billing: "Unified Billing credits or an xAI key on the gateway.",
  },
  {
    id: "command-code",
    name: "Command Code",
    billing: "Uses the Command Code key through an AI Gateway dynamic route.",
  },
]

export const MODELS: ModelInfo[] = [
  // Workers AI
  {
    id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    provider: "workers-ai",
    name: "DeepSeek V4.1 Flash",
    blurb: "Fast and cheap, good default",
    context: 1_048_576,
    price: [0.3, 1.2],
  },
  {
    id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    provider: "workers-ai",
    name: "DeepSeek V4 Pro",
    blurb: "Stronger reasoning",
    context: 1_048_576,
    price: [1.32, 3.96],
  },
  {
    id: "@cf/moonshotai/kimi-k2.7-code",
    provider: "workers-ai",
    name: "Kimi K2.7 Code",
    blurb: "Agentic coding",
    context: 262_144,
    price: [0.95, 4],
  },
  {
    id: "@cf/zai-org/glm-5.3",
    provider: "workers-ai",
    name: "GLM 5.3",
    blurb: "Long-horizon agent work",
    context: 1_048_576,
    price: [1.4, 4.4],
  },
  {
    id: "@cf/zai-org/glm-5.3-flash",
    provider: "workers-ai",
    name: "GLM 5.3 Flash",
    blurb: "Cheap background work",
    context: 1_048_576,
    price: [0.15, 0.5],
  },
  {
    id: "@cf/qwen/qwen3.8-27b",
    provider: "workers-ai",
    name: "Qwen 3.8 27B",
    blurb: "Small and capable",
    context: 262_144,
    price: [0.45, 3.2],
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    provider: "workers-ai",
    name: "gpt-oss 120B",
    blurb: "OpenAI's open weights",
    context: 128_000,
    price: [0.35, 0.75],
  },
  // Anthropic
  {
    id: "anthropic/claude-sonnet-5.5",
    provider: "anthropic",
    name: "Claude Sonnet 5.5",
    blurb: "Speed and intelligence",
    context: 1_000_000,
    price: [2, 10],
  },
  {
    id: "anthropic/claude-opus-5.5",
    provider: "anthropic",
    name: "Claude Opus 5.5",
    blurb: "Long-running agentic work",
    context: 1_000_000,
    price: [4, 20],
  },
  {
    id: "anthropic/claude-haiku-5.5",
    provider: "anthropic",
    name: "Claude Haiku 5.5",
    blurb: "Fast, for high volume",
    context: 1_000_000,
    price: [0.1, 0.5],
  },
  // OpenAI
  {
    id: "openai/gpt-6.1-sol",
    provider: "openai",
    name: "GPT-6.1 Sol",
    blurb: "Near-Astra for less",
    context: 1_050_000,
    price: [2, 10],
  },
  {
    id: "openai/gpt-6-astra",
    provider: "openai",
    name: "GPT-6 Astra",
    blurb: "Most capable",
    context: 1_050_000,
    price: [10, 50],
  },
  {
    id: "openai/gpt-6-luna",
    provider: "openai",
    name: "GPT-6 Luna",
    blurb: "Efficient, for high volume",
    context: 1_050_000,
    price: [0.1, 0.5],
  },
  {
    id: "openai/gpt-5.5",
    provider: "openai",
    name: "GPT-5.5",
    blurb: "Previous flagship",
    context: 1_000_000,
    price: [5, 30],
  },
  // Google
  {
    id: "google/gemini-3.8-flash",
    provider: "google",
    name: "Gemini 3.8 Flash",
    blurb: "Fast agents",
    context: 1_048_576,
    price: [0.75, 3.75],
  },
  {
    id: "google/gemini-4-argon",
    provider: "google",
    name: "Gemini 4 Argon",
    blurb: "Frontier, for deep work",
    context: 1_048_576,
    price: [2, 10],
  },
  {
    id: "google/gemini-3.1-pro",
    provider: "google",
    name: "Gemini 3.1 Pro",
    blurb: "Strong reasoning",
    context: 1_000_000,
  },
  // xAI
  {
    id: "xai/grok-4.7",
    provider: "xai",
    name: "Grok 4.7",
    blurb: "Frontier reasoning",
    context: 500_000,
  },
  {
    id: "xai/grok-4.6",
    provider: "xai",
    name: "Grok 4.6",
    blurb: "Coding and agents",
    context: 500_000,
  },
  // Command Code custom provider
  {
    id: "dynamic/command-code",
    provider: "command-code",
    name: "DeepSeek V4.1 Flash",
    blurb: "Fast and cheap through your Command Code plan",
    context: 1_000_000,
    price: [0.15, 0.6],
  },
]

/** Which provider a model id belongs to; null for one this app does not know. */
export function providerOf(modelId: string): ProviderId | null {
  if (modelId.startsWith("@cf/")) return "workers-ai"
  if (modelId === "dynamic/command-code") return "command-code"
  const prefix = modelId.split("/")[0]
  return PROVIDERS.some((p) => p.id === prefix) ? (prefix as ProviderId) : null
}

export function modelInfo(modelId: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === modelId)
}

/** Short display name: the catalog name, else the id without its provider. */
export function modelName(modelId: string) {
  return modelInfo(modelId)?.name ?? modelId.replace(/^@cf\//, "")
}

/** Ids `createAI` resolves: "@cf/…", "<provider>/<model>" or "dynamic/<route>". */
export function isModelId(value: string) {
  return /^(@cf\/)?[a-z0-9][\w.-]*\/[\w.:@-]+(\/[\w.:@-]+)*$/i.test(value)
}

/**
 * Which models bots use. Stored on the UserHub; null falls back to the
 * deployment's MODEL / BACKGROUND_MODEL.
 */
export interface ModelSettings {
  chat: string | null
  /** Routines, check-ins and email. Null uses the chat model. */
  background: string | null
  /**
   * When a non-Workers AI model fails before answering (no credits, no key,
   * provider outage), retry the turn on the deployment's FALLBACK_MODEL.
   */
  fallback: boolean
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  chat: null,
  background: null,
  fallback: false,
}

/** What the deployment itself is configured with, for labels and fallback. */
export interface DeploymentModels {
  chat: string
  background: string | null
  /** Workers AI model a failed third-party turn retries on. */
  fallback: string | null
  /** AI Gateway every call goes through. */
  gateway: string
}

/** Result of a one-line test call from the Models page. */
export type ModelTestResult =
  | { ok: true; ms: number; reply: string; logId?: string }
  | {
      ok: false
      ms: number
      /** Coarse reason, from the gateway's error code. */
      code: string
      message: string
    }

export function formatContext(tokens: number) {
  return tokens >= 1_000_000
    ? `${Math.round(tokens / 100_000) / 10}M`
    : `${Math.round(tokens / 1000)}K`
}

export function formatPrice([input, output]: [number, number]) {
  const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
  return `${usd(input)} in · ${usd(output)} out per 1M`
}
