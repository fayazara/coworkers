import { describe, expect, it } from "vitest"
import { OPENING_USER_TURN, userFirst } from "./models"

const system = { role: "system", content: "Be brief." }
const greeting = { role: "assistant", content: [{ type: "text", text: "Hey." }] }
const ask = { role: "user", content: [{ type: "text", text: "What is in flight?" }] }

describe("userFirst", () => {
  it("opens a history that starts with the bot's greeting with a user turn", () => {
    const out = userFirst([system, greeting, ask])
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"])
    expect(out[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: OPENING_USER_TURN }],
    })
    expect(out[2]).toBe(greeting)
  })

  it("leaves a history that already opens with the user alone", () => {
    const prompt = [system, ask, greeting, ask]
    expect(userFirst(prompt)).toBe(prompt)
  })

  it("handles no system message and an empty prompt", () => {
    expect(userFirst([greeting, ask]).map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(userFirst([])).toEqual([])
    expect(userFirst([system])).toEqual([system])
  })
})
