import { describe, expect, it, vi } from "vitest"

const { model } = vi.hoisted(() => ({
  model: vi.fn(() => ({ modelId: "test-model" })),
}))

vi.mock("agents/models/ai-sdk", () => ({
  createAI: vi.fn(() => model),
}))

import { languageModel, sessionAffinityForBot } from "./models"

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "coworkers",
  MODEL: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  BACKGROUND_MODEL: "",
  FALLBACK_MODEL: "",
} as unknown as Parameters<typeof languageModel>[0]

describe("Workers AI session affinity", () => {
  it("keeps the key stable for a bot and separate between bots", () => {
    expect(sessionAffinityForBot("user-1", "bot-1")).toBe(
      "coworkers:user-1:bot-1"
    )
    expect(sessionAffinityForBot("user-1", "bot-2")).not.toBe(
      sessionAffinityForBot("user-1", "bot-1")
    )
  })

  it("forwards session affinity to the Workers AI model", () => {
    languageModel(env, env.MODEL, {
      settings: { chat: null, background: null, fallback: false },
      sessionAffinity: sessionAffinityForBot("user-1", "bot-1"),
    })

    expect(model).toHaveBeenCalledWith(
      env.MODEL,
      expect.objectContaining({
        sessionAffinity: "coworkers:user-1:bot-1",
      })
    )
  })
})
