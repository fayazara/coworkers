import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import { describeActivity, toBlocks, toTurn } from "./message-parts"

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

describe("toTurn", () => {
  const step = (id: string, state = "output-available") => ({
    type: "tool-browser_markdown",
    toolCallId: id,
    state,
    input: { url: "https://www.olx.in/items" },
    output: "ok",
  })

  it("shows updates between tool calls and folds only the steps", () => {
    const turn = toTurn(
      toBlocks(
        reply(
          { type: "text", text: "I'll compare prices on OLX." },
          step("1"),
          { type: "text", text: "Listings are in. Averaging by storage size." },
          step("2"),
          { type: "text", text: "The average is ₹41,000." }
        )
      )
    )
    expect(turn.work.map((c) => c.id)).toEqual(["1", "2"])
    expect(turn.shown.map((b) => b.kind)).toEqual(["text", "text", "text"])
    expect(turn.replyKey).toBe("m:4")
  })

  it("has no reply while a tool call is the last thing in the turn", () => {
    const turn = toTurn(
      toBlocks(
        reply(
          { type: "text", text: "Checking OLX." },
          step("1", "input-available")
        )
      )
    )
    expect(turn.replyKey).toBeUndefined()
    expect(describeActivity(turn.work[0])).toBe("Reading olx.in")
  })
})

describe("toBlocks for connect_app", () => {
  const part = {
    type: "tool-connect_app",
    toolCallId: "1",
    input: { name: "Linear", url: "https://mcp.linear.app/mcp", why: "x" },
  }

  it("keeps the card once connected, and one line when declined", () => {
    expect(
      toBlocks(
        reply({ ...part, state: "approval-requested", approval: { id: "a1" } })
      )
    ).toMatchObject([{ kind: "connect", call: { approvalId: "a1" } }])
    expect(
      toBlocks(
        reply({
          ...part,
          state: "output-available",
          output: { connected: true },
        })
      )
    ).toMatchObject([{ kind: "connect" }])
    expect(toBlocks(reply({ ...part, state: "output-denied" }))).toMatchObject([
      { kind: "event", label: "Linear not connected" },
    ])
  })
})

describe("show blocks", () => {
  const show = (state: string, blocks: unknown) => ({
    type: "tool-show",
    toolCallId: "s",
    state,
    input: { blocks },
  })
  const stats = {
    type: "stats",
    items: [{ label: "Median", value: "₹49,560" }],
  }

  it("draws while it streams, and is where the reply starts", () => {
    const blocks = toBlocks(
      reply(
        {
          type: "tool-browser_markdown",
          toolCallId: "1",
          state: "output-available",
          input: { url: "https://olx.in" },
        },
        { type: "text", text: "Half of these are dealers." },
        show("input-streaming", [stats]),
        { type: "text", text: "Prices are asking prices." }
      )
    )
    expect(blocks.map((b) => b.kind)).toEqual(["steps", "text", "show", "text"])
    expect(toTurn(blocks).replyKey).toBe("m:1")
  })

  it("starts the reply at the blocks when no text leads into them", () => {
    const blocks = toBlocks(reply(show("output-available", [stats])))
    expect(toTurn(blocks).replyKey).toBe("m:0")
  })
})
