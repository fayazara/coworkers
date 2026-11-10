import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { scriptPrompt, withSentTimes } from "./prompt"

const AT = Date.UTC(2026, 9, 26, 5, 41)

describe("withSentTimes", () => {
  it("stamps each user message with its own send time", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]
    const out = withSentTimes(messages, [AT, AT + 60_000], "UTC")
    expect(out[0].content).toBe(
      "first\n\n[Sent Monday, 26 October 2026 at 05:41]"
    )
    expect(out[1]).toBe(messages[1])
    expect(out[2].content).toEqual([
      { type: "text", text: "second" },
      { type: "text", text: "[Sent Monday, 26 October 2026 at 05:42]" },
    ])
  })

  it("matches from the end when older messages were compacted away", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "latest" }]
    const out = withSentTimes(messages, [AT - 86_400_000, AT], "UTC")
    expect(out[0].content).toBe(
      "latest\n\n[Sent Monday, 26 October 2026 at 05:41]"
    )
  })

  it("adds a message's note before its time", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "buy this" }]
    expect(
      withSentTimes(messages, [AT], "UTC", ["[Picked: variant 1]"])[0].content
    ).toBe(
      "buy this\n\n[Picked: variant 1]\n[Sent Monday, 26 October 2026 at 05:41]"
    )
  })

  it("leaves a message without a timestamp alone", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hi" }]
    expect(withSentTimes(messages, [undefined], "UTC")[0].content).toBe("hi")
  })
})

describe("scriptPrompt", () => {
  it("reports a finished script's result and output", () => {
    const text = scriptPrompt({
      runId: "js_1",
      purpose: "Close stale issues",
      outcome: {
        exitCode: 0,
        stdout: "closed 3\n",
        stderr: "",
        value: { closed: 3 },
      },
      background: false,
    })
    expect(text).toContain("[Script finished: js_1]")
    expect(text).toContain("It completed.")
    expect(text).toContain('"closed": 3')
    expect(text).toContain("closed 3")
    expect(text).not.toContain("stderr:")
    expect(text).not.toContain("background turn")
  })

  it("keeps only the end of long output", () => {
    const text = scriptPrompt({
      runId: "js_2",
      purpose: "Dump",
      outcome: { exitCode: 1, stdout: `${"a".repeat(5000)}END`, stderr: "" },
      background: false,
    })
    expect(text).toContain("It failed (exit code 1).")
    expect(text).toContain("END")
    expect(text).not.toContain("a".repeat(4500))
  })

  it("warns that a lost script may have partly run", () => {
    const text = scriptPrompt({
      runId: "js_3",
      purpose: "Send invoices",
      outcome: { lost: "it stopped responding" },
      background: true,
    })
    expect(text).toContain("did not finish: it stopped responding")
    expect(text).toContain("check their effects")
    expect(text).toContain("background turn")
  })
})
