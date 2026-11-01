import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import { toBlocks } from "./message-parts"

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

  it("shows install_skill as its own card, then as one line", () => {
    const part = {
      type: "tool-install_skill",
      toolCallId: "1",
      input: { source: "owner/repo" },
    }
    expect(
      toBlocks(
        reply({ ...part, state: "approval-requested", approval: { id: "a1" } })
      )
    ).toMatchObject([{ kind: "skill", call: { approvalId: "a1" } }])
    expect(
      toBlocks(
        reply({
          ...part,
          state: "output-available",
          output: { installed: ["one"] },
        })
      )
    ).toMatchObject([{ kind: "event", label: "Installed one" }])
    expect(toBlocks(reply({ ...part, state: "output-denied" }))).toMatchObject([
      { kind: "event", label: "Skill not installed" },
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
