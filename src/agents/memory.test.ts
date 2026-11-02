import { describe, expect, it } from "vitest"
import { MAX_MEMORY_CHARS, appendFact } from "./memory"

describe("appendFact", () => {
  it("appends a bullet", () => {
    expect(appendFact("", "Prefers tables")).toEqual({
      content: "- Prefers tables",
    })
    expect(appendFact("- A", "B")).toEqual({ content: "- A\n- B" })
  })

  it("skips a fact that is already there, ignoring case and punctuation", () => {
    expect(appendFact("- Prefers tables.", "prefers   tables")).toEqual({
      duplicate: true,
    })
  })

  it("refuses to overflow", () => {
    const full = `- ${"x".repeat(MAX_MEMORY_CHARS - 5)}`
    expect(appendFact(full, "one more fact")).toHaveProperty("error")
  })
})
