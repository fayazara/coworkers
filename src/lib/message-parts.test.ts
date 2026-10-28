import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import { describeCall, stepKind, toBlocks } from "./message-parts"

function reply(...parts: unknown[]): UIMessage {
  return { id: "m", role: "assistant", parts: parts as UIMessage["parts"] }
}

describe("toBlocks for cards", () => {
  it("shows a waiting ask_user as a choice card", () => {
    const blocks = toBlocks(
      reply({
        type: "tool-ask_user",
        toolCallId: "1",
        state: "approval-requested",
        input: { question: "Which TLDs?", options: [".com", ".dev"] },
        approval: { id: "a1" },
      })
    )
    expect(blocks).toMatchObject([
      { kind: "choice", call: { approvalId: "a1" } },
    ])
  })

  it("folds an answered ask_user into one line", () => {
    const blocks = toBlocks(
      reply({
        type: "tool-ask_user",
        toolCallId: "1",
        state: "output-available",
        input: { question: "Which TLDs?", options: [".com", ".dev"] },
        output: { answer: ".dev" },
      })
    )
    expect(blocks).toMatchObject([
      { kind: "event", label: "Which TLDs? · .dev" },
    ])
  })

  it("shows request_secret as a secret card, and never its value afterwards", () => {
    const waiting = toBlocks(
      reply({
        type: "tool-request_secret",
        toolCallId: "1",
        state: "approval-requested",
        input: {
          name: "GITHUB_TOKEN",
          origin: "https://api.github.com",
          purpose: "Read issues",
        },
        approval: { id: "a1" },
      })
    )
    expect(waiting).toMatchObject([{ kind: "secret" }])
    const done = toBlocks(
      reply({
        type: "tool-request_secret",
        toolCallId: "1",
        state: "output-available",
        input: { name: "GITHUB_TOKEN" },
        output: { saved: true },
      })
    )
    expect(done).toEqual([
      { kind: "event", key: "m:0", label: "Saved GITHUB_TOKEN" },
    ])
  })
})

describe("web search steps", () => {
  it("describes source discovery as a search step", () => {
    const call = {
      id: "search-1",
      name: "web_search",
      input: { objective: "Find Cloudflare product releases" },
      output: { results: [] },
      state: "done" as const,
    }
    expect(stepKind(call)).toBe("search")
    expect(describeCall(call)).toBe(
      "Searched the web: Find Cloudflare product releases"
    )
  })
})
