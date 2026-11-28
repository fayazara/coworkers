import { canUseAppLink, isBotMember } from "@/lib/sharing"
import type { BotSharing } from "@/lib/sharing"
import type {
  AppAccess,
  AppLink,
  AppToolGrant,
  BotAppSummary,
} from "@/lib/types"

/**
 * Apps a bot built, the links that open them, and the data they show.
 * Everything is in the bot's own SQLite, so an app is as durable as the bot.
 */

export const APPS_ROOT = "/workspace/apps"
export const MAX_ITEM_BYTES = 32 * 1024
export const MAX_ITEMS_PER_COLLECTION = 2000
export const MAX_COLLECTIONS_PER_APP = 50

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
const COLLECTION_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export function isAppSlug(value: string) {
  return SLUG_RE.test(value)
}

export function assertCollection(name: string) {
  if (!COLLECTION_RE.test(name)) {
    throw new AppDataError(
      `Collection names are lowercase letters, digits, "-" and "_" (got "${name}")`
    )
  }
}

/** A problem with what the caller asked for, as opposed to a crash. */
export class AppDataError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

export const NO_ACCESS: AppAccess = { read: [], submit: [], wake: false }

/** Access as stored in SQL. Anything unreadable means no public form. */
export function parseAccess(json: string | null | undefined): AppAccess {
  if (!json) return NO_ACCESS
  try {
    const raw = JSON.parse(json) as Partial<AppAccess> | null
    if (!raw || typeof raw !== "object") return NO_ACCESS
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : []
    return {
      read: list(raw.read),
      submit: list(raw.submit),
      wake: raw.wake === true,
    }
  } catch {
    return NO_ACCESS
  }
}

function isGrant(x: unknown): x is AppToolGrant {
  const g = x as AppToolGrant
  return (
    !!g &&
    typeof g.name === "string" &&
    typeof g.connectionId === "string" &&
    typeof g.tool === "string" &&
    typeof g.readOnly === "boolean"
  )
}

/** A JSON list from SQL, keeping only the entries that look right. */
function parseList<T>(json: string | null, ok: (x: unknown) => x is T): T[] {
  if (!json) return []
  try {
    const raw = JSON.parse(json) as unknown
    return Array.isArray(raw) ? raw.filter(ok) : []
  } catch {
    return []
  }
}

/** What an item looks like to apps and to the bot. */
export type AppItem = Record<string, unknown> & {
  id: string
  updatedAt: number
  updatedBy: string
}

type AppRow = {
  slug: string
  name: string
  description: string
  version: number
  has_server: number
  access: string | null
  tools: string | null
  approved_tools: string | null
  updated_at: number
}

type LinkRow = {
  token: string
  slug: string
  label: string
  mode: AppLink["mode"]
  owner: number
  created_at: number
  audience: NonNullable<AppLink["audience"]>
  email: string | null
  can_message: number
  expires_at: number | null
  parent_token: string | null
  viewer_email: string | null
}

type ItemRow = {
  id: string
  data: string
  updated_at: number
  updated_by: string
}

function toSummary(r: AppRow): BotAppSummary {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    version: r.version,
    updatedAt: r.updated_at,
  }
}

function toItem(r: ItemRow): AppItem {
  const data = JSON.parse(r.data) as Record<string, unknown>
  return { ...data, id: r.id, updatedAt: r.updated_at, updatedBy: r.updated_by }
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, "")
}

export class AppStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly linkPath: (slug: string, token: string) => string
  ) {}

  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS apps (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      has_server INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS app_links (
      token TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'edit',
      owner INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS app_data (
      app TEXT NOT NULL,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (app, collection, id)
    )`)
    const columns = new Set(
      this.sql
        .exec<{ name: string }>(`PRAGMA table_info(app_links)`)
        .toArray()
        .map((c) => c.name)
    )
    for (const [name, type] of Object.entries({
      audience: "TEXT NOT NULL DEFAULT 'link'",
      email: "TEXT",
      can_message: "INTEGER NOT NULL DEFAULT 0",
      expires_at: "INTEGER",
      parent_token: "TEXT",
      viewer_email: "TEXT",
    })) {
      if (!columns.has(name))
        this.sql.exec(`ALTER TABLE app_links ADD COLUMN ${name} ${type}`)
    }
    // Existing owner URLs were bearer credentials. They now require login.
    this.sql.exec(
      `UPDATE app_links SET audience = 'owner', can_message = 1 WHERE owner = 1`
    )
    this.sql.exec(
      `DELETE FROM app_links WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      Date.now()
    )
    // Added with public forms; older bots have the table without it.
    const appColumns = this.sql
      .exec<{ name: string }>(`PRAGMA table_info(apps)`)
      .toArray()
    // Added later, each on its own: older bots have the table without them.
    for (const column of ["access", "tools", "approved_tools"]) {
      if (!appColumns.some((c) => c.name === column)) {
        this.sql.exec(`ALTER TABLE apps ADD COLUMN ${column} TEXT`)
      }
    }
  }

  // ── Apps ────────────────────────────────────────────────────────────

  list(): BotAppSummary[] {
    return this.sql
      .exec<AppRow>(`SELECT * FROM apps ORDER BY updated_at DESC`)
      .toArray()
      .map(toSummary)
  }

  get(slug: string) {
    const row = this.sql
      .exec<AppRow>(`SELECT * FROM apps WHERE slug = ?`, slug)
      .toArray()[0]
    return row
      ? {
          ...toSummary(row),
          hasServer: row.has_server === 1,
          access: parseAccess(row.access),
          tools: parseList<AppToolGrant>(row.tools, isGrant),
          approvedTools: parseList<string>(
            row.approved_tools,
            (x): x is string => typeof x === "string"
          ),
        }
      : null
  }

  /**
   * Create or update an app and make sure the owner has a link to it.
   * `access` undefined keeps what the app had; null removes its public form.
   * `tools` the same, for the app tools it asked for. Approvals are kept:
   * they only count for tools still asked for, as they were approved.
   */
  save(input: {
    slug: string
    name: string
    description: string
    hasServer: boolean
    access?: AppAccess | null
    tools?: AppToolGrant[] | null
  }) {
    const now = Date.now()
    const keep = input.access === undefined
    const keepTools = input.tools === undefined
    this.sql.exec(
      `INSERT INTO apps (slug, name, description, version, has_server, access, tools, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         has_server = excluded.has_server,
         access = ${keep ? "apps.access" : "excluded.access"},
         tools = ${keepTools ? "apps.tools" : "excluded.tools"},
         version = apps.version + 1,
         updated_at = excluded.updated_at`,
      input.slug,
      input.name,
      input.description,
      input.hasServer ? 1 : 0,
      input.access ? JSON.stringify(input.access) : null,
      input.tools && input.tools.length > 0
        ? JSON.stringify(input.tools)
        : null,
      now,
      now
    )
    this.ownerLink(input.slug)
    return this.get(input.slug)!
  }

  /** The user's approval of the app's tools, as they are now. */
  approveTools(slug: string, keys: string[]) {
    this.sql.exec(
      `UPDATE apps SET approved_tools = ? WHERE slug = ?`,
      keys.length > 0 ? JSON.stringify(keys) : null,
      slug
    )
  }

  delete(slug: string) {
    this.sql.exec(`DELETE FROM apps WHERE slug = ?`, slug)
    this.sql.exec(`DELETE FROM app_links WHERE slug = ?`, slug)
    this.sql.exec(`DELETE FROM app_data WHERE app = ?`, slug)
  }

  // ── Links ───────────────────────────────────────────────────────────

  links(slug: string): AppLink[] {
    return this.sql
      .exec<LinkRow>(
        `SELECT * FROM app_links WHERE slug = ? ORDER BY owner DESC, created_at`,
        slug
      )
      .toArray()
      .map((r) => ({
        token: r.token,
        label: r.label,
        mode: r.mode,
        owner: r.owner === 1,
        createdAt: r.created_at,
        path: this.linkPath(slug, r.token),
        audience: r.audience,
        email: r.email ?? undefined,
        canMessage: r.can_message === 1,
        expiresAt: r.expires_at ?? undefined,
        parentToken: r.parent_token ?? undefined,
        viewerEmail: r.viewer_email ?? undefined,
      }))
  }

  ownerLink(slug: string): AppLink {
    const existing = this.links(slug).find((l) => l.owner)
    if (existing) return existing
    return this.createLink(slug, "You", "edit", true, {
      audience: "owner",
      canMessage: true,
    })
  }

  botLink(slug: string, mode: AppLink["mode"] = "edit") {
    return (
      this.links(slug).find((l) => l.audience === "bot" && l.mode === mode) ??
      this.createLink(slug, "Bot service", mode, false, {
        audience: "bot",
        canMessage: false,
      })
    )
  }

  createLink(
    slug: string,
    label: string,
    mode: AppLink["mode"],
    owner = false,
    options: Pick<
      AppLink,
      | "audience"
      | "email"
      | "canMessage"
      | "expiresAt"
      | "parentToken"
      | "viewerEmail"
    > = {}
  ): AppLink {
    this.sql.exec(
      `DELETE FROM app_links WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      Date.now()
    )
    const token = newToken()
    this.sql.exec(
      `INSERT INTO app_links (token, slug, label, mode, owner, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      token,
      slug,
      label,
      mode,
      owner ? 1 : 0,
      Date.now()
    )
    this.sql.exec(
      `UPDATE app_links SET audience = ?, email = ?, can_message = ?, expires_at = ?, parent_token = ?, viewer_email = ? WHERE token = ?`,
      options.audience ?? "link",
      options.email ?? null,
      options.canMessage ? 1 : 0,
      options.expiresAt ?? null,
      options.parentToken ?? null,
      options.viewerEmail ?? null,
      token
    )
    return this.links(slug).find((l) => l.token === token)!
  }

  /** Revoking the owner's link replaces it with a fresh one. */
  revokeLink(token: string) {
    const row = this.sql
      .exec<LinkRow>(`SELECT * FROM app_links WHERE token = ?`, token)
      .toArray()[0]
    if (!row) return null
    this.sql.exec(
      `DELETE FROM app_links WHERE token = ? OR parent_token = ?`,
      token,
      token
    )
    if (row.owner === 1) this.ownerLink(row.slug)
    return { slug: row.slug }
  }

  findLink(slug: string, token: string): AppLink | null {
    const row = this.sql
      .exec<LinkRow>(
        `SELECT * FROM app_links WHERE slug = ? AND token = ?`,
        slug,
        token
      )
      .toArray()[0]
    if (!row) return null
    if (row.expires_at && row.expires_at <= Date.now()) return null
    if (row.parent_token && !this.findLink(slug, row.parent_token)) return null
    return this.links(slug).find((l) => l.token === row.token) ?? null
  }

  // ── Data ────────────────────────────────────────────────────────────

  authorize(
    slug: string,
    token: string,
    viewer: { id: string; email: string | null } | null,
    ownerId: string,
    sharing: BotSharing
  ): AppLink | null {
    const link = this.findLink(slug, token)
    if (!link) return null
    // Keep owner sessions scoped in storage, while retaining the owner's
    // rate-limit exemption when returning an authorized capability.
    if (link.audience === "session" && !link.viewerEmail && link.parentToken) {
      const parent = this.findLink(slug, link.parentToken)
      if (parent?.audience === "owner") return { ...link, owner: true }
    }
    if (link.audience === "session" && link.viewerEmail && link.parentToken) {
      const parent = this.findLink(slug, link.parentToken)
      if (
        parent?.audience === "owner" &&
        !isBotMember(sharing, link.viewerEmail)
      )
        return null
      // Upgrade existing member sessions too; explicit external shares retain
      // their own independent permissions.
      if (parent?.audience === "owner")
        return { ...link, mode: "edit", canMessage: true }
    }
    const owner = viewer?.id === ownerId
    const member = isBotMember(sharing, viewer?.email ?? null)
    if (!canUseAppLink(link, viewer?.email ?? null, owner, member)) return null
    if (link.audience !== "owner" && link.audience !== "email") return link
    return this.createLink(
      slug,
      owner ? "You" : viewer!.email!,
      link.audience === "owner" && !owner ? "edit" : link.mode,
      false,
      {
        audience: "session",
        parentToken: token,
        expiresAt: Date.now() + 15 * 60_000,
        viewerEmail:
          link.audience === "owner" && !owner ? viewer!.email! : undefined,
        canMessage:
          link.audience === "owner" && !owner ? true : link.canMessage,
      }
    )
  }

  collections(slug: string) {
    return this.sql
      .exec<{ name: string; count: number }>(
        `SELECT collection AS name, COUNT(*) AS count FROM app_data
         WHERE app = ? GROUP BY collection ORDER BY collection`,
        slug
      )
      .toArray()
  }

  items(slug: string, collection: string): AppItem[] {
    assertCollection(collection)
    return this.sql
      .exec<ItemRow>(
        `SELECT id, data, updated_at, updated_by FROM app_data
         WHERE app = ? AND collection = ? ORDER BY rowid`,
        slug,
        collection
      )
      .toArray()
      .map(toItem)
  }

  item(slug: string, collection: string, id: string): AppItem | null {
    assertCollection(collection)
    const row = this.sql
      .exec<ItemRow>(
        `SELECT id, data, updated_at, updated_by FROM app_data
         WHERE app = ? AND collection = ? AND id = ?`,
        slug,
        collection,
        id
      )
      .toArray()[0]
    return row ? toItem(row) : null
  }

  /**
   * Insert or replace an item. With `merge`, fields are added to the
   * existing item instead of replacing it.
   */
  put(
    slug: string,
    collection: string,
    input: Record<string, unknown>,
    by: string,
    options: { merge?: boolean; createOnly?: boolean } = {}
  ): AppItem {
    assertCollection(collection)
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new AppDataError("An item must be a JSON object")
    }
    const { id: rawId, updatedAt: _a, updatedBy: _b, ...fields } = input
    const id =
      rawId === undefined || rawId === null || rawId === ""
        ? crypto.randomUUID().slice(0, 8)
        : String(rawId)
    if (!ITEM_ID_RE.test(id)) {
      throw new AppDataError(
        `Item ids are up to 64 letters, digits, ".", "-" and "_" (got "${id}")`
      )
    }
    const existing = this.item(slug, collection, id)
    if (existing && options.createOnly) {
      throw new AppDataError("An item with that id already exists", 409)
    }
    if (!existing) this.checkRoom(slug, collection)
    let data: Record<string, unknown> = fields
    if (options.merge && existing) {
      const { id: _i, updatedAt: _u, updatedBy: _y, ...old } = existing
      data = { ...old, ...fields }
    }
    const json = JSON.stringify(data)
    if (json.length > MAX_ITEM_BYTES) {
      throw new AppDataError("Items are limited to 32 KB each", 413)
    }
    const now = Date.now()
    this.sql.exec(
      `INSERT INTO app_data (app, collection, id, data, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (app, collection, id) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      slug,
      collection,
      id,
      json,
      now,
      by
    )
    return { ...data, id, updatedAt: now, updatedBy: by }
  }

  remove(slug: string, collection: string, ids: string[]) {
    assertCollection(collection)
    let removed = 0
    for (const id of ids) {
      removed += this.sql.exec(
        `DELETE FROM app_data WHERE app = ? AND collection = ? AND id = ?`,
        slug,
        collection,
        id
      ).rowsWritten
    }
    return removed
  }

  private checkRoom(slug: string, collection: string) {
    const counts = this.collections(slug)
    const current = counts.find((c) => c.name === collection)
    if (!current && counts.length >= MAX_COLLECTIONS_PER_APP) {
      throw new AppDataError(
        `An app can have at most ${MAX_COLLECTIONS_PER_APP} collections`,
        413
      )
    }
    if ((current?.count ?? 0) >= MAX_ITEMS_PER_COLLECTION) {
      throw new AppDataError(
        `A collection can hold at most ${MAX_ITEMS_PER_COLLECTION} items`,
        413
      )
    }
  }
}
