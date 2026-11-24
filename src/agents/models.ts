import { createAI } from "agents/models/ai-sdk"
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

/** Stable replica key for one bot across chat and background turns. */
export function sessionAffinityForBot(userId: string, botId: string) {
  return `coworkers:${userId}:${botId}`
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
    sessionAffinity?: string
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
  return ai(modelId as CloudflareLanguageModelId, {
    ...(fallback ? { fallback } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.sessionAffinity
      ? { sessionAffinity: options.sessionAffinity }
      : {}),
  })
}
