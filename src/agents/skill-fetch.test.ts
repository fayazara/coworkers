import { describe, expect, it } from "vitest"
import {
  MAX_SKILL_FILE_BYTES,
  SkillSourceError,
  findSkills,
  parseSkillMd,
  parseSkillRef,
  parseTar,
  pickSkills,
  skillDigest,
  skillSource,
} from "./skill-fetch"
import type { TarFile } from "./skill-fetch"

const encode = (text: string) => new TextEncoder().encode(text)

function file(path: string, content: string | Uint8Array): TarFile {
  return {
    path,
    bytes: typeof content === "string" ? encode(content) : content,
  }
}

const skillMd = (name: string, description = "Use it for tests.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

function tarEntry(name: string, body: string, type = "0") {
  const data = encode(body)
  const header = new Uint8Array(512)
  header.set(encode(name.slice(0, 100)))
  header.set(encode(data.length.toString(8).padStart(11, "0")), 124)
  header.set(encode(type), 156)
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [header, padded]
}

function tar(...entries: Uint8Array[][]) {
  const parts = [...entries.flat(), new Uint8Array(1024)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

describe("parseSkillRef", () => {
  it("reads the command skills.sh shows", () => {
    expect(
      parseSkillRef(
        "npx skills add https://github.com/mattpocock/skills --skill code-review"
      )
    ).toMatchObject({
      kind: "github",
      owner: "mattpocock",
      repo: "skills",
      skills: ["code-review"],
      global: false,
    })
  })

  it("accepts other launchers, flags and backticks", () => {
    expect(
      parseSkillRef("`pnpx skills@latest add owner/repo -s one two -g -y`")
    ).toMatchObject({
      owner: "owner",
      repo: "repo",
      skills: ["one", "two"],
      global: true,
    })
    expect(parseSkillRef("pnpm dlx skills add owner/repo")).toMatchObject({
      owner: "owner",
    })
    expect(
      parseSkillRef("npx -y skills add owner/repo --agent claude-code codex")
    ).toMatchObject({ owner: "owner", skills: [] })
  })

  it("reads bare repos, links and listing pages", () => {
    expect(parseSkillRef("owner/repo.git")).toMatchObject({ repo: "repo" })
    expect(parseSkillRef("owner/repo@one")).toMatchObject({ skills: ["one"] })
    expect(parseSkillRef("git@github.com:owner/repo.git")).toMatchObject({
      repo: "repo",
    })
    expect(
      parseSkillRef("https://github.com/owner/repo/tree/main/skills/one")
    ).toMatchObject({ ref: "main", path: "skills/one" })
    expect(parseSkillRef("https://skills.sh/owner/repo/one")).toMatchObject({
      kind: "github",
      owner: "owner",
      repo: "repo",
      skills: ["one"],
    })
  })

  it("reads sites, with or without a scheme", () => {
    expect(parseSkillRef("developers.cloudflare.com")).toMatchObject({
      kind: "site",
      url: "https://developers.cloudflare.com",
    })
    expect(
      parseSkillRef("npx skills add https://example.com/docs --skill one")
    ).toMatchObject({
      kind: "site",
      url: "https://example.com/docs",
      skills: ["one"],
    })
  })

  it("treats --skill '*' as everything", () => {
    expect(
      parseSkillRef("npx skills add owner/repo --skill '*'").skills
    ).toEqual([])
  })

  it("refuses what it cannot read", () => {
    expect(() => parseSkillRef("")).toThrow(SkillSourceError)
    expect(() => parseSkillRef("npx skills add")).toThrow(SkillSourceError)
    expect(() => parseSkillRef("./local/path/here/now")).toThrow(
      SkillSourceError
    )
  })

  it("round-trips through its source string", () => {
    const repo = parseSkillRef("https://github.com/owner/repo --skill one")
    expect(parseSkillRef(skillSource(repo))).toMatchObject({
      owner: "owner",
      repo: "repo",
    })
    const site = parseSkillRef("example.com/docs")
    expect(skillSource(parseSkillRef(skillSource(site)))).toBe(
      "https://example.com/docs"
    )
  })
})

describe("parseTar", () => {
  it("reads files, the commit and long names", () => {
    const long = `${"a/".repeat(60)}SKILL.md`
    const { files, commit } = parseTar(
      tar(
        tarEntry("pax_global_header", "18 comment=abc123\n", "g"),
        tarEntry("repo/", "", "5"),
        tarEntry("repo/one.md", "hello"),
        tarEntry("././@LongLink", `${long}\0`, "L"),
        tarEntry("truncated", "long one")
      )
    )
    expect(commit).toBe("abc123")
    expect(files.map((f) => f.path)).toEqual(["repo/one.md", long])
    expect(new TextDecoder().decode(files[0].bytes)).toBe("hello")
  })
})

describe("parseSkillMd", () => {
  it("reads plain, quoted and block fields", () => {
    expect(
      parseSkillMd(
        `---\nname: "one"\nlicense: MIT\ndescription: >-\n  Line one\n  line two.\nmetadata:\n  a: b\n---\n\n# Body\n`
      )
    ).toEqual({
      name: "one",
      description: "Line one line two.",
      body: "# Body",
    })
    expect(
      parseSkillMd("---\nname: two\ndescription: 'It''s fine'\n---\nx")
    ).toMatchObject({ description: "It's fine", body: "x" })
  })

  it("needs frontmatter", () => {
    expect(parseSkillMd("# just a heading")).toBeNull()
  })
})

describe("findSkills", () => {
  it("makes each SKILL.md folder a skill with its files", async () => {
    const [skill, other] = await findSkills([
      file("skills/one/SKILL.md", skillMd("one")),
      file("skills/one/references/guide.md", "guide"),
      file("skills/two/SKILL.md", skillMd("two")),
      file("README.md", "not part of a skill"),
    ])
    expect(skill.name).toBe("one")
    expect(skill.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "references/guide.md",
    ])
    expect(other.files.map((f) => f.path)).toEqual(["SKILL.md"])
  })

  it("keeps a root skill to its resource folders", async () => {
    const [skill] = await findSkills([
      file("SKILL.md", skillMd("root")),
      file("scripts/run.js", "export default 1"),
      file("src/app.ts", "app code"),
    ])
    expect(skill.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "scripts/run.js",
    ])
  })

  it("skips binary and oversized files, and says so", async () => {
    const [skill] = await findSkills([
      file("one/SKILL.md", skillMd("one")),
      file("one/logo.png", new Uint8Array([137, 80, 0, 71])),
      file("one/big.md", "x".repeat(MAX_SKILL_FILE_BYTES + 1)),
    ])
    expect(skill.skipped.sort()).toEqual(["big.md", "logo.png"])
  })

  it("ignores folders without usable frontmatter and vendored copies", async () => {
    expect(
      await findSkills([
        file("one/SKILL.md", "# no frontmatter"),
        file("node_modules/pkg/SKILL.md", skillMd("vendored")),
      ])
    ).toEqual([])
  })

  it("prefers the shallowest copy of a name", async () => {
    const skills = await findSkills([
      file("deep/down/one/SKILL.md", skillMd("one", "Deep copy.")),
      file("one/SKILL.md", skillMd("one", "Real one.")),
    ])
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe("Real one.")
  })
})

describe("pickSkills", () => {
  it("names what is there when the skill is missing", async () => {
    const skills = await findSkills([file("one/SKILL.md", skillMd("one"))])
    expect(pickSkills(skills, [])).toEqual(skills)
    expect(pickSkills(skills, ["one"])).toEqual(skills)
    expect(() => pickSkills(skills, ["two"])).toThrow(/It has: one/)
  })
})

describe("skillDigest", () => {
  it("ignores file order and notices any change", async () => {
    const a = { path: "a", content: "1" }
    const b = { path: "b", content: "2" }
    expect(await skillDigest([a, b])).toBe(await skillDigest([b, a]))
    expect(await skillDigest([a, b])).not.toBe(
      await skillDigest([a, { ...b, content: "3" }])
    )
  })
})
