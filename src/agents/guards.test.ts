import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"
import {
  KEEP_IMAGES,
  KEEP_PAGE_RESULTS,
  LoopGuard,
  MAX_IDENTICAL_CALLS,
  STOP_AFTER_MS,
  TurnBudget,
  UPDATE_AFTER_MS,
  WRAP_UP_AFTER_MS,
  MAX_TOOL_RESULT_CHARS,
  shapeToolResults,
  stableJson,
} from "./guards"

describe("stableJson", () => {
  it("ignores key order and undefined values", () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(
      stableJson({ a: [2, { d: 3 }], b: 1 })
    )
  })
})

describe("LoopGuard", () => {
  it("blocks only after the same call repeats too often", () => {
    const guard = new LoopGuard()
    for (let i = 0; i < MAX_IDENTICAL_CALLS; i++) {
      expect(guard.check("exec", { command: "ls" })).toBeNull()
    }
    expect(guard.check("exec", { command: "ls" })).toMatch(/Stop retrying/)
  })

  it("resets when any argument changes", () => {
    const guard = new LoopGuard()
    for (let i = 0; i < 20; i++) {
      expect(
        guard.check("browser_markdown", { url: `https://x.test/${i % 2}` })
      ).toBeNull()
    }
  })

  it("starts over after reset", () => {
    const guard = new LoopGuard()
    for (let i = 0; i <= MAX_IDENTICAL_CALLS; i++)
      guard.check("exec", { command: "ls" })
    guard.reset()
    expect(guard.check("exec", { command: "ls" })).toBeNull()
  })
})

function toolMessage(
  toolName: string,
  output: unknown,
  id: string
): ModelMessage {
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, toolName, output } as never,
    ],
  }
}

function outputOf(message: ModelMessage) {
  return (message.content as { output: { type: string; value: unknown } }[])[0]
    .output
}

describe("shapeToolResults", () => {
  it("returns null when nothing needs changing", () => {
    expect(
      shapeToolResults([
        toolMessage("exec", { type: "text", value: "ok" }, "1"),
      ])
    ).toBeNull()
  })

  it("caps any single result", () => {
    const big = "x".repeat(MAX_TOOL_RESULT_CHARS + 500)
    const shaped = shapeToolResults([
      toolMessage("exec", { type: "text", value: big }, "1"),
    ])!
    const value = String(outputOf(shaped[0]).value)
    expect(value.length).toBeLessThan(big.length)
    expect(value).toMatch(/Truncated/)
  })

  it("keeps only the newest large page results whole", () => {
    const page = "p".repeat(2_000)
    const messages = Array.from({ length: KEEP_PAGE_RESULTS + 2 }, (_, i) =>
      toolMessage("browser_markdown", { type: "text", value: page }, String(i))
    )
    const shaped = shapeToolResults(messages)!
    const shortened = shaped.filter((m) =>
      /shortened after you read it/.test(String(outputOf(m).value))
    )
    expect(shortened).toHaveLength(2)
    // The newest ones are the ones left alone.
    expect(String(outputOf(shaped.at(-1)!).value)).toBe(page)
  })

  it("drops all but the newest screenshots", () => {
    const shot = (id: string) =>
      toolMessage(
        "browser_screenshot",
        {
          type: "content",
          value: [
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "data", data: "AAAA" },
            },
          ],
        },
        id
      )
    const messages = Array.from({ length: KEEP_IMAGES + 2 }, (_, i) =>
      shot(String(i))
    )
    const shaped = shapeToolResults(messages)!
    const kept = shaped.filter((m) => {
      const value = outputOf(m).value as { type: string }[]
      return value[0].type === "file"
    })
    expect(kept).toHaveLength(KEEP_IMAGES)
  })

  it("leaves non-tool messages untouched", () => {
    const user: ModelMessage = { role: "user", content: "x".repeat(50_000) }
    expect(shapeToolResults([user])).toBeNull()
  })
})

describe("TurnBudget", () => {
  it("asks for an update after a quiet minute, again after the next one", () => {
    const budget = new TurnBudget()
    budget.start(0)
    expect(budget.check(UPDATE_AFTER_MS - 1)).toBeNull()
    expect(budget.check(UPDATE_AFTER_MS)?.kind).toBe("update")
    expect(budget.check(UPDATE_AFTER_MS + 1)).toBeNull()
    budget.spoke(70_000)
    expect(budget.check(70_000 + UPDATE_AFTER_MS)?.kind).toBe("update")
  })

  it("winds the turn down, then switches tools off, once each", () => {
    const budget = new TurnBudget()
    budget.start(0)
    budget.spoke(WRAP_UP_AFTER_MS)
    expect(budget.check(WRAP_UP_AFTER_MS)?.kind).toBe("wrap_up")
    budget.spoke(STOP_AFTER_MS)
    expect(budget.check(STOP_AFTER_MS)?.kind).toBe("stop")
    expect(budget.check(STOP_AFTER_MS + 1)).toBeNull()
  })

  it("does nothing before a turn starts", () => {
    expect(new TurnBudget().check(STOP_AFTER_MS * 2)).toBeNull()
  })
})
