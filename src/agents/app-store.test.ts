import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"
import { authorize, validateAccess } from "./app-access"
import { AppDataError, AppStore, NO_ACCESS } from "./app-store"

/** Enough of a Durable Object's SqlStorage, over Node's SQLite. */
function fakeSql(db = new DatabaseSync(":memory:")) {
  return {
    db,
    exec(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query)
      const params = bindings as (string | number | null)[]
      if (stmt.columns().length > 0) {
        const rows = stmt.all(...params)
        return { toArray: () => rows, rowsWritten: 0 }
      }
      const { changes } = stmt.run(...params)
      return { toArray: () => [], rowsWritten: Number(changes) }
    },
  } as unknown as SqlStorage & { db: DatabaseSync }
}

const linkPath = (slug: string, token: string) => `/apps/u/b/${slug}/${token}/`

function newStore() {
  const store = new AppStore(fakeSql(), linkPath)
  store.init()
  return store
}

const base = {
  name: "Book a call",
  description: "Pick a time",
  hasServer: false,
}

describe("AppStore and public forms", () => {
  let store: AppStore
  beforeEach(() => {
    store = newStore()
  })

  it("an app without a form has no public access", () => {
    store.save({ slug: "trip", ...base })
    expect(store.get("trip")?.access).toEqual(NO_ACCESS)
  })

  it("stores the form's access", () => {
    const access = validateAccess({
      submit: ["bookings"],
      read: ["slots"],
      wake: true,
    })
    store.save({ slug: "book", ...base, access })
    expect(store.get("book")?.access).toEqual(access)
  })

  it("republishing without access keeps the form", () => {
    const access = validateAccess({ submit: ["responses"] })
    store.save({ slug: "survey", ...base, access })
    store.save({ slug: "survey", ...base, name: "Survey v2" })
    const app = store.get("survey")!
    expect(app.access).toEqual(access)
    expect(app.version).toBe(2)
    expect(app.name).toBe("Survey v2")
  })

  it("republishing with null removes the form", () => {
    store.save({
      slug: "survey",
      ...base,
      access: validateAccess({ submit: ["responses"] }),
    })
    store.save({ slug: "survey", ...base, access: null })
    expect(store.get("survey")?.access).toEqual(NO_ACCESS)
  })

  it("republishing with new access replaces it", () => {
    store.save({
      slug: "survey",
      ...base,
      access: validateAccess({ submit: ["responses"] }),
    })
    const next = validateAccess({ submit: ["answers"], read: ["questions"] })
    store.save({ slug: "survey", ...base, access: next })
    expect(store.get("survey")?.access).toEqual(next)
  })

  it("makes and finds submit links", () => {
    store.save({ slug: "survey", ...base })
    const link = store.createLink("survey", "Website", "submit")
    expect(link.mode).toBe("submit")
    expect(store.findLink("survey", link.token)?.mode).toBe("submit")
    expect(store.links("survey").map((l) => l.mode)).toEqual(["edit", "submit"])
  })

  it("a submission never replaces an existing item", () => {
    store.save({ slug: "survey", ...base })
    store.put(
      "survey",
      "responses",
      { id: "0123456789abcdef0123456789abcdef", a: 1 },
      "bot"
    )
    expect(() =>
      store.put(
        "survey",
        "responses",
        { id: "0123456789abcdef0123456789abcdef", a: 2 },
        "link:Website",
        { createOnly: true }
      )
    ).toThrow(AppDataError)
    expect(
      store.item("survey", "responses", "0123456789abcdef0123456789abcdef")?.a
    ).toBe(1)
  })

  it("a full collection refuses new submissions with 413", () => {
    store.save({ slug: "survey", ...base })
    const insert = store["sql"].exec.bind(store["sql"])
    for (let i = 0; i < 2000; i++) {
      insert(
        `INSERT INTO app_data (app, collection, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
        "survey",
        "responses",
        `r${i}`,
        "{}",
        0,
        "bot"
      )
    }
    try {
      store.put("survey", "responses", {}, "link:Website", { createOnly: true })
      throw new Error("expected a refusal")
    } catch (err) {
      expect(err).toBeInstanceOf(AppDataError)
      expect((err as AppDataError).status).toBe(413)
    }
  })

  it("deleting the app removes its links and submissions", () => {
    store.save({
      slug: "survey",
      ...base,
      access: validateAccess({ submit: ["responses"] }),
    })
    const link = store.createLink("survey", "Website", "submit")
    store.put("survey", "responses", { a: 1 }, "link:Website")
    store.delete("survey")
    expect(store.get("survey")).toBeNull()
    expect(store.findLink("survey", link.token)).toBeNull()
    expect(store.collections("survey")).toEqual([])
  })
})

describe("AppStore and app tools", () => {
  const grant = {
    name: "tool_cgcal_create_event",
    connectionId: "gcal",
    tool: "create_event",
    app: "Google Calendar",
    readOnly: false,
    description: "Create an event",
  }

  it("an app asks for no tools by default", () => {
    const store = newStore()
    store.save({ slug: "trip", ...base })
    expect(store.get("trip")).toMatchObject({ tools: [], approvedTools: [] })
  })

  it("stores the tools, keeps them on republish, clears them with null", () => {
    const store = newStore()
    store.save({ slug: "book", ...base, tools: [grant] })
    store.save({ slug: "book", ...base })
    expect(store.get("book")?.tools).toEqual([grant])
    store.save({ slug: "book", ...base, tools: null })
    expect(store.get("book")?.tools).toEqual([])
  })

  it("keeps the user's approval across a republish", () => {
    const store = newStore()
    store.save({ slug: "book", ...base, tools: [grant] })
    store.approveTools("book", ["tool_cgcal_create_event:write"])
    store.save({ slug: "book", ...base, tools: [grant] })
    expect(store.get("book")?.approvedTools).toEqual([
      "tool_cgcal_create_event:write",
    ])
    store.approveTools("book", [])
    expect(store.get("book")?.approvedTools).toEqual([])
  })

  it("ignores broken stored tool data", () => {
    const sql = fakeSql()
    const store = new AppStore(sql, linkPath)
    store.init()
    store.save({ slug: "book", ...base })
    sql.db.exec(
      `UPDATE apps SET tools = '[{"name":1},{"oops":true}]', approved_tools = '{'`
    )
    expect(store.get("book")).toMatchObject({ tools: [], approvedTools: [] })
  })
})

describe("bots made before public forms", () => {
  it("gets the access column added, and old apps keep working", () => {
    const sql = fakeSql()
    // The apps table as it was before this change.
    sql.db.exec(`CREATE TABLE apps (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      has_server INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    sql.db.exec(
      `INSERT INTO apps (slug, name, created_at, updated_at) VALUES ('old', 'Old app', 1, 1)`
    )
    const store = new AppStore(sql, linkPath)
    store.init()
    expect(store.get("old")?.access).toEqual(NO_ACCESS)
    store.save({
      slug: "old",
      ...base,
      access: validateAccess({ submit: ["rsvps"] }),
    })
    expect(store.get("old")?.access.submit).toEqual(["rsvps"])
  })

  it("adds the tool columns to a bot that already had public forms", () => {
    const sql = fakeSql()
    sql.db.exec(`CREATE TABLE apps (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, has_server INTEGER NOT NULL DEFAULT 0,
      access TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    const store = new AppStore(sql, linkPath)
    store.init()
    store.save({ slug: "x", ...base })
    expect(store.get("x")).toMatchObject({ tools: [], approvedTools: [] })
  })

  it("running init twice is harmless", () => {
    const sql = fakeSql()
    new AppStore(sql, linkPath).init()
    expect(() => new AppStore(sql, linkPath).init()).not.toThrow()
  })
})

describe("use case: RSVPs end to end, store and rules together", () => {
  // What BotAgent.appData does, minus sockets and the bot's turn.
  function run(
    store: AppStore,
    mode: "edit" | "view" | "submit",
    label: string,
    op: Parameters<typeof authorize>[2]
  ) {
    const app = store.get("party")!
    const decision = authorize(mode, app.access, op)
    if (!decision.ok) return { error: decision.error, status: decision.status }
    const next = decision.op
    switch (next.op) {
      case "list":
        return { value: store.items("party", next.collection) }
      case "get":
        return { value: store.item("party", next.collection, next.id) }
      case "put":
        return {
          value: store.put(
            "party",
            next.collection,
            next.item,
            `link:${label}`,
            {
              merge: next.merge,
              createOnly: mode === "submit",
            }
          ),
        }
      default:
        return { value: null }
    }
  }

  it("guests reply, see their own reply, and the host sees all of them", () => {
    const store = newStore()
    store.save({
      slug: "party",
      ...base,
      access: validateAccess({ submit: ["rsvps"], read: ["details"] }),
    })
    store.put("party", "details", { id: "when", text: "Sat 8pm" }, "bot")

    const details = run(store, "submit", "Invite", {
      op: "list",
      collection: "details",
    })
    expect(details).toMatchObject({ value: [{ text: "Sat 8pm" }] })

    const ana = run(store, "submit", "Invite", {
      op: "put",
      collection: "rsvps",
      item: { name: "Ana", coming: true },
    }) as { value: { id: string } }
    const ben = run(store, "submit", "Invite", {
      op: "put",
      collection: "rsvps",
      item: { name: "Ben", coming: false, id: "" },
    }) as { value: { id: string } }
    expect(ana.value.id).not.toBe(ben.value.id)

    // Ana reads back her own reply by its receipt...
    expect(
      run(store, "submit", "Invite", {
        op: "get",
        collection: "rsvps",
        id: ana.value.id,
      })
    ).toMatchObject({ value: { name: "Ana", updatedBy: "link:Invite" } })
    // ...but cannot list everyone's.
    expect(
      run(store, "submit", "Invite", { op: "list", collection: "rsvps" })
    ).toMatchObject({
      status: 403,
    })

    // The bot confirms Ana; she sees the change, and it was not hers to make.
    store.put("party", "rsvps", { id: ana.value.id, seat: "Table 2" }, "bot", {
      merge: true,
    })
    expect(
      run(store, "submit", "Invite", {
        op: "get",
        collection: "rsvps",
        id: ana.value.id,
      })
    ).toMatchObject({ value: { name: "Ana", seat: "Table 2" } })

    // The host, on their own link, sees both.
    const all = run(store, "edit", "You", {
      op: "list",
      collection: "rsvps",
    }) as unknown as {
      value: { name: string }[]
    }
    expect(all.value.map((r) => r.name).sort()).toEqual(["Ana", "Ben"])
  })
})
