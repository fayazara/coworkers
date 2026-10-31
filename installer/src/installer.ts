import { Agent, callable } from "agents"
import { isModelId } from "@coworkers/models"
import { CfApi, CfApiError } from "./cf-api"
import { SCRIPT_TAG, putScript, uploadAssets, vapidKeys } from "./deploy/upload"
import { OAuthError, refresh } from "./oauth"
import type { Tokens } from "./oauth"
import { loadRelease } from "./release"
import { decrypt, encrypt } from "./session"
import { INITIAL_STATE, STEP_ORDER, isDemo, isWorkerName } from "./shared"
import type {
  InstallError,
  InstallPlan,
  InstallerState,
  NameCheck,
  StepId,
  Zone,
} from "./shared"

/** What earlier steps found out, for later steps and for a retry. */
interface Progress {
  subdomain?: string
  fresh?: boolean
  /** The existing Worker's Durable Object migration tag, on an update. */
  migrationTag?: string
  teamDomain?: string
  aud?: string
}

/** A step failed in a way the user can do something about. */
class StepError extends Error {
  constructor(
    message: string,
    readonly remedy?: string,
    readonly link?: InstallError["link"]
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Paths Access lets through: they carry their own tokens. Shared app links,
 * webhooks, and what an MCP client calls on its own. Keep in step with
 * scripts/setup.ts.
 */
const BYPASS_PATHS = [
  "/apps",
  "/api/hooks",
  "/mcp",
  "/oauth/token",
  "/oauth/register",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
]

/** What a 403 on each step means, in the user's terms. */
const DENIED: Record<StepId, string> = {
  account: "read this account's Workers settings",
  gateway: "create an AI Gateway",
  access: "set up Cloudflare Access",
  upload: "upload Workers",
  publish: "publish Workers on a URL",
  wake: "reach the new Worker",
}

/**
 * One per sign-in (instance name = the session id in the browser's
 * cookie). Holds the user's OAuth token, encrypted, and runs the install
 * against their account. Its state is the progress the page shows.
 *
 * `@callable()` methods come from the page over the agent WebSocket;
 * `signIn` is Durable Object RPC from the OAuth callback.
 */
export class Installer extends Agent<Env, InstallerState> {
  initialState: InstallerState = INITIAL_STATE

  private get demo() {
    return isDemo(this.env)
  }

  // ── Sign-in (RPC from the Worker) ──────────────────────────────────

  async signIn(tokens: Tokens | null) {
    let email = "you@example.com"
    let accounts = [
      { id: "demo-1", name: "Personal" },
      { id: "demo-2", name: "Robots Inc." },
    ]
    if (!this.demo) {
      if (!tokens) throw new Error("No tokens")
      await this.saveTokens(tokens)
      const api = this.api()
      ;[{ email }, accounts] = await Promise.all([api.user(), api.accounts()])
    }
    const release = await loadRelease(this.env.ASSETS)
      .then((r) => r.release)
      .catch(() => null)
    this.setState({
      ...INITIAL_STATE,
      user: { email },
      accounts: accounts.map(({ id, name }) => ({ id, name })),
      release,
    })
  }

  async signedIn() {
    return this.state.user !== null
  }

  /** RPC from the Worker on logout: the Cloudflare tokens go too. */
  async signOut() {
    this.ctx.storage.kv.delete("tokens")
    this.setState(INITIAL_STATE)
  }

  // ── Setup (from the page) ──────────────────────────────────────────

  @callable()
  async zones(accountId: string): Promise<Zone[]> {
    this.assertAccount(accountId)
    if (this.demo) return [{ id: "z1", name: "example.com" }]
    const zones = await this.api().zones(accountId)
    return zones.map(({ id, name }) => ({ id, name }))
  }

  @callable()
  async checkName(accountId: string, name: string): Promise<NameCheck> {
    this.assertAccount(accountId)
    if (!isWorkerName(name)) {
      return {
        ok: false,
        reason: "Use lowercase letters, numbers and dashes.",
      }
    }
    if (this.demo) {
      return {
        ok: true,
        url: `https://${name}.you.workers.dev`,
        updating: false,
      }
    }
    const api = this.api()
    const [subdomain, script] = await Promise.all([
      api.workersSubdomain(accountId),
      api.script(accountId, name),
    ])
    if (script && !script.tags?.includes(SCRIPT_TAG)) {
      return {
        ok: false,
        reason: `This account already has a Worker called ${name}. Pick another name.`,
      }
    }
    return {
      ok: true,
      url: `https://${name}.${subdomain ?? "<your-subdomain>"}.workers.dev`,
      updating: !!script,
    }
  }

  @callable()
  async install(plan: InstallPlan) {
    if (this.state.phase === "installing") return
    this.assertAccount(plan.accountId)
    const emails = [
      ...new Set(
        plan.emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
      ),
    ]
    if (!isWorkerName(plan.name)) throw new Error("That name will not work.")
    if (!isModelId(plan.model)) throw new Error("Pick a model.")
    if (!isWorkerName(plan.gateway)) throw new Error("Bad gateway name.")
    if (
      emails.length === 0 ||
      emails.some((e) => !/^[^@\s]+@[^@\s]+$/.test(e))
    ) {
      throw new Error("Add at least one valid email address.")
    }
    if (
      plan.domain &&
      !plan.domain.hostname.endsWith(`.${plan.domain.zoneName}`) &&
      plan.domain.hostname !== plan.domain.zoneName
    ) {
      throw new Error(`The hostname has to be on ${plan.domain.zoneName}.`)
    }
    this.ctx.storage.kv.put<Progress>("progress", {})
    this.setState({
      ...this.state,
      phase: "installing",
      plan: { ...plan, emails },
      steps: STEP_ORDER.map((id) => ({ id, status: "pending" })),
      error: null,
      url: null,
    })
    await this.schedule(0, "run")
  }

  /** Pick up after a failure, from the step that failed. */
  @callable()
  async tryAgain() {
    if (this.state.phase !== "failed" || !this.state.plan) return
    this.setState({ ...this.state, phase: "installing", error: null })
    await this.schedule(0, "run")
  }

  /** Back to the setup screen, keeping the sign-in. */
  @callable()
  startOver() {
    if (this.state.phase === "installing") return
    this.setState({
      ...INITIAL_STATE,
      user: this.state.user,
      accounts: this.state.accounts,
      release: this.state.release,
    })
  }

  // ── The install ────────────────────────────────────────────────────

  async run() {
    const plan = this.state.plan
    if (!plan || this.state.phase !== "installing") return
    for (const id of STEP_ORDER) {
      const step = this.state.steps.find((s) => s.id === id)
      if (step?.status === "done" || step?.status === "skipped") continue
      this.patchStep(id, { status: "running", detail: undefined })
      try {
        const detail = this.demo
          ? await this.demoStep(id)
          : await this.step(id, plan)
        this.patchStep(id, { status: "done", detail: detail ?? undefined })
      } catch (err) {
        console.error(`Install step ${id} failed`, err)
        this.patchStep(id, { status: "failed" })
        this.setState({
          ...this.state,
          phase: "failed",
          error: this.explain(id, err),
        })
        return
      }
    }
    this.setState({ ...this.state, phase: "done" })
  }

  private async step(id: StepId, plan: InstallPlan): Promise<string | null> {
    const api = this.api()
    const progress = this.ctx.storage.kv.get<Progress>("progress") ?? {}
    const save = (patch: Progress) =>
      this.ctx.storage.kv.put("progress", { ...progress, ...patch })
    const host = () =>
      plan.domain?.hostname ?? `${plan.name}.${progress.subdomain}.workers.dev`

    switch (id) {
      case "account": {
        let subdomain = await api.workersSubdomain(plan.accountId)
        if (!subdomain) {
          // First Worker on this account: claim a workers.dev subdomain.
          const base = plan.name.slice(0, 40)
          subdomain = `${base}-${crypto.randomUUID().slice(0, 6)}`
          await api.setWorkersSubdomain(plan.accountId, subdomain)
        }
        const script = await api.script(plan.accountId, plan.name)
        if (script && !script.tags?.includes(SCRIPT_TAG)) {
          throw new StepError(
            `This account already has a Worker called ${plan.name} that Coworkers did not install.`,
            "Go back and pick another name."
          )
        }
        save({
          subdomain,
          fresh: !script,
          ...(script?.migration_tag
            ? { migrationTag: script.migration_tag }
            : {}),
        })
        this.setState({ ...this.state, updating: !!script })
        return script
          ? "Updating your existing coworkers"
          : `${subdomain}.workers.dev`
      }

      case "gateway": {
        if (await api.gateway(plan.accountId, plan.gateway))
          return "Already there"
        await api.createGateway(plan.accountId, plan.gateway)
        return plan.gateway
      }

      case "access": {
        const access = await this.configureAccess(api, plan, host(), progress)
        save(access)
        return `${plan.emails.length} ${plan.emails.length === 1 ? "person" : "people"} on the list`
      }

      case "upload": {
        const release = await loadRelease(this.env.ASSETS)
        const target = { accountId: plan.accountId, name: plan.name }
        const assetsJwt = await uploadAssets(
          api,
          this.env.ASSETS,
          release,
          target,
          (done, total) =>
            this.patchStep("upload", {
              detail: `Uploading ${done} of ${total} files`,
            })
        )
        this.patchStep("upload", { detail: "Uploading the Worker" })
        const secrets: Record<string, string> = {}
        if (
          progress.fresh &&
          release.worker.secrets.includes("VAPID_PRIVATE_KEY")
        ) {
          // Web Push works from the first minute. Updates keep the old pair,
          // or every subscription would break.
          const keys = await vapidKeys()
          secrets.VAPID_PUBLIC_KEY = keys.publicKey
          secrets.VAPID_PRIVATE_KEY = keys.privateKey
        }
        await putScript(api, this.env.ASSETS, release, {
          ...target,
          vars: {
            MODEL: plan.model,
            AI_GATEWAY_ID: plan.gateway,
            ACCESS_TEAM_DOMAIN: progress.teamDomain ?? "",
            ACCESS_AUD: progress.aud ?? "",
          },
          secrets,
          assetsJwt,
          fresh: progress.fresh ?? true,
          ...(progress.migrationTag
            ? { migrationTag: progress.migrationTag }
            : {}),
        })
        return `coworkers ${release.release}`
      }

      case "publish": {
        if (plan.domain) {
          await api.attachDomain(plan.accountId, {
            hostname: plan.domain.hostname,
            zoneId: plan.domain.zoneId,
            service: plan.name,
          })
        } else {
          await api.enableWorkersDev(plan.accountId, plan.name)
        }
        const url = `https://${host()}`
        this.setState({ ...this.state, url })
        return host()
      }

      case "wake": {
        // A new workers.dev name or custom domain takes a moment to reach
        // every data center.
        const url = `https://${host()}/`
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            const response = await fetch(url, { redirect: "manual" })
            const location = response.headers.get("Location") ?? ""
            if (location.includes("cloudflareaccess.com")) {
              return "Up, with Access at the door"
            }
            if (response.ok) return "Up"
          } catch {
            // Not resolvable yet.
          }
          this.patchStep("wake", { detail: "Waiting for the URL to go live" })
          await sleep(3000)
        }
        throw new StepError(
          "Coworkers is deployed, but its URL did not answer within 90 seconds.",
          "New URLs can take a few minutes. Try again shortly."
        )
      }
    }
  }

  /**
   * Access in front of Coworkers: an allow list for the app, and a bypass for
   * the paths outsiders use, which carry their own tokens: shared app links,
   * webhooks, and what an MCP client calls on its own (`/mcp`, token and
   * registration, discovery). The consent page, `/oauth/authorize`, stays
   * behind Access.
   */
  private async configureAccess(
    api: CfApi,
    plan: InstallPlan,
    host: string,
    progress: Progress
  ) {
    let org = await api.accessOrganization(plan.accountId)
    if (!org) {
      try {
        org = await api.createAccessOrganization(
          plan.accountId,
          progress.subdomain ?? plan.name
        )
      } catch (err) {
        throw new StepError(
          "Cloudflare Access is not set up on this account yet.",
          "Open Zero Trust once and pick the free plan, then try again.",
          { label: "Open Zero Trust", href: "https://one.dash.cloudflare.com/" }
        )
      }
    }
    // A brand-new organization has no way to sign in yet. An existing one
    // keeps its own identity providers, so other apps do not change.
    const idps = await api.identityProviders(plan.accountId)
    if (idps.length === 0) await api.createOneTimePin(plan.accountId)

    const policies = await api.accessPolicies(plan.accountId)
    const policyId = (name: string) =>
      policies.find((p) => p.name === name)?.id ?? null
    const allowName = `coworkers ${plan.name}: people`
    const allow = await api.upsertAccessPolicy(
      plan.accountId,
      policyId(allowName),
      {
        name: allowName,
        decision: "allow",
        include: plan.emails.map((email) => ({ email: { email } })),
      }
    )
    const bypassName = `coworkers ${plan.name}: share links and webhooks`
    const bypass = await api.upsertAccessPolicy(
      plan.accountId,
      policyId(bypassName),
      { name: bypassName, decision: "bypass", include: [{ everyone: {} }] }
    )

    const apps = await api.accessApps(plan.accountId)
    const appId = (name: string) =>
      apps.find((a) => a.name === name)?.id ?? null
    // Public hostname destinations, not Worker ones: those refuse WebSocket
    // upgrades, and Coworkers runs on WebSockets.
    const mainName = `coworkers ${plan.name}`
    const app = await api.upsertAccessApp(plan.accountId, appId(mainName), {
      type: "self_hosted",
      name: mainName,
      destinations: [{ type: "public", uri: host }],
      policies: [allow.id],
      session_duration: "720h",
      app_launcher_visible: true,
    })
    const linksName = `coworkers ${plan.name}: links`
    await api.upsertAccessApp(plan.accountId, appId(linksName), {
      type: "self_hosted",
      name: linksName,
      destinations: BYPASS_PATHS.map((path) => ({
        type: "public",
        uri: `${host}${path}`,
      })),
      policies: [bypass.id],
      app_launcher_visible: false,
    })
    return { teamDomain: org.auth_domain, aud: app.aud }
  }

  private async demoStep(id: StepId) {
    const plan = this.state.plan!
    if (id === "upload") {
      for (let done = 0; done <= 50; done += 5) {
        this.patchStep("upload", { detail: `Uploading ${done} of 50 files` })
        await sleep(250)
      }
      return "Coworkers demo"
    }
    await sleep(1200 + Math.random() * 800)
    if (id === "publish") {
      this.setState({
        ...this.state,
        url: `https://${plan.name}.you.workers.dev`,
      })
    }
    return id === "gateway" ? plan.gateway : null
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private patchStep(
    id: StepId,
    patch: { status?: Step["status"]; detail?: string }
  ) {
    this.setState({
      ...this.state,
      steps: this.state.steps.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    })
  }

  private assertAccount(accountId: string) {
    if (!this.state.accounts.some((a) => a.id === accountId)) {
      throw new Error("Unknown account.")
    }
  }

  private explain(id: StepId, err: unknown): InstallError {
    if (err instanceof StepError) {
      return {
        step: id,
        message: err.message,
        remedy: err.remedy,
        link: err.link,
      }
    }
    if (err instanceof OAuthError && err.signInAgain) {
      return {
        step: id,
        message: "Your Cloudflare sign-in expired.",
        remedy: "Sign in again; the install picks up where it stopped.",
        link: { label: "Sign in again", href: "/api/auth/login" },
      }
    }
    if (err instanceof CfApiError && err.forbidden) {
      return {
        step: id,
        message: `Your role on this account (or this sign-in) is not allowed to ${DENIED[id]}.`,
        remedy:
          "Ask a Super Administrator of the account for a role that can, or install into an account you administer.",
      }
    }
    return {
      step: id,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  // ── Token ──────────────────────────────────────────────────────────

  private api() {
    return new CfApi(() => this.accessToken())
  }

  private async saveTokens(tokens: Tokens) {
    this.ctx.storage.kv.put(
      "tokens",
      await encrypt(this.env.SESSION_SECRET, JSON.stringify(tokens))
    )
  }

  private async accessToken() {
    const sealed = this.ctx.storage.kv.get<string>("tokens")
    if (!sealed) throw new OAuthError("Not signed in", true)
    let tokens: Tokens = JSON.parse(
      await decrypt(this.env.SESSION_SECRET, sealed)
    )
    if (tokens.expiresAt - Date.now() < 2 * 60_000 && tokens.refreshToken) {
      const fresh = await refresh(
        {
          id: this.env.CF_OAUTH_CLIENT_ID,
          secret: this.env.CF_OAUTH_CLIENT_SECRET,
        },
        tokens.refreshToken
      )
      // The refresh token is not always rotated.
      tokens = {
        ...fresh,
        refreshToken: fresh.refreshToken ?? tokens.refreshToken,
      }
      await this.saveTokens(tokens)
    }
    return tokens.accessToken
  }
}

type Step = InstallerState["steps"][number]
