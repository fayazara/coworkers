import { createAI } from "agents/models/ai-sdk"
import { wrapLanguageModel } from "ai"
import type { CloudflareLanguageModelId } from "agents/models/ai-sdk"
import { DEFAULT_MODEL_SETTINGS, providerOf } from "@/lib/models"
import type { DeploymentModels, ModelSettings } from "@/lib/models"

type ModelEnv = Pick<
  Env,
  "AI" | "AI_GATEWAY_ID" | "MODEL" | "BACKGROUND_MODEL" | "FALLBACK_MODEL"
>

/** The gateway every model call goes through. "default" is auto-created. */
export function gatewayId(env: ModelEnv) {
  return env.AI_GATEWAY_ID?.trim() || "default"
}

export function deploymentModels(env: ModelEnv): DeploymentModels {
  return {
    chat: env.MODEL,
    background: env.BACKGROUND_MODEL?.trim() || null,
    fallback: env.FALLBACK_MODEL?.trim() || null,
    gateway: gatewayId(env),
  }
}

/**
 * Which model a turn runs on. A bot's own model wins for chat; background
 * turns use the account's background model, then the deployment's, then
 * whatever chat would use.
 */
export function pickModel(
  env: ModelEnv,
  settings: ModelSettings = DEFAULT_MODEL_SETTINGS,
  botModel: string | null | undefined,
  background: boolean
) {
  const chat = botModel || settings.chat || env.MODEL
  if (!background) return chat
  return settings.background || env.BACKGROUND_MODEL?.trim() || chat
}

/**
 * An AI SDK model for `modelId`, through AI Gateway on the `AI` binding.
 * `metadata` lands on the gateway log, so each bot's traffic can be told
 * apart in AI Gateway analytics.
 *
 * A third-party model gets the deployment's FALLBACK_MODEL as a fallback
 * when `settings.fallback` is on: no credits, no key or a provider outage
 * then degrades the answer instead of breaking the bot.
 */
export function languageModel(
  env: ModelEnv,
  modelId: string,
  options: {
    settings?: ModelSettings
    metadata?: Record<string, string>
  } = {}
) {
  const ai = createAI({ binding: env.AI, gateway: gatewayId(env) })
  const settings = options.settings ?? DEFAULT_MODEL_SETTINGS
  const safety = env.FALLBACK_MODEL?.trim() ?? ""
  const fallback =
    settings.fallback &&
    providerOf(modelId) !== "workers-ai" &&
    providerOf(safety) === "workers-ai" &&
    safety !== modelId
      ? [safety as CloudflareLanguageModelId]
      : undefined
  const model = ai(modelId as CloudflareLanguageModelId, {
    ...(fallback ? { fallback } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  })
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        prompt: userFirst(params.prompt),
      }),
    },
  })
}

/** The user turn put in front of a history that opens with the bot. */
export const OPENING_USER_TURN = "(Chat opened.)"

/**
 * A prompt whose first non-system message is the user's. Every bot opens
 * with its own greeting, and Anthropic's API requires the first turn to be
 * the user's: AI Gateway's conversion of a chat-completions body into
 * Anthropic's format answers `Format conversion failed: No compatible input
 * messages found` (code 7003) when the history starts with an assistant
 * message, so a bot on an Anthropic model could never answer its first
 * chat. A short user turn in front of the greeting keeps the greeting in
 * context and satisfies the provider; a history that already opens with
 * the user is returned as is.
 */
export function userFirst<M extends { role: string }>(prompt: M[]): M[] {
  const first = prompt.findIndex((m) => m.role !== "system")
  if (first === -1 || prompt[first].role !== "assistant") return prompt
  const opening = {
    role: "user",
    content: [{ type: "text", text: OPENING_USER_TURN }],
  } as unknown as M
  return [...prompt.slice(0, first), opening, ...prompt.slice(first)]
}
