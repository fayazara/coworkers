import { describe, expect, it } from "vitest"
import type { AppTool, AppToolCallLog } from "@/lib/types"
import {
  MAX_TOOL_ARGS_BYTES,
  MAX_TOOL_LOG,
  TOOL_LIMITS,
  approvalKey,
  approvedGrants,
  decideToolCall,
  pushToolLog,
  resolveGrants,
} from "./app-tools"
import { EMPTY_WINDOW, takeSubmitSlot } from "./app-access"

const tool = (
  connectionId: string,
  connectionName: string,
  name: string,
  readOnly: boolean
): AppTool => ({
  connectionId,
  connectionName,
  name,
  description: `${name} on ${connectionName}`,
  inputSchema: {},
  readOnly,
})

const nameOf = (t: AppTool) => `tool_c${t.connectionId}_${t.name}`

const freebusy = tool("gcal", "Google Calendar", "query_freebusy", true)
const createEvent = tool("gcal", "Google Calendar", "create_event", false)
const deleteEvent = tool("gcal", "Google Calendar", "delete_event", false)
const notionAdd = tool("notion", "Notion", "create_page", false)
const catalog = [freebusy, createEvent, deleteEvent, notionAdd]

const FREEBUSY = "tool_cgcal_query_freebusy"
const CREATE = "tool_cgcal_create_event"

describe("resolveGrants", () => {
  it("turns tool names into grants with their app and kind", () => {
    expect(resolveGrants([FREEBUSY, CREATE], catalog, nameOf)).toEqual([
      {
        name: FREEBUSY,
        connectionId: "gcal",
        tool: "query_freebusy",
        app: "Google Calendar",
        readOnly: true,
        description: "query_freebusy on Google Calendar",
      },
      expect.objectContaining({ name: CREATE, readOnly: false }),
    ])
  })

  it("drops duplicates and blanks", () => {
    expect(
      resolveGrants([FREEBUSY, ` ${FREEBUSY} `, ""], catalog, nameOf)
    ).toHaveLength(1)
  })

  it("refuses a tool the user has not connected, naming it", () => {
    expect(() =>
      resolveGrants(["tool_cgmail_send_email"], catalog, nameOf)
    ).toThrow(/tool_cgmail_send_email/)
  })

  it("caps how many tools one app can ask for", () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      tool("x", "X", `t${i}`, true)
    )
    expect(() => resolveGrants(many.map(nameOf), many, nameOf)).toThrow(
      /at most 10/
    )
  })
})

describe("use case: a live booking page on Google Calendar", () => {
  const grants = resolveGrants([FREEBUSY, CREATE], catalog, nameOf)
  const call = (
    name: string,
    approved: string[],
    args: unknown = {},
    cat = catalog
  ) => decideToolCall({ name, args, grants, approved, catalog: cat, nameOf })

  it("nothing runs until the user allows it", () => {
    const d = call(FREEBUSY, [])
    expect(d).toMatchObject({ ok: false, status: 403 })
    if (!d.ok) expect(d.error).toMatch(/Apps tab/)
  })

  it("once allowed, free/busy and create event both run", () => {
    const approved = grants.map(approvalKey)
    expect(call(FREEBUSY, approved, { timeMin: "x" }).ok).toBe(true)
    expect(call(CREATE, approved, { summary: "Call" }).ok).toBe(true)
  })

  it("allowing reads only does not allow the write", () => {
    const approved = [approvalKey(grants[0]!)]
    expect(call(FREEBUSY, approved).ok).toBe(true)
    expect(call(CREATE, approved).ok).toBe(false)
  })

  it("a tool the app did not ask for is out of reach, even on the same app", () => {
    const approved = grants.map(approvalKey)
    // server.js asking for delete_event: the code tried, the grant says no.
    expect(call("tool_cgcal_delete_event", approved)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(call("tool_cnotion_create_page", approved).ok).toBe(false)
  })

  it("a tool that read when allowed but now writes needs a new approval", () => {
    const approved = grants.map(approvalKey)
    const changed = [{ ...freebusy, readOnly: false }, createEvent]
    expect(call(FREEBUSY, approved, {}, changed)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it("says so plainly when the calendar is disconnected", () => {
    const approved = grants.map(approvalKey)
    const d = call(FREEBUSY, approved, {}, [notionAdd])
    expect(d).toMatchObject({ ok: false, status: 503 })
    if (!d.ok) expect(d.error).toMatch(/Google Calendar/)
  })

  it("refuses arguments that are not an object, or too large", () => {
    const approved = grants.map(approvalKey)
    for (const bad of [null, "x", 3, [1, 2]]) {
      expect(call(FREEBUSY, approved, bad)).toMatchObject({ status: 400 })
    }
    const big = { note: "a".repeat(MAX_TOOL_ARGS_BYTES) }
    expect(call(CREATE, approved, big)).toMatchObject({ status: 413 })
  })

  it("approvals survive a republish with the same tools", () => {
    const approved = grants.map(approvalKey)
    const again = resolveGrants([CREATE, FREEBUSY], catalog, nameOf)
    expect(approvedGrants(again, approved)).toHaveLength(2)
  })

  it("a new tool added on republish starts out not allowed", () => {
    const approved = grants.map(approvalKey)
    const more = resolveGrants(
      [FREEBUSY, CREATE, "tool_cgcal_delete_event"],
      catalog,
      nameOf
    )
    expect(approvedGrants(more, approved).map((g) => g.tool)).toEqual([
      "query_freebusy",
      "create_event",
    ])
  })
})

describe("tool rate limits", () => {
  const t0 = 1_800_000_000_000

  it("a visitor gets plenty of reads for browsing the page", () => {
    let window = EMPTY_WINDOW
    for (let i = 0; i < TOOL_LIMITS.read.perVisitor.limit; i++) {
      const r = takeSubmitSlot(window, "1.1.1.1", t0 + i, TOOL_LIMITS.read)
      expect(r.ok).toBe(true)
      window = r.window
    }
    expect(
      takeSubmitSlot(window, "1.1.1.1", t0 + 100, TOOL_LIMITS.read).ok
    ).toBe(false)
  })

  it("writes into the user's accounts are as tight as submissions", () => {
    let window = EMPTY_WINDOW
    for (let i = 0; i < 5; i++) {
      window = takeSubmitSlot(
        window,
        "1.1.1.1",
        t0 + i,
        TOOL_LIMITS.write
      ).window
    }
    expect(
      takeSubmitSlot(window, "1.1.1.1", t0 + 10, TOOL_LIMITS.write).ok
    ).toBe(false)
  })
})

describe("pushToolLog", () => {
  it("keeps the newest calls first, up to the cap", () => {
    let log: AppToolCallLog[] = []
    for (let i = 0; i < MAX_TOOL_LOG + 5; i++) {
      log = pushToolLog(log, {
        at: i,
        name: CREATE,
        app: "Google Calendar",
        tool: "create_event",
        readOnly: false,
        by: "Website",
        ok: true,
      })
    }
    expect(log).toHaveLength(MAX_TOOL_LOG)
    expect(log[0]!.at).toBe(MAX_TOOL_LOG + 4)
  })
})
