import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  routineInstructionsOf,
  routinePrompt,
  scriptPrompt,
  watchChangeNote,
  watchChangeNoteOf,
  withSentTimes,
} from "./prompt"

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

const instructions =
  "Check https://example.com/status.\n\n- Report *only* outages\n- Use `curl -s`"

function trigger(onlyNew: boolean) {
  return routinePrompt({
    id: "r1",
    name: "Status page",
    prompt: instructions,
    onlyNew,
    reported: [{ key: "routine:r1:a", note: "Outage on Monday", at: 0 }],
    timeZone: "UTC",
  })
}

describe("routineInstructionsOf", () => {
  it("gets the routine's prompt back as written", () => {
    expect(routineInstructionsOf(trigger(false))).toBe(instructions)
    expect(routineInstructionsOf(trigger(true))).toBe(instructions)
  })
})

describe("watchChangeNoteOf", () => {
  const note = watchChangeNote(
    "https://example.com/status",
    "All systems *operational*",
    "## Degraded\n> API errors"
  )

  it("gets the change note back as it was sent", () => {
    expect(watchChangeNoteOf(trigger(true) + note)).toBe(note)
    expect(watchChangeNoteOf(trigger(false) + note)).toBe(note)
  })

  it("is empty for a run that no watch started", () => {
    expect(watchChangeNoteOf(trigger(true))).toBe("")
  })

  it("ignores the same words in the user's own prompt", () => {
    const text = routinePrompt({
      id: "r1",
      name: "Odd",
      prompt: `Say why.${note}`,
      onlyNew: false,
      reported: [],
      timeZone: "UTC",
    })
    expect(watchChangeNoteOf(text)).toBe("")
  })
})
