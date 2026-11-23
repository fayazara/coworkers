import { LIMITS } from "@/lib/surface/catalog"
import type { Surface } from "@/lib/surface/types"

/**
 * The surfaces a bot showed, newest copy of each, in the bot's own SQLite.
 * This is the copy the bot updates and checks button presses against; the
 * thread draws the copies carried in the tool results.
 */
export class SurfaceStore {
  constructor(private readonly sql: SqlStorage) {}

  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS surfaces (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`)
  }

  get(id: string): Surface | undefined {
    const row = this.sql
      .exec<{ body: string }>(`SELECT body FROM surfaces WHERE id = ?`, id)
      .toArray()[0]
    return row ? (JSON.parse(row.body) as Surface) : undefined
  }

  ids(): Set<string> {
    return new Set(
      this.sql
        .exec<{ id: string }>(`SELECT id FROM surfaces`)
        .toArray()
        .map((r) => r.id)
    )
  }

  open(): Surface[] {
    return this.sql
      .exec<{ body: string }>(
        `SELECT body FROM surfaces WHERE status = 'open' ORDER BY updated_at DESC`
      )
      .toArray()
      .map((r) => JSON.parse(r.body) as Surface)
  }

  /**
   * Store a new copy. Past the cap, the oldest open surfaces that are not
   * on the Desk close: they stay in the thread, read-only. Returns them.
   */
  save(surface: Surface): Surface[] {
    this.sql.exec(
      `INSERT INTO surfaces (id, body, status, pinned, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body,
         status = excluded.status, pinned = excluded.pinned,
         updated_at = excluded.updated_at`,
      surface.id,
      JSON.stringify(surface),
      surface.status,
      surface.desk ? 1 : 0,
      surface.updatedAt
    )
    const extra = this.sql
      .exec<{ body: string }>(
        `SELECT body FROM surfaces WHERE status = 'open' AND pinned = 0
         ORDER BY updated_at DESC LIMIT -1 OFFSET ?`,
        LIMITS.openSurfaces
      )
      .toArray()
      .map((r) => JSON.parse(r.body) as Surface)
    const closed = extra.map((s) => ({ ...s, status: "closed" as const }))
    for (const s of closed) {
      this.sql.exec(
        `UPDATE surfaces SET body = ?, status = 'closed' WHERE id = ?`,
        JSON.stringify(s),
        s.id
      )
    }
    return closed
  }
}
