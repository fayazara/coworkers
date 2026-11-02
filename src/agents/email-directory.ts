import { DurableObject } from "cloudflare:workers"

/**
 * Maps a bot's short email name (`research@<EMAIL_DOMAIN>`) to the user and
 * bot that own it. Names are unique across the deployment, so this is one
 * instance ("directory") rather than one per user.
 */
export class EmailDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS addresses (
      slug TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL
    )`)
    this.ctx.storage.sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS addresses_bot ON addresses (user_id, bot_id)"
    )
  }

  /** The bot's name, claiming `base` (or `base-2`, `base-3`, …) if it has none. */
  claim(base: string, userId: string, botId: string): string {
    const sql = this.ctx.storage.sql
    const own = sql
      .exec<{ slug: string }>(
        "SELECT slug FROM addresses WHERE user_id = ? AND bot_id = ?",
        userId,
        botId
      )
      .toArray()[0]
    if (own) return own.slug
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`
      const taken = sql
        .exec("SELECT 1 FROM addresses WHERE slug = ?", slug)
        .toArray()[0]
      if (taken) continue
      sql.exec(
        "INSERT INTO addresses (slug, user_id, bot_id) VALUES (?, ?, ?)",
        slug,
        userId,
        botId
      )
      return slug
    }
  }

  lookup(slug: string): { userId: string; botId: string } | null {
    const row = this.ctx.storage.sql
      .exec<{ user_id: string; bot_id: string }>(
        "SELECT user_id, bot_id FROM addresses WHERE slug = ?",
        slug
      )
      .toArray()[0]
    return row ? { userId: row.user_id, botId: row.bot_id } : null
  }

  release(userId: string, botId: string) {
    this.ctx.storage.sql.exec(
      "DELETE FROM addresses WHERE user_id = ? AND bot_id = ?",
      userId,
      botId
    )
  }
}

export function emailDirectory(env: Env) {
  // Cast: the generated `Env` type does not list a class added to the config
  // until the types are regenerated.
  const ns = (env as unknown as Record<string, unknown>).EmailDirectory
  return (ns as DurableObjectNamespace<EmailDirectory>).getByName("directory")
}
