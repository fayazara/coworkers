import { describe, expect, it } from "vitest"
import {
  installedSkillSource,
  learnedSkillPath,
  learnedSkillSource,
  resourceKind,
} from "./skill-sources"
import type { InstalledSkillsPort } from "./skill-sources"

describe("learnedSkillSource", () => {
  const skill = { slug: "report", name: "Report", description: "Weekly report" }
  const file = `---\nname: "Report"\ndescription: "Weekly report"\n---\n\n# Report\n\n1. Open it\n`

  it("lists only what save_skill recorded, whatever is on disk", async () => {
    const source = learnedSkillSource(
      () => [skill],
      async () => file
    )
    expect(await source.list()).toEqual([
      { name: "report", description: "Weekly report" },
    ])
    expect(await source.load("fetched-by-the-shell")).toBeNull()
  })

  it("reads the steps without the frontmatter", async () => {
    const paths: string[] = []
    const source = learnedSkillSource(
      () => [skill],
      async (path) => {
        paths.push(path)
        return file
      }
    )
    expect(await source.load("report")).toMatchObject({
      name: "report",
      body: "# Report\n\n1. Open it",
    })
    expect(paths).toEqual([learnedSkillPath("report")])
  })

  it("changes its fingerprint with the list", () => {
    let saved = [skill]
    const source = learnedSkillSource(
      () => saved,
      async () => null
    )
    const before = source.fingerprint
    saved = [...saved, { ...skill, slug: "other" }]
    expect(source.fingerprint).not.toBe(before)
  })
})

describe("installedSkillSource", () => {
  it("asks the hub for this bot and takes its fingerprint", async () => {
    const asked: string[] = []
    const hub: InstalledSkillsPort = {
      skillCatalog: async (botId) => {
        asked.push(botId)
        return {
          fingerprint: "one:abc",
          skills: [{ name: "one", description: "Use it" }],
        }
      },
      skillContent: async () => null,
      skillResource: async () => null,
    }
    const source = installedSkillSource(async () => hub, "b1")
    expect(await source.list()).toEqual([
      { name: "one", description: "Use it" },
    ])
    expect(source.fingerprint).toBe("one:abc")
    expect(asked).toEqual(["b1"])
  })
})

describe("resourceKind", () => {
  it("goes by the folder", () => {
    expect(resourceKind("scripts/run.js")).toBe("script")
    expect(resourceKind("references/a.md")).toBe("reference")
    expect(resourceKind("assets/a.txt")).toBe("asset")
    expect(resourceKind("notes.md")).toBe("file")
  })
})
