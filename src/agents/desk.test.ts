import { describe, expect, it } from "vitest"
import type { DeskCard, ScriptApproval } from "@/lib/types"
import {
  DONE_KEEP_MS,
  askTitle,
  laneFor,
  linksIn,
  replyCard,
  scriptCard,
  titleOf,
  visibleCards,
  withoutTitle,
  withoutTrailingLinks,
  waitingCard,
} from "./desk"

describe("linksIn", () => {
  it("keeps the first three distinct links", () => {
    const text =
      "See [the invoice](https://a.com/1), [again](https://a.com/1), [b](https://b.com), [c](http://c.com) and [d](https://d.com)."
    expect(linksIn(text)).toEqual([
      { label: "the invoice", url: "https://a.com/1" },
      { label: "b", url: "https://b.com" },
      { label: "c", url: "http://c.com" },
    ])
  })

  it("ignores relative links", () => {
    expect(linksIn("[file](/workspace/a.txt)")).toEqual([])
  })
})

describe("titleOf", () => {
  it("takes the first sentence, without Markdown", () => {
    expect(
      titleOf("**Acme's invoice** is 12% higher. It was $400 last month.")
    ).toBe("Acme's invoice is 12% higher")
  })

  it("skips blank lines and drops a trailing colon", () => {
    expect(titleOf("\n\n## Three things changed:\n- a\n- b")).toBe(
      "Three things changed"
    )
  })

  it("clips a long line", () => {
    expect(titleOf("x".repeat(300)).length).toBe(110)
  })
})

describe("withoutTitle", () => {
  it("drops the sentence the title came from", () => {
    const text = "**Acme's invoice** is 12% higher. It was $400 last month."
    expect(withoutTitle(text, titleOf(text))).toBe("It was $400 last month.")
  })

  it("drops a heading line that became the title", () => {
    const text = "## Three things changed:\n- a\n- b"
    expect(withoutTitle(text, titleOf(text))).toBe("- a\n- b")
  })

  it("leaves the text alone when the title does not match", () => {
    expect(withoutTitle("Hello there. More.", "Something else")).toBe(
      "Hello there. More."
    )
  })
})

describe("withoutTrailingLinks", () => {
  it("drops the links a reply ends with", () => {
    expect(
      withoutTrailingLinks(
        "I opened an issue. [HN thread](https://a.com) · [Docs issue](https://b.com)"
      )
    ).toBe("I opened an issue.")
  })

  it("keeps links inside the text and text that is only links", () => {
    const inline = "See [the post](https://a.com) for details."
    expect(withoutTrailingLinks(inline)).toBe(inline)
    expect(withoutTrailingLinks("[Only](https://a.com)")).toBe(
      "[Only](https://a.com)"
    )
  })
})

describe("laneFor", () => {
  it("files findings, finished work, and nothing for pipelines", () => {
    expect(laneFor("check-in")).toBe("fyi")
    expect(laneFor("email")).toBe("fyi")
    expect(laneFor("routine")).toBe("done")
    expect(laneFor("chat")).toBe("done")
    expect(laneFor("pipeline")).toBeNull()
  })
})

describe("replyCard", () => {
  it("builds a card with a title, why and sources", () => {
    const card = replyCard({
      messageId: "m1",
      origin: "email",
      name: "billing@acme.com",
      text: "Acme sent a new invoice. [View it](https://acme.com/inv/9)",
      at: 1,
    })
    expect(card).toMatchObject({
      key: "reply:m1",
      lane: "fyi",
      title: "Acme sent a new invoice",
      why: "Email from billing@acme.com",
      sources: [{ label: "View it", url: "https://acme.com/inv/9" }],
      refs: { messageId: "m1" },
    })
  })

  it("quotes what the user asked for a long chat job", () => {
    expect(
      replyCard({
        messageId: "m",
        origin: "chat",
        name: "Find **flights** to Lisbon",
        text: "Found three.",
        at: 1,
      })?.why
    ).toBe("You asked: “Find flights to Lisbon”")
  })

  it("makes no card for empty text or pipelines", () => {
    const base = { messageId: "m", name: "", at: 1 }
    expect(replyCard({ ...base, origin: "check-in", text: "  " })).toBeNull()
    expect(replyCard({ ...base, origin: "pipeline", text: "Hi" })).toBeNull()
  })
})

describe("askTitle", () => {
  it("names app tools by what they do", () => {
    expect(askTitle("tool_c12ab_send_email", {})).toBe("Send email")
    expect(askTitle("app_tool_call", { tool: "create_event" })).toBe(
      "Create event"
    )
    expect(askTitle("exec", { command: "rm  -rf\n/tmp/x" })).toBe(
      "Run rm -rf /tmp/x"
    )
  })
})

describe("waitingCard", () => {
  const call = {
    approvalId: "a1",
    messageId: "m1",
    said: "I drafted the **reply** to Sam.",
    at: 5,
  }

  it("turns an approval into Approve / Not now", () => {
    const card = waitingCard({
      ...call,
      name: "app_tool_call",
      input: { tool: "send_email", args: { to: "sam@x.com" } },
    })
    expect(card).toMatchObject({
      key: "approval:a1",
      lane: "needs_you",
      title: "Send email",
      why: "I drafted the reply to Sam.",
      refs: { messageId: "m1", approvalId: "a1" },
    })
    expect(card.detail).toContain('"to": "sam@x.com"')
    expect(card.actions.map((a) => a.kind)).toEqual(["approve", "reject"])
  })

  it("sends skill installs to the chat, where they can be read", () => {
    const card = waitingCard({
      ...call,
      name: "install_skill",
      input: { source: "npx skills add owner/repo" },
    })
    expect(card.found).toBe("npx skills add owner/repo")
    expect(card.actions.map((a) => a.kind)).toEqual(["open_chat"])
  })

  it("sends questions to the chat", () => {
    const card = waitingCard({
      ...call,
      name: "ask_user",
      input: {
        question: "Which week?",
        options: ["This", { label: "Next", detail: "Zeke is back" }],
      },
    })
    expect(card.title).toBe("Which week?")
    expect(card.found).toBe("- This\n- Next: Zeke is back")
    expect(card.actions).toEqual([
      { id: "open", label: "Answer", kind: "open_chat" },
    ])
  })
})

describe("scriptCard", () => {
  const approval: ScriptApproval = {
    runId: "r",
    callId: "c",
    purpose: "Sync invoices",
    app: "Stripe",
    tool: "create_refund",
    toolName: "tool_c1_create_refund",
    argsJson: "{}",
    since: 9,
  }

  it("offers approve for the run when the tool is known", () => {
    const card = scriptCard(approval)
    expect(card.title).toBe("Create refund in Stripe")
    expect(card.why).toBe("Script · Sync invoices")
    expect(card.detail).toBeUndefined()
    expect(card.actions.map((a) => a.kind)).toEqual([
      "approve",
      "approve_all",
      "reject",
    ])
  })
})

describe("visibleCards", () => {
  const card = (patch: Partial<DeskCard>): DeskCard => ({
    id: "b:k",
    botId: "b",
    key: "k",
    lane: "fyi",
    origin: "check-in",
    title: "",
    why: "",
    found: "",
    sources: [],
    actions: [],
    refs: {},
    createdAt: 0,
    status: "open",
    ...patch,
  })

  it("shows open cards newest first and hides closed or stale ones", () => {
    const now = DONE_KEEP_MS * 2
    const shown = visibleCards(
      [
        card({ id: "old-done", lane: "done", createdAt: 1 }),
        card({ id: "fresh-done", lane: "done", createdAt: now - 10 }),
        card({ id: "dismissed", status: "dismissed", createdAt: now }),
        card({ id: "ask", lane: "needs_you", createdAt: 1 }),
      ],
      now
    )
    expect(shown.map((c) => c.id)).toEqual(["fresh-done", "ask"])
  })

  it("brings a due snoozed card back on top", () => {
    const shown = visibleCards(
      [
        card({ id: "a", createdAt: 50 }),
        card({ id: "s", status: "snoozed", snoozeUntil: 90, createdAt: 1 }),
        card({ id: "later", status: "snoozed", snoozeUntil: 500 }),
      ],
      100
    )
    expect(shown.map((c) => [c.id, c.status])).toEqual([
      ["s", "open"],
      ["a", "open"],
    ])
  })
})
