import type { skills } from "@cloudflare/think"
import type { BotSkillCatalog, Skill } from "@/lib/types"
import { parseSkillMd } from "./skill-fetch"

/**
 * Where a bot's skills come from, for Think's `getSkills()`. Think lists
 * these before every turn and only loads a skill the model activates.
 *
 * Neither source reads a folder. Think's workspace source would make any
 * file written there a skill on the next turn, and a bot's shell has the
 * internet, so it could fetch one in without the user seeing it.
 */

type SkillSource = skills.SkillSource
type SkillContent = NonNullable<Awaited<ReturnType<SkillSource["load"]>>>
type SkillResource = NonNullable<
  Awaited<ReturnType<NonNullable<SkillSource["readResource"]>>>
>

/** What a bot needs from the hub for the skills it may use. */
export interface InstalledSkillsPort {
  skillCatalog(botId: string): Promise<BotSkillCatalog>
  skillContent(botId: string, name: string): Promise<SkillContent | null>
  skillResource(
    botId: string,
    name: string,
    path: string
  ): Promise<SkillResource | null>
}

/** What the user installed for this bot or for every bot. Hub-side scoping. */
export function installedSkillSource(
  hub: () => Promise<InstalledSkillsPort>,
  botId: string
): SkillSource {
  let fingerprint = ""
  return {
    id: "installed",
    get fingerprint() {
      return fingerprint
    },
    async list() {
      const catalog = await (await hub()).skillCatalog(botId)
      fingerprint = catalog.fingerprint
      return catalog.skills
    },
    load: async (name) => (await hub()).skillContent(botId, name),
    readResource: async (name, path) =>
      (await hub()).skillResource(botId, name, path),
  }
}

/** Skills this bot saved with save_skill. The list is its state, not a folder. */
export function learnedSkillSource(
  saved: () => Skill[],
  read: (path: string) => Promise<string | null>
): SkillSource {
  const find = (name: string) => saved().find((s) => s.slug === name)
  return {
    id: "learned",
    get fingerprint() {
      return saved()
        .map((s) => `${s.slug}:${s.description}`)
        .sort()
        .join("|")
    },
    list: async () =>
      saved().map((s) => ({ name: s.slug, description: s.description })),
    async load(name) {
      const skill = find(name)
      if (!skill) return null
      const raw = await read(learnedSkillPath(skill.slug))
      if (raw === null) return null
      return {
        name: skill.slug,
        description: skill.description,
        body: parseSkillMd(raw)?.body ?? raw,
      }
    },
  }
}

export function learnedSkillPath(slug: string) {
  return `/workspace/skills/${slug}.md`
}

/** A resource's kind, from the folders the Agent Skills format names. */
export function resourceKind(path: string) {
  if (path.startsWith("scripts/")) return "script" as const
  if (path.startsWith("references/")) return "reference" as const
  if (path.startsWith("assets/")) return "asset" as const
  return "file" as const
}
