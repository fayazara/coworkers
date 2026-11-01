import type { InstalledSkill } from "@/lib/types"
import type { SkillFile } from "./skill-fetch"

/**
 * Skills the user installed, in the hub's SQLite: one copy each, whichever
 * bots use it. Bots read them over RPC and have no way to write here, so a
 * skill only gets in through the user's review.
 */

interface SkillRow extends Record<string, SqlStorageValue> {
  name: string
  description: string
  source: string
  version: string
  digest: string
  bots: string | null
  installed_at: number
}

function toSkill(row: SkillRow): InstalledSkill {
  return {
    name: row.name,
    description: row.description,
    source: row.source,
    version: row.version,
    digest: row.digest,
    bots: row.bots === null ? null : (JSON.parse(row.bots) as string[]),
    installedAt: row.installed_at,
  }
}

export class SkillStore {
  constructor(private readonly sql: SqlStorage) {}

  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS installed_skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      source TEXT NOT NULL,
      version TEXT NOT NULL,
      digest TEXT NOT NULL,
      bots TEXT,
      installed_at INTEGER NOT NULL
    )`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS installed_skill_files (
      skill TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (skill, path)
    )`)
  }

  list() {
    return this.sql
      .exec<SkillRow>("SELECT * FROM installed_skills ORDER BY name")
      .toArray()
      .map(toSkill)
  }

  get(name: string) {
    const [row] = this.sql
      .exec<SkillRow>("SELECT * FROM installed_skills WHERE name = ?", name)
      .toArray()
    return row ? toSkill(row) : null
  }

  /** Install or replace a skill. Null `bots` means every bot. */
  put(skill: InstalledSkill, files: SkillFile[]) {
    this.sql.exec(
      "DELETE FROM installed_skill_files WHERE skill = ?",
      skill.name
    )
    this.sql.exec(
      `INSERT OR REPLACE INTO installed_skills
        (name, description, source, version, digest, bots, installed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      skill.name,
      skill.description,
      skill.source,
      skill.version,
      skill.digest,
      skill.bots && JSON.stringify(skill.bots),
      skill.installedAt
    )
    for (const file of files) {
      this.sql.exec(
        "INSERT INTO installed_skill_files (skill, path, content) VALUES (?, ?, ?)",
        skill.name,
        file.path,
        file.content
      )
    }
  }

  remove(name: string) {
    this.sql.exec("DELETE FROM installed_skill_files WHERE skill = ?", name)
    this.sql.exec("DELETE FROM installed_skills WHERE name = ?", name)
  }

  /** Take one bot off a skill, removing the skill if no bot is left. */
  removeBot(name: string, botId: string) {
    const skill = this.get(name)
    if (!skill?.bots) return
    const bots = skill.bots.filter((id) => id !== botId)
    if (bots.length === 0) {
      this.remove(name)
      return
    }
    this.sql.exec(
      "UPDATE installed_skills SET bots = ? WHERE name = ?",
      JSON.stringify(bots),
      name
    )
  }

  file(name: string, path: string) {
    const [row] = this.sql
      .exec<{ content: string }>(
        "SELECT content FROM installed_skill_files WHERE skill = ? AND path = ?",
        name,
        path
      )
      .toArray()
    return row?.content ?? null
  }

  files(name: string) {
    return this.sql
      .exec<{ path: string; size: number }>(
        `SELECT path, LENGTH(CAST(content AS BLOB)) AS size
          FROM installed_skill_files WHERE skill = ? ORDER BY path`,
        name
      )
      .toArray()
  }
}
