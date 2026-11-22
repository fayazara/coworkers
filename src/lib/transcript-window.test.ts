import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import {
  CLIENT_MESSAGES,
  droppedFromFront,
  olderThan,
  windowFrame,
  withEarlier,
} from "./transcript-window"

const msg = (id: string): UIMessage => ({ id, role: "user", parts: [] })
const many = (n: number) => Array.from({ length: n }, (_, i) => msg(`m${i}`))

describe("windowFrame", () => {
  it("cuts a long chat-messages frame to the newest messages", () => {
    const frame = {
      type: "cf_agent_chat_messages",
      messages: many(CLIENT_MESSAGES + 10),
      connect: true,
    }
    const out = windowFrame(frame)
    expect(out.messages).toHaveLength(CLIENT_MESSAGES)
    expect(out.messages[0].id).toBe("m10")
    expect(out.connect).toBe(true)
  })

  it("leaves short chats and other frames alone", () => {
    const short = { type: "cf_agent_chat_messages", messages: many(3) }
    expect(windowFrame(short)).toBe(short)
    const other = { type: "cf_agent_message_updated", messages: many(99) }
    expect(windowFrame(other)).toBe(other)
  })
})

describe("olderThan", () => {
  it("returns the messages just before one, oldest first", () => {
    const all = many(100)
    expect(olderThan(all, "m50", 3).map((m) => m.id)).toEqual([
      "m47",
      "m48",
      "m49",
    ])
    expect(olderThan(all, "m2", 10).map((m) => m.id)).toEqual(["m0", "m1"])
  })

  it("returns nothing for the first message or an unknown one", () => {
    expect(olderThan(many(5), "m0")).toEqual([])
    expect(olderThan(many(5), "nope")).toEqual([])
  })
})

describe("droppedFromFront", () => {
  it("keeps what a new message pushed out of the window", () => {
    const before = [msg("a"), msg("b"), msg("c")]
    const after = [msg("b"), msg("c"), msg("d")]
    expect(droppedFromFront(before, after).map((m) => m.id)).toEqual(["a"])
  })

  it("finds nothing when the window did not move", () => {
    const list = [msg("a"), msg("b")]
    expect(droppedFromFront(list, [...list, msg("c")])).toEqual([])
    expect(droppedFromFront([], list)).toEqual([])
  })
})

describe("withEarlier", () => {
  it("puts earlier messages above the window without repeats", () => {
    const out = withEarlier([msg("a"), msg("b")], [msg("b"), msg("c")])
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"])
  })
})
