import { describe, expect, it } from "vitest"
import type { AppTool } from "@/lib/types"
import {
  MAX_TOOL_ARGS_BYTES,
  TOOL_LIMITS,
  approvalKey,
  approvedGrants,
  cleanScopes,
  decideToolCall,
  describeCall,
  resolveGrants,
  toolResultError,
  valuesAt,
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

describe("toolResultError", () => {
  it("turns an isError result into its message", () => {
    // Found live: a failed create-event came back as a normal result, so
    // the booking page could only say "couldn't put that on the calendar".
    expect(
      toolResultError({
        isError: true,
        content: [
          { type: "text", text: "403: insufficient permissions" },
          { type: "text", text: "scope calendar.events missing" },
        ],
      })
    ).toBe("403: insufficient permissions\nscope calendar.events missing")
  })

  it("still fails an isError result with no text", () => {
    expect(toolResultError({ isError: true, content: [] })).toMatch(/error/)
  })

  it("leaves successful and odd results alone", () => {
    for (const ok of [
      { content: [{ type: "text", text: "{}" }] },
      { isError: false, content: [] },
      { isError: "true" },
      null,
      "text",
      42,
    ]) {
      expect(toolResultError(ok)).toBeNull()
    }
  })
})

describe("use case: Executor's general call tool, limited to two calendar calls", () => {
  const call = tool("exec", "Executor", "call", false)
  const cat = [call]
  const CALL = "tool_cexec_call"
  const FB = 'tools["google-calendar-api"].calendar.freebusy.query'
  const INSERT = 'tools["google-calendar-api"].calendar.events.insert'
  const ACCOUNT = "acc_22fcb711"
  const [grant] = resolveGrants(
    [
      {
        name: CALL,
        only: [
          {
            at: "calls[].path",
            allow: [
              { value: FB, reads: true },
              { value: INSERT, reads: false },
            ],
          },
          {
            at: "calls[].input.accountId",
            allow: [{ value: ACCOUNT, reads: true }],
          },
        ],
      },
    ],
    cat,
    nameOf
  )
  const approved = [approvalKey(grant!)]
  const run = (args: unknown, ok = approved) =>
    decideToolCall({
      name: CALL,
      args,
      grants: [grant!],
      approved: ok,
      catalog: cat,
      nameOf,
    })
  const one = (path: string, accountId = ACCOUNT) => ({
    calls: { path, input: { accountId, input: {} } },
  })

  it("free/busy runs and counts as a read", () => {
    expect(run(one(FB))).toMatchObject({ ok: true, reads: true })
  })

  it("creating the event runs and counts as a write", () => {
    expect(run(one(INSERT))).toMatchObject({ ok: true, reads: false })
  })

  it("a list of calls is checked item by item", () => {
    expect(run({ calls: [one(FB).calls, one(INSERT).calls] })).toMatchObject({
      ok: true,
      reads: false,
    })
    expect(
      run({
        calls: [one(FB).calls, one("tools.gmail.users.messages.send").calls],
      })
    ).toMatchObject({ ok: false, status: 403 })
  })

  it("any other Executor path is refused, even with the right account", () => {
    for (const path of [
      "tools.gmail.users.messages.send",
      'tools["google-calendar-api"].calendar.events.delete',
      `${FB} `,
    ]) {
      expect(run(one(path))).toMatchObject({ ok: false, status: 403 })
    }
  })

  it("another account is refused, even on an allowed path", () => {
    expect(run(one(FB, "acc_someone_else"))).toMatchObject({ ok: false })
  })

  it("leaving out a limited argument is refused, not waved through", () => {
    expect(run({ calls: { input: { accountId: ACCOUNT } } })).toMatchObject({
      ok: false,
    })
    expect(run({ calls: { path: FB, input: {} } })).toMatchObject({ ok: false })
    expect(run({ calls: [] })).toMatchObject({ ok: false })
    expect(run({})).toMatchObject({ ok: false })
  })

  it("a non-string value cannot sneak past", () => {
    expect(
      run({ calls: { path: [FB], input: { accountId: ACCOUNT } } })
    ).toMatchObject({
      ok: false,
    })
  })

  it("approving the tool without limits does not approve the limited grant, and back", () => {
    const loose = approvalKey({ name: CALL, readOnly: false })
    expect(run(one(FB), [loose])).toMatchObject({ ok: false, status: 403 })
  })

  it("changing the limits needs a new approval", () => {
    const [wider] = resolveGrants(
      [
        {
          name: CALL,
          only: [
            {
              at: "calls[].path",
              allow: [
                { value: FB, reads: true },
                { value: "tools.gmail.x", reads: false },
              ],
            },
          ],
        },
      ],
      cat,
      nameOf
    )
    expect(approvedGrants([wider!], approved)).toEqual([])
  })

  it("a read-only tool stays a read whatever the labels say", () => {
    const [g] = resolveGrants(
      [
        {
          name: FREEBUSY,
          only: [
            { at: "items[]", allow: [{ value: "primary", reads: false }] },
          ],
        },
      ],
      catalog,
      nameOf
    )
    const d = decideToolCall({
      name: FREEBUSY,
      args: { items: ["primary"] },
      grants: [g!],
      approved: [approvalKey(g!)],
      catalog,
      nameOf,
    })
    expect(d).toMatchObject({ ok: true, reads: true })
  })
})

describe("cleanScopes", () => {
  it("refuses argument paths that are not simple paths", () => {
    for (const at of ["", "calls[0].path", "a..b", "a b", "__proto__ x"]) {
      expect(() =>
        cleanScopes("t", [{ at, allow: [{ value: "x", reads: true }] }])
      ).toThrow()
    }
  })

  it("needs at least one allowed value, and caps them", () => {
    expect(() => cleanScopes("t", [{ at: "a", allow: [] }])).toThrow()
    const many = Array.from({ length: 21 }, (_, i) => ({
      value: `v${i}`,
      reads: true,
    }))
    expect(() => cleanScopes("t", [{ at: "a", allow: many }])).toThrow()
  })

  it("drops duplicate values", () => {
    expect(
      cleanScopes("t", [
        {
          at: "a",
          allow: [
            { value: "x", reads: true },
            { value: "x", reads: false },
          ],
        },
      ])
    ).toEqual([{ at: "a", allow: [{ value: "x", reads: true }] }])
  })
})

describe("valuesAt", () => {
  it("reads keys, and each item of lists marked []", () => {
    const args = { calls: [{ path: "a" }, { path: "b" }], one: { path: "c" } }
    expect(valuesAt(args, "calls[].path")).toEqual(["a", "b"])
    expect(valuesAt(args, "one[].path")).toEqual(["c"])
    expect(valuesAt(args, "one.path")).toEqual(["c"])
    expect(valuesAt(args, "nope.path")).toEqual([undefined])
  })
})

describe("describeCall", () => {
  const grant = {
    tool: "call",
    only: [
      {
        at: "calls[].path",
        allow: [
          { value: "x.freebusy.query", reads: true, label: "Check free/busy" },
          { value: "x.events.insert", reads: false, label: "Create event" },
          { value: "x.events.get", reads: true },
        ],
      },
    ],
  }

  it("names a call by the label the bot gave", () => {
    expect(describeCall(grant, { calls: { path: "x.events.insert" } })).toBe(
      "Create event"
    )
  })

  it("joins a batch, and falls back to the value without a label", () => {
    expect(
      describeCall(grant, {
        calls: [
          { path: "x.freebusy.query" },
          { path: "x.events.get" },
          { path: "x.freebusy.query" },
        ],
      })
    ).toBe("Check free/busy + x.events.get")
  })

  it("shows what was tried when it is outside the limits", () => {
    expect(describeCall(grant, { calls: { path: "tools.gmail.send" } })).toBe(
      "tools.gmail.send"
    )
  })

  it("falls back to the tool's name without limits", () => {
    expect(describeCall({ tool: "create_event" }, {})).toBe("create_event")
  })
})
