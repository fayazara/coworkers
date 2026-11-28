import { describe, expect, it } from "vitest"
import { modelInfo, modelName, providerOf } from "./models"

describe("Command Code model", () => {
  const modelId = "dynamic/command-code"

  it("maps the dynamic route to its provider", () => {
    expect(providerOf(modelId)).toBe("command-code")
  })

  it("keeps the user-facing catalog name", () => {
    expect(modelInfo(modelId)?.name).toBe("DeepSeek V4.1 Flash")
    expect(modelName(modelId)).toBe("DeepSeek V4.1 Flash")
  })
})
