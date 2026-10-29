/**
 * `pnpm run setup`: deploy Coworkers to your account with the `cf` CLI, the same
 * way the installer does: AI Gateway, Cloudflare Access in front, Web Push
 * keys. Run it again any time to update; it picks up where you left off.
 *
 *   1. asks for the account, name, who can sign in, and a model
 *   2. creates the AI Gateway
 *   3. deploys once with Access required but not set up yet, so every
 *      request is refused while the URL is new
 *   4. sets up Access (allow list, plus a bypass for /apps and /api/hooks)
 *   5. deploys again with the Access application's AUD
 *
 * Choices go in coworkers.deploy.json (read by cloudflare.config.ts) and secrets
 * in .dev.vars.production. Both are git-ignored.
 */
import { spawn } from "node:child_process"
import { generateKeyPairSync } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { MODELS, PROVIDERS } from "../src/lib/models.ts"

const DEPLOY_FILE = "coworkers.deploy.json"
const LEGACY_DEPLOY_FILE = "bdots.deploy.json"
const SECRETS_FILE = ".dev.vars.production"
/** Access is required but nothing can pass it: the first deploy is closed. */
const LOCKED = { accessTeamDomain: "locked.invalid", accessAud: "locked" }

interface DeployFile {
  accountId?: string
  name?: string
  model?: string
  gateway?: string
  emails?: string[]
  host?: string
  accessTeamDomain?: string
  accessAud?: string
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

function step(whimsy: string, detail: string) {
  console.log(`\n${bold(`◆ ${whimsy}`)} ${dim(detail)}`)
}

/**
 * `--yes` (or no terminal) takes the answers saved in coworkers.deploy.json, and
 * the defaults for the rest, without asking.
 */
const interactive = process.stdin.isTTY && !process.argv.includes("--yes")
const rl = interactive
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null

async function ask(question: string, fallback = "") {
  if (!rl) return fallback
  const answer = await rl.question(
    `  ${question}${fallback ? dim(` (${fallback})`) : ""}: `
  )
  return answer.trim() || fallback
}

async function choose<T>(
  question: string,
  items: T[],
  label: (t: T) => string
) {
  if (!rl) return items[0]
  items.forEach((item, i) =>
    console.log(`  ${dim(`${i + 1}.`)} ${label(item)}`)
  )
  for (;;) {
    const n = Number(await ask(question, "1"))
    if (items[n - 1]) return items[n - 1]
  }
}

/** Runs `cf`, returns its JSON stdout. Throws with its stderr on failure. */
function cf<T = unknown>(
  args: string[],
  options: { accountId?: string; echo?: boolean } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn("cf", args, {
      env: {
        ...process.env,
        ...(options.accountId
          ? { CLOUDFLARE_ACCOUNT_ID: options.accountId }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => {
      out += chunk
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on("data", (chunk) => {
      err += chunk
      if (options.echo) process.stderr.write(chunk)
    })
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `cf ${args[0]} exited with ${code}`))
        return
      }
      try {
        resolve((out.trim() ? JSON.parse(out) : null) as T)
      } catch {
        // Not JSON (cf deploy): hand back everything it printed.
        resolve(`${out}\n${err}` as T)
      }
    })
  })
}

/** `cf ... get` that is null on a 404 instead of throwing. */
async function maybe<T>(args: string[], accountId: string) {
  try {
    return await cf<T>(args, { accountId })
  } catch (err) {
    if (/not.?found|404|does not exist/i.test(String(err))) return null
    throw err
  }
}

function readDeploy(): DeployFile {
  // Moves a deployment set up before the rename to the new file name.
  const file = [DEPLOY_FILE, LEGACY_DEPLOY_FILE].find((f) => existsSync(f))
  return file ? JSON.parse(readFileSync(file, "utf8")) : {}
}

function writeDeploy(file: DeployFile) {
  writeFileSync(DEPLOY_FILE, `${JSON.stringify(file, null, 2)}\n`)
}

/** VAPID keys for Web Push, created once and kept: new keys break subscriptions. */
/**
 * Optional secrets Coworkers declares. `cf deploy` refuses to create a Worker
 * while any declared secret is missing, and Coworkers treats an empty one as
 * "feature off", so they start empty.
 */
const OPTIONAL_SECRETS = [
  "BROWSER_RUN_API_TOKEN",
  "PARALLEL_API_KEY",
  "AI_GATEWAY_API_TOKEN",
]

function ensureSecrets() {
  let file = existsSync(SECRETS_FILE) ? readFileSync(SECRETS_FILE, "utf8") : ""
  let created = false
  if (!/^VAPID_PRIVATE_KEY=\S+/m.test(file)) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    })
    const pub = publicKey.export({ format: "jwk" })
    const priv = privateKey.export({ format: "jwk" })
    const raw = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(pub.x!, "base64url"),
      Buffer.from(pub.y!, "base64url"),
    ])
    file += `\nVAPID_PUBLIC_KEY=${raw.toString("base64url")}\nVAPID_PRIVATE_KEY=${priv.d}\n`
    created = true
  }
  for (const name of OPTIONAL_SECRETS) {
    if (!new RegExp(`^${name}=`, "m").test(file)) file += `\n${name}=\n`
  }
  writeFileSync(SECRETS_FILE, `${file.replace(/\n{2,}/g, "\n").trim()}\n`)
  return created ? "created" : "kept"
}

/** `pnpm build` (bindings come from coworkers.deploy.json at build time). */
function build() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["build"], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let err = ""
    child.stderr.on("data", (chunk) => (err += chunk))
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`pnpm build failed:\n${err.trim()}`))
    )
  })
}

async function deploy(accountId: string) {
  // Build with pnpm, not whatever `cf` would pick when this script was not
  // started through pnpm (npx vite resolves the decorator plugin differently).
  await build()
  const output = await cf<string>(
    ["deploy", "--prebuilt", "--secrets-file", SECRETS_FILE],
    { accountId, echo: true }
  )
  return String(output).match(
    /https:\/\/([a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)/
  )?.[1]
}

interface Named {
  id: string
  name: string
}

async function upsert(
  kind: "policies" | "applications",
  accountId: string,
  existing: Named[],
  body: { name: string } & Record<string, unknown>
) {
  const found = existing.find((e) => e.name === body.name)
  const args = found
    ? ["zero-trust", "access", kind, "update", found.id]
    : ["zero-trust", "access", kind, "create"]
  return cf<Named & { aud?: string }>(
    [...args, "--body", JSON.stringify(body)],
    {
      accountId,
    }
  )
}

async function main() {
  const saved = readDeploy()
  console.log(
    `\n${bold("Coworkers setup")} ${dim("deploys to your Cloudflare account with cf")}`
  )

  // ── Choices ──────────────────────────────────────────────────────
  step("Measuring the workshop", "who you are and where Coworkers goes")
  const [user, accounts] = await Promise.all([
    cf<{ email: string }>(["user", "get"]),
    cf<Named[]>(["accounts", "list"]),
  ]).catch((err) => {
    throw new Error(`${err.message}\n\nSign in first: cf auth login`)
  })
  const preset = saved.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
  let account = accounts.find((a) => a.id === preset)
  if (!account && accounts.length === 1) account = accounts[0]
  if (!account && !rl) {
    throw new Error(
      "More than one account. Set CLOUDFLARE_ACCOUNT_ID, or run without --yes to pick one."
    )
  }
  account ??= await choose("Account", accounts, (a) => a.name)
  console.log(`  Account: ${account.name}`)

  const name = (
    await ask("Worker name", saved.name ?? "coworkers")
  ).toLowerCase()
  const emails = (
    await ask(
      "Who can sign in (comma separated)",
      (saved.emails ?? [user.email]).join(", ")
    )
  )
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  let model = saved.model
  if (
    !model ||
    (await ask("Change the model? y/N", "n")).toLowerCase() === "y"
  ) {
    const provider = await choose(
      "Provider",
      PROVIDERS,
      (p) => `${p.name} ${dim(p.billing)}`
    )
    const picked = await choose(
      "Model",
      MODELS.filter((m) => m.provider === provider.id),
      (m) => `${m.name} ${dim(m.blurb)}`
    )
    model = picked.id
  }
  const gateway = saved.gateway ?? "coworkers"
  rl?.close()

  const accountId = account.id
  // A new name (or account) is a new Worker: start its URL and Access over.
  const fresh = name !== saved.name || accountId !== saved.accountId
  let file: DeployFile = {
    ...(fresh ? {} : saved),
    accountId,
    name,
    emails,
    model,
    gateway,
  }

  // ── AI Gateway ───────────────────────────────────────────────────
  step("Wiring up the brain", `AI Gateway ${gateway}`)
  if (await maybe(["ai-gateway", "gateways", "get", gateway], accountId)) {
    console.log("  Already there")
  } else {
    await cf(
      [
        "ai-gateway",
        "gateways",
        "create",
        "--id",
        gateway,
        "--authentication",
        "--collect-logs",
        "--cache-invalidate-on-update",
        "--cache-ttl",
        "0",
        "--rate-limiting-interval",
        "0",
        "--rate-limiting-limit",
        "0",
      ],
      { accountId }
    )
    console.log(green("  Created"))
  }

  step("Making a key for the doorbell", "Web Push keys")
  console.log(`  ${ensureSecrets()} in ${SECRETS_FILE}`)

  // ── First deploy, closed ─────────────────────────────────────────
  if (!file.host || !file.accessAud) {
    step("Bolting on the parts", "first deploy, closed until Access is ready")
    writeDeploy({ ...file, ...LOCKED })
    const host = await deploy(accountId)
    file.host = host ?? file.host
    if (!file.host) {
      throw new Error(
        'Could not find the workers.dev URL in the deploy output. Add "host" to coworkers.deploy.json and run setup again.'
      )
    }
    writeDeploy({ ...file, ...LOCKED })
  }
  const host = file.host!

  // ── Access ───────────────────────────────────────────────────────
  step("Hiring a bouncer", `Cloudflare Access for ${host}`)
  let org = await maybe<{ auth_domain: string }>(
    ["zero-trust", "organization", "get"],
    accountId
  )
  if (!org) {
    const team = host.split(".")[1]
    org = await cf<{ auth_domain: string }>(
      [
        "zero-trust",
        "organization",
        "create",
        "--body",
        JSON.stringify({
          name: team,
          auth_domain: `${team}.cloudflareaccess.com`,
        }),
      ],
      { accountId }
    ).catch((err) => {
      throw new Error(
        `${err.message}\n\nTurn on Zero Trust once (the free plan is fine) at https://one.dash.cloudflare.com/ and run setup again.`
      )
    })
  }
  const idps = await cf<Named[]>(["zero-trust", "identity-providers", "list"], {
    accountId,
  })
  if (idps.length === 0) {
    // A new organization has no way to sign in yet. An existing one keeps
    // its own, so other apps do not change.
    await cf(
      [
        "zero-trust",
        "identity-providers",
        "create",
        "--body",
        JSON.stringify({
          name: "One-time PIN",
          type: "onetimepin",
          config: {},
        }),
      ],
      { accountId }
    )
  }
  const policies = await cf<Named[]>(
    ["zero-trust", "access", "policies", "list"],
    { accountId }
  )
  const allow = await upsert("policies", accountId, policies, {
    name: `coworkers ${name}: people`,
    decision: "allow",
    include: emails.map((email) => ({ email: { email } })),
  })
  const bypass = await upsert("policies", accountId, policies, {
    name: `coworkers ${name}: share links and webhooks`,
    decision: "bypass",
    include: [{ everyone: {} }],
  })
  const apps = await cf<Named[]>(
    ["zero-trust", "access", "applications", "list"],
    { accountId }
  )
  // Public hostname destinations: Worker destinations refuse WebSockets.
  const app = await upsert("applications", accountId, apps, {
    type: "self_hosted",
    name: `coworkers ${name}`,
    destinations: [{ type: "public", uri: host }],
    policies: [allow.id],
    session_duration: "720h",
    app_launcher_visible: true,
  })
  await upsert("applications", accountId, apps, {
    type: "self_hosted",
    name: `coworkers ${name}: links`,
    destinations: [
      { type: "public", uri: `${host}/apps` },
      { type: "public", uri: `${host}/api/hooks` },
    ],
    policies: [bypass.id],
    app_launcher_visible: false,
  })
  if (!app.aud)
    throw new Error("Access did not return the application's AUD tag.")
  console.log(
    `  ${emails.length} ${emails.length === 1 ? "person" : "people"} on the list`
  )

  // ── Final deploy ─────────────────────────────────────────────────
  step("Flipping the switch", "deploying with Access")
  file = { ...file, accessTeamDomain: org.auth_domain, accessAud: app.aud }
  writeDeploy(file)
  await deploy(accountId)

  console.log(`\n${green(bold("Your bots are alive"))} https://${host}`)
  console.log(
    dim(`  Sign in as ${emails[0]}. Access emails you a one-time code.`)
  )
  console.log(
    dim(
      "  Pick models any time on the Models page. Run pnpm run setup again to update.\n"
    )
  )
}

main().catch((err) => {
  rl?.close()
  console.error(
    `\n\x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : err}\n`
  )
  process.exit(1)
})
