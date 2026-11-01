/**
 * Finding Agent Skills from what people paste: `npx skills add` commands,
 * GitHub links and sites that publish `/.well-known/agent-skills/index.json`.
 * Commands are only ever parsed, never run. Nothing here installs anything:
 * the hub does that once the user has read what was found.
 */

/** Largest decompressed archive we read. */
const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024
/** Files above this stay behind: a skill is instructions, not data. */
export const MAX_SKILL_FILE_BYTES = 256 * 1024
export const MAX_SKILL_BYTES = 1024 * 1024
/** A site's index can list more; each one is a fetch. */
const MAX_SITE_SKILLS = 30
const SKILL_FILE = "SKILL.md"
/** A root SKILL.md shares its folder with the whole repo. */
const ROOT_RESOURCE = /^(references|scripts|assets)\//
const IGNORED_PATH = /(^|\/)(node_modules|\.git|__MACOSX)\//

export type SkillRef = (
  | {
      kind: "github"
      owner: string
      repo: string
      /** A branch, tag or commit. Absent: the default branch. */
      ref?: string
      /** Only skills under this folder. */
      path?: string
    }
  | { kind: "site"; url: string }
) & {
  /** Names asked for. Empty: everything found. */
  skills: string[]
  /** `-g`: the user wants it for all bots. */
  global: boolean
}

export interface SkillFile {
  path: string
  content: string
}

export interface FoundSkill {
  name: string
  description: string
  /** SKILL.md first. */
  files: SkillFile[]
  /** Paths left out: binary, too large, or past the size limit. */
  skipped: string[]
  digest: string
}

export interface SkillBundle {
  /** Parses back to the same place, without the names asked for. */
  source: string
  /** The commit it came from. Empty for sites, which have no versions. */
  version: string
  skills: FoundSkill[]
}

/** Something wrong with what the user pasted or where it points. */
export class SkillSourceError extends Error {}

const LAUNCHERS = new Set(["npx", "pnpx", "bunx"])
const SKILLS_CLI = /^skills(@.+)?$/
const SHORTHAND = /^([\w-]+)\/([\w.-]+?)(?:\.git)?(?:@([\w.-]+))?(?:\/(.+))?$/
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i
const SSH_REPO = /^git@github\.com:([\w-]+)\/([\w.-]+?)(?:\.git)?$/

function tokenize(text: string) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    token.replace(/^["']|["']$/g, "")
  )
}

/** Drop the launcher and `skills add`, however it was started. */
function dropCommand(tokens: string[]) {
  let rest = tokens
  if (rest[0] === "$") rest = rest.slice(1)
  if (LAUNCHERS.has(rest[0])) rest = rest.slice(1)
  else if (["pnpm", "yarn"].includes(rest[0]) && rest[1] === "dlx") {
    rest = rest.slice(2)
  }
  while (rest[0]?.startsWith("-")) rest = rest.slice(1)
  if (SKILLS_CLI.test(rest[0] ?? "")) {
    rest = rest.slice(1)
    if (["add", "install", "a", "i"].includes(rest[0])) rest = rest.slice(1)
  }
  return rest
}

function githubFromUrl(url: URL) {
  const [owner, rawRepo, kind, ref, ...path] = url.pathname
    .split("/")
    .filter(Boolean)
  if (!owner || !rawRepo) {
    throw new SkillSourceError("That GitHub link has no repository in it.")
  }
  const repo = rawRepo.replace(/\.git$/, "")
  if (kind !== "tree" && kind !== "blob") return { owner, repo }
  const folder = (kind === "blob" ? path.slice(0, -1) : path).join("/")
  return {
    owner,
    repo,
    ...(ref ? { ref } : {}),
    ...(folder ? { path: folder } : {}),
  }
}

function parseTarget(target: string): {
  ref:
    | Omit<Extract<SkillRef, { kind: "github" }>, "skills" | "global">
    | { kind: "site"; url: string }
  skill?: string
} {
  const ssh = SSH_REPO.exec(target)
  if (ssh) return { ref: { kind: "github", owner: ssh[1], repo: ssh[2] } }
  if (/^https?:\/\//i.test(target)) {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      throw new SkillSourceError(`"${target}" is not a valid link.`)
    }
    const host = url.hostname.replace(/^www\./, "")
    if (host === "github.com") {
      return { ref: { kind: "github", ...githubFromUrl(url) } }
    }
    // The listing page for a skill: the skill itself lives in the repo.
    if (host === "skills.sh") {
      const [owner, repo, skill] = url.pathname.split("/").filter(Boolean)
      if (owner && repo) {
        return { ref: { kind: "github", owner, repo }, skill }
      }
    }
    return { ref: { kind: "site", url: `https://${url.host}${url.pathname}` } }
  }
  if (DOMAIN.test(target)) {
    return { ref: { kind: "site", url: `https://${target}` } }
  }
  const short = SHORTHAND.exec(target)
  if (short) {
    const [, owner, repo, skill, path] = short
    return {
      ref: { kind: "github", owner, repo, ...(path ? { path } : {}) },
      skill,
    }
  }
  throw new SkillSourceError(
    `Could not read "${target}". Use an npx skills add command, a GitHub repo or a site that publishes skills.`
  )
}

/** Read what the user pasted. Throws SkillSourceError when it makes no sense. */
export function parseSkillRef(input: string): SkillRef {
  const line = input
    .replace(/`/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
  const tokens = dropCommand(tokenize(line ?? ""))
  const skills: string[] = []
  let target: string | undefined
  let global = false
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === "-g" || token === "--global") global = true
    else if (token === "-s" || token === "--skill") {
      while (tokens[i + 1] && !tokens[i + 1].startsWith("-")) {
        skills.push(tokens[++i])
      }
    } else if (token.startsWith("--skill=")) {
      skills.push(token.slice("--skill=".length))
    } else if (token === "-a" || token === "--agent") {
      while (tokens[i + 1] && !tokens[i + 1].startsWith("-")) i++
    } else if (!token.startsWith("-")) target ??= token
    // Other flags (-y, --all, --copy) change nothing here. -y in particular
    // never skips the user's review.
  }
  if (!target) {
    throw new SkillSourceError(
      "Paste an npx skills add command, a GitHub repo or a site."
    )
  }
  const { ref, skill } = parseTarget(target)
  if (skill) skills.push(skill)
  return { ...ref, skills: skills.filter((s) => s !== "*"), global }
}

/** Where a ref points, as a string `parseSkillRef` reads back. */
export function skillSource(ref: SkillRef) {
  return ref.kind === "github" ? `${ref.owner}/${ref.repo}` : ref.url
}

// ── Archives ────────────────────────────────────────────────────────

const decoder = new TextDecoder()

function tarString(bytes: Uint8Array, start: number, length: number) {
  const end = bytes.subarray(start, start + length).indexOf(0)
  return decoder.decode(
    bytes.subarray(start, end === -1 ? start + length : start + end)
  )
}

/** pax records: "<length> <key>=<value>\n". */
function paxRecords(bytes: Uint8Array) {
  const records: Record<string, string> = {}
  let at = 0
  while (at < bytes.length) {
    let space = at
    while (space < bytes.length && bytes[space] !== 32) space++
    const length = Number(decoder.decode(bytes.subarray(at, space)))
    if (!length) break
    const record = decoder.decode(bytes.subarray(space + 1, at + length - 1))
    const equals = record.indexOf("=")
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    at += length
  }
  return records
}

export interface TarFile {
  path: string
  bytes: Uint8Array
}

/** The regular files in a tar, and its `git archive` commit if it has one. */
export function parseTar(tar: Uint8Array) {
  const files: TarFile[] = []
  let commit = ""
  let longName: string | undefined
  let at = 0
  while (at + 512 <= tar.length && tar[at] !== 0) {
    const size = parseInt(tarString(tar, at + 124, 12).trim() || "0", 8)
    const type = String.fromCharCode(tar[at + 156] || 48)
    const body = tar.subarray(at + 512, at + 512 + size)
    if (type === "g") commit = paxRecords(body).comment ?? commit
    else if (type === "x") longName = paxRecords(body).path ?? longName
    else if (type === "L") longName = tarString(body, 0, size)
    else {
      if (type === "0") {
        const prefix = tarString(tar, at + 345, 155)
        const name = tarString(tar, at, 100)
        files.push({
          path: longName ?? (prefix ? `${prefix}/${name}` : name),
          bytes: body,
        })
      }
      longName = undefined
    }
    at += 512 + Math.ceil(size / 512) * 512
  }
  return { files, commit }
}

async function gunzip(body: ReadableStream<Uint8Array>) {
  const reader = body
    .pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair)
    .getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_ARCHIVE_BYTES) {
      await reader.cancel()
      throw new SkillSourceError("That archive is too large to read.")
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

// ── Skills ──────────────────────────────────────────────────────────

const strictDecoder = new TextDecoder("utf-8", { fatal: true })

function textOf(bytes: Uint8Array) {
  if (bytes.includes(0)) return null
  try {
    return strictDecoder.decode(bytes)
  } catch {
    return null
  }
}

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** One hash for a skill's files, so the same files always give the same one. */
export function skillDigest(files: SkillFile[]) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1))
  return sha256(
    new TextEncoder().encode(
      sorted.map((f) => `${f.path}\0${f.content}\0`).join("")
    )
  )
}

function slugName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function scalar(lines: string[], key: string) {
  const start = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (start === -1) return ""
  const value = lines[start].slice(key.length + 1).trim()
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value && !/^[>|][+-]?$/.test(value)) return value
  // A block scalar: the indented lines that follow.
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.trim() && !/^\s/.test(l))
  return (end === -1 ? rest : rest.slice(0, end))
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
}

/** The two fields skills need, and the Markdown after them. */
export function parseSkillMd(raw: string) {
  const match = FRONTMATTER.exec(raw)
  if (!match) return null
  const lines = match[1].split(/\r?\n/)
  return {
    name: scalar(lines, "name"),
    description: scalar(lines, "description"),
    body: raw.slice(match[0].length).trim(),
  }
}

async function toSkill(raw: string, dir: string, others: TarFile[]) {
  const parsed = parseSkillMd(raw)
  const name = parsed && slugName(parsed.name)
  if (!parsed || !name || !parsed.description) return null
  const files: SkillFile[] = [{ path: SKILL_FILE, content: raw }]
  const skipped: string[] = []
  let total = raw.length
  for (const file of others) {
    const path = file.path.slice(dir.length)
    const content =
      file.bytes.length <= MAX_SKILL_FILE_BYTES ? textOf(file.bytes) : null
    if (content === null || total + content.length > MAX_SKILL_BYTES) {
      skipped.push(path)
      continue
    }
    total += content.length
    files.push({ path, content })
  }
  return {
    name,
    description: parsed.description,
    files,
    skipped,
    digest: await skillDigest(files),
  } satisfies FoundSkill
}

/**
 * Every folder with a SKILL.md is a skill, and the files beside it are its
 * resources. Shallowest first, so a repo's real skill beats a nested copy.
 */
export async function findSkills(files: TarFile[]): Promise<FoundSkill[]> {
  const usable = files.filter((f) => !IGNORED_PATH.test(f.path))
  const dirs = usable
    .filter((f) => f.path === SKILL_FILE || f.path.endsWith(`/${SKILL_FILE}`))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
  const found = new Map<string, FoundSkill>()
  for (const entry of dirs) {
    if (entry.bytes.length > MAX_SKILL_FILE_BYTES) continue
    const raw = textOf(entry.bytes)
    if (raw === null) continue
    const dir = entry.path.slice(0, -SKILL_FILE.length)
    const others = usable.filter(
      (f) =>
        f !== entry &&
        f.path.startsWith(dir) &&
        (dir || ROOT_RESOURCE.test(f.path))
    )
    const skill = await toSkill(raw, dir, others)
    if (skill && !found.has(skill.name)) found.set(skill.name, skill)
  }
  return [...found.values()]
}

/** The skills the user asked for, or an error naming what is there. */
export function pickSkills(skills: FoundSkill[], wanted: string[]) {
  if (!wanted.length) return skills
  const names = new Set(wanted.map(slugName))
  const picked = skills.filter((s) => names.has(s.name))
  if (picked.length) return picked
  throw new SkillSourceError(
    `No skill named ${wanted.join(", ")} there. It has: ${skills
      .slice(0, 20)
      .map((s) => s.name)
      .join(", ")}.`
  )
}

/** Paths in a GitHub archive start with `<repo>-<ref>/`. */
function stripRoot(files: TarFile[]) {
  return files.map((f) => ({ ...f, path: f.path.replace(/^[^/]+\//, "") }))
}

async function fetchGitHub(
  ref: Extract<SkillRef, { kind: "github" }>,
  version?: string
): Promise<SkillBundle> {
  const at = version ?? ref.ref ?? "HEAD"
  // codeload, not the REST API: unauthenticated API calls share a small limit
  // across every Worker on the same IPs.
  const res = await fetch(
    `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${encodeURIComponent(at)}`
  )
  if (res.status === 404) {
    throw new SkillSourceError(
      `Could not find ${ref.owner}/${ref.repo}. Is it a public repo?`
    )
  }
  if (!res.ok || !res.body) {
    throw new SkillSourceError(`GitHub answered ${res.status}. Try again.`)
  }
  const { files, commit } = parseTar(await gunzip(res.body))
  const within = stripRoot(files).filter(
    (f) => !ref.path || f.path.startsWith(`${ref.path.replace(/\/$/, "")}/`)
  )
  const skills = await findSkills(within)
  if (!skills.length) {
    throw new SkillSourceError(
      `No skills in ${ref.owner}/${ref.repo}${ref.path ? `/${ref.path}` : ""}. A skill is a folder with a SKILL.md.`
    )
  }
  return {
    source: skillSource(ref),
    version: version ?? commit,
    skills: pickSkills(skills, ref.skills),
  }
}

interface IndexEntry {
  name: string
  type: string
  url: string
  digest: string
}

async function fetchIndex(url: string) {
  const bases = [url.replace(/\/$/, ""), new URL(url).origin]
  for (const base of new Set(bases)) {
    for (const dir of ["agent-skills", "skills"]) {
      const indexUrl = `${base}/.well-known/${dir}/index.json`
      const res = await fetch(indexUrl).catch(() => null)
      if (!res?.ok) continue
      const index = (await res.json().catch(() => null)) as {
        $schema?: string
        skills?: IndexEntry[]
      } | null
      // Before 0.2 the index had no digests, so nothing could be checked.
      if (index?.$schema && Array.isArray(index.skills)) {
        return { indexUrl, entries: index.skills }
      }
    }
  }
  return null
}

async function fetchSiteSkill(entry: IndexEntry, indexUrl: string) {
  const res = await fetch(new URL(entry.url, indexUrl))
  if (!res.ok) throw new SkillSourceError(`${entry.name}: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (`sha256:${await sha256(bytes)}` !== entry.digest) {
    throw new SkillSourceError(
      `${entry.name} does not match the digest its site publishes, so it was not read.`
    )
  }
  if (entry.type === "skill-md") {
    const raw = textOf(bytes)
    return raw === null ? null : toSkill(raw, "", [])
  }
  if (entry.type !== "archive" || !/\.(tar\.gz|tgz)$/.test(entry.url)) {
    return null
  }
  const stream = new Response(bytes).body!
  const [skill] = await findSkills(parseTar(await gunzip(stream)).files)
  return skill ?? null
}

async function fetchSite(
  ref: Extract<SkillRef, { kind: "site" }>
): Promise<SkillBundle> {
  const index = await fetchIndex(ref.url)
  if (!index) {
    throw new SkillSourceError(
      `${new URL(ref.url).host} does not publish skills at /.well-known/agent-skills/.`
    )
  }
  const wanted = new Set(ref.skills.map(slugName))
  const entries = index.entries.filter(
    (e) => !wanted.size || wanted.has(slugName(e.name))
  )
  if (!entries.length) {
    throw new SkillSourceError(
      `No skill named ${ref.skills.join(", ")} there. It has: ${index.entries
        .slice(0, 20)
        .map((e) => e.name)
        .join(", ")}.`
    )
  }
  const skills = await Promise.all(
    entries
      .slice(0, MAX_SITE_SKILLS)
      .map((entry) => fetchSiteSkill(entry, index.indexUrl))
  )
  const found = skills.filter((s) => s !== null)
  if (!found.length) {
    throw new SkillSourceError("None of the skills there could be read.")
  }
  return { source: skillSource(ref), version: "", skills: found }
}

/** Fetch what a ref points at. `version` pins a repo to the reviewed commit. */
export function fetchSkillBundle(ref: SkillRef, version?: string) {
  return ref.kind === "github"
    ? fetchGitHub(ref, version || undefined)
    : fetchSite(ref)
}
