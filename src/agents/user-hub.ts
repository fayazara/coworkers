import { Agent, callable, getAgentByName } from "agents"
import type { Connection as AgentConnection, ConnectionContext } from "agents"
import { generateText } from "ai"
import webpush from "web-push"
import { DEFAULT_MODEL_SETTINGS, isModelId } from "@/lib/models"
import type { ModelSettings, ModelTestResult } from "@/lib/models"
import { botIdFromLink } from "@/lib/bot-links"
import { BOT_AVATARS, NEW_BOT_NAME, botInstanceName } from "@/lib/types"
import type {
  AppCatalog,
  AppTool,
  BotAttachment,
  BotSummary,
  BotTask,
  Connection,
  DeskCard,
  DeskCardInput,
  HubState,
  Pipeline,
  PipelineDraft,
  PipelineRun,
  PipelineRunStep,
  PipelineStep,
  PushSubscriptionData,
  SpendSummary,
  TaskOutcome,
} from "@/lib/types"
import * as ops from "@/control/bots"
import { runAsUser } from "@/control/operations"
import type {
  BotSettingsPatch,
  ClientRef,
  ClientTask,
  Delivery,
  FailureCode,
  HubPort,
} from "@/control/operation"
import { isReadOnlyTool } from "./app-tools"
import type { BotAgent } from "./bot-agent"
import { demoSeed } from "./demo-seed"
import { visibleCards } from "./desk"
import { MAX_MEMORY_CHARS, appendFact } from "./memory"
import { deploymentModels, gatewayId, languageModel } from "./models"
import {
  LOGS_PER_PAGE,
  advance,
  afterFilter,
  newLogs,
  summarize,
  tally,
} from "./spend"
import type { GatewayLog, SpendCursor, SpendRow } from "./spend"
import {
  MAX_PIPELINE_INPUT_CHARS,
  delegationPrompt,
  pipelineStepPrompt,
  validatePipeline,
} from "./pipelines"

const MAX_PIPELINES = 50
/** Runs kept in state (and their outputs in SQL), across all pipelines. */
const MAX_PIPELINE_RUNS = 30
/** A step's output as broadcast to the browser; the full text stays in SQL. */
const MAX_STEP_OUTPUT_IN_STATE = 4_000
/** A finished task's result kept for an outside agent's task_status. */
const MAX_CLIENT_RESULT_CHARS = 100_000
/** Tasks outside agents handed out are forgotten after this long. */
const CLIENT_TASK_KEEP_MS = 7 * 24 * 3_600_000
/** SQLite rows top out at 2 MB; bigger files are not passed between steps. */
const MAX_STORED_FILE_BYTES = 1_900_000

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** MCP server id for a connection; it namespaces the connection's tools. */
function serverId(connectionId: string) {
  return `c${connectionId}`
}

/** How often new AI Gateway logs are read for the Spend page. */
const SPEND_SYNC_S = 30 * 60
/** Pages of 50 logs one sync reads before leaving the rest for the next. */
const SPEND_MAX_PAGES = 40
/** Daily spend rows older than this are dropped. */
const SPEND_KEEP_DAYS = 62

/**
 * One per user (instance name = user id). Owns the bot directory that powers
 * the sidebar, the user's connections, and routing between bots.
 *
 * Connections are MCP servers held here, once per user: one sign-in (OAuth
 * or headers) serves every bot. Bots read the tool catalog and call tools
 * through this hub over Durable Object RPC.
 *
 * `@callable()` methods are invoked by the browser over the agent
 * WebSocket. Plain public methods are Durable Object RPC, called by bots.
 */
export class UserHub extends Agent<Env, HubState> implements HubPort {
  initialState: HubState = {
    bots: [],
    connections: [],
    pipelines: [],
    pipelineRuns: [],
  }

  async onStart() {
    // Push endpoints are capability URLs: keep them out of broadcast state.
    this.sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
    // Each pipeline step's full result, and the files it passes on. State
    // carries a clipped copy for the browser.
    this.sql`CREATE TABLE IF NOT EXISTS pipeline_outputs (
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      output TEXT NOT NULL,
      PRIMARY KEY (run_id, step)
    )`
    // Tasks outside agents (MCP clients) handed out, until they read the
    // result with task_status.
    this.sql`CREATE TABLE IF NOT EXISTS client_tasks (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    )`
    this
      .sql`DELETE FROM client_tasks WHERE created_at < ${Date.now() - CLIENT_TASK_KEEP_MS}`
    this.sql`CREATE TABLE IF NOT EXISTS pipeline_files (
      run_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      name TEXT NOT NULL,
      bytes BLOB NOT NULL
    )`
    // The deployment's MODEL or gateway may have changed since last start.
    this.setState({
      ...this.state,
      pipelines: this.state.pipelines ?? [],
      pipelineRuns: this.state.pipelineRuns ?? [],
      models: { ...DEFAULT_MODEL_SETTINGS, ...this.state.models },
      deployment: deploymentModels(this.env),
    })
    // Memory every bot of this user reads, with its edit history.
    this.sql`CREATE TABLE IF NOT EXISTS shared_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL
    )`
    // Model spend per bot and UTC day, read back from AI Gateway logs.
    this.sql`CREATE TABLE IF NOT EXISTS spend_daily (
      day TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      turn TEXT NOT NULL,
      cost REAL NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      requests INTEGER NOT NULL,
      PRIMARY KEY (day, bot_id, turn)
    )`
    // Desk cards. State carries the open ones; `data` is the whole card.
    this.sql`CREATE TABLE IF NOT EXISTS desk_cards (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      lane TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT NOT NULL
    )`
    this.refreshDesk()
    await this.startSpend()
    // After an MCP sign-in completes, send the user back to Connections.
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        this.syncConnectionStatus()
        const query = result.authSuccess
          ? ""
          : `&error=${encodeURIComponent(result.authError)}`
        return new Response(null, {
          status: 302,
          headers: { Location: `/settings?tab=connections${query}` },
        })
      },
    })
    await this.restoreLegacyConnections()
  }

  // ── Spend ───────────────────────────────────────────────────────────

  private spendAccess() {
    const account = this.env.ACCOUNT_ID?.trim()
    const token = this.env.AI_GATEWAY_API_TOKEN?.trim()
    return account && token ? { account, token } : null
  }

  /** Sync on a schedule when the deployment can read the logs. */
  private async startSpend() {
    if (!this.spendAccess()) {
      if (this.state.spend !== null)
        this.setState({ ...this.state, spend: null })
      return
    }
    if (!this.getSchedules().some((s) => s.callback === "syncSpend")) {
      await this.scheduleEvery(SPEND_SYNC_S, "syncSpend")
    }
    if (!this.state.spend) {
      this.setState({ ...this.state, spend: this.spendSummary(null) })
      await this.schedule(5, "syncSpend")
    }
  }

  #syncingSpend?: Promise<void>

  /** Schedule callback: read new AI Gateway logs into spend_daily. */
  async syncSpend() {
    const access = this.spendAccess()
    if (!access) return
    this.#syncingSpend ??= this.readSpend(access.account, access.token).finally(
      () => (this.#syncingSpend = undefined)
    )
    return this.#syncingSpend
  }

  private async readSpend(account: string, token: string) {
    let cursor = this.ctx.storage.kv.get<SpendCursor>("spend_cursor") ?? null
    const now = new Date()
    // The first read starts at the beginning of the month.
    const from =
      cursor?.at ??
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      ).toISOString()
    const bots = new Set(this.state.bots.map((b) => b.id))
    let error: string | undefined
    let more = false
    try {
      for (let page = 1; page <= SPEND_MAX_PAGES; page++) {
        const url = new URL(
          `https://api.cloudflare.com/client/v4/accounts/${account}/ai-gateway/gateways/${gatewayId(this.env)}/logs`
        )
        url.searchParams.set("per_page", String(LOGS_PER_PAGE))
        url.searchParams.set("page", String(page))
        url.searchParams.set("order_by", "created_at")
        url.searchParams.set("order_by_direction", "asc")
        url.searchParams.set("filters", afterFilter(from))
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        })
        const body = (await res.json().catch(() => ({}))) as {
          success?: boolean
          result?: GatewayLog[]
          errors?: { message?: string }[]
        }
        if (!res.ok || !body.success) {
          throw new Error(
            body.errors?.[0]?.message ?? `AI Gateway answered ${res.status}.`
          )
        }
        const batch = body.result ?? []
        const logs = newLogs(batch, cursor)
        this.addSpend(tally(logs, bots))
        cursor = advance(logs, cursor)
        // Saved per page, so a failure later keeps what was read.
        if (cursor) this.ctx.storage.kv.put("spend_cursor", cursor)
        if (batch.length < LOGS_PER_PAGE) break
        if (page === SPEND_MAX_PAGES) more = true
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.error("Reading AI Gateway logs failed", err)
    }
    const cutoff = new Date(Date.now() - SPEND_KEEP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10)
    this.sql`DELETE FROM spend_daily WHERE day < ${cutoff}`
    this.setState({
      ...this.state,
      spend: this.spendSummary(
        error ? (this.state.spend?.syncedAt ?? null) : Date.now(),
        error
      ),
    })
    // A big backlog is read over several runs.
    if (more && !error) await this.schedule(60, "syncSpend")
  }

  private addSpend(rows: SpendRow[]) {
    for (const r of rows) {
      this
        .sql`INSERT INTO spend_daily (day, bot_id, turn, cost, tokens_in, tokens_out, requests)
        VALUES (${r.day}, ${r.botId}, ${r.turn}, ${r.cost}, ${r.tokensIn}, ${r.tokensOut}, ${r.requests})
        ON CONFLICT(day, bot_id, turn) DO UPDATE SET cost = cost + excluded.cost,
          tokens_in = tokens_in + excluded.tokens_in,
          tokens_out = tokens_out + excluded.tokens_out,
          requests = requests + excluded.requests`
    }
  }

  private spendSummary(syncedAt: number | null, error?: string): SpendSummary {
    const since = new Date(Date.now() - 31 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const rows = this.sql<{
      day: string
      bot_id: string
      turn: string
      cost: number
      tokens_in: number
      tokens_out: number
      requests: number
    }>`SELECT * FROM spend_daily WHERE day >= ${since}`.map((r): SpendRow => ({
      day: r.day,
      botId: r.bot_id,
      turn: r.turn === "background" ? "background" : "chat",
      cost: r.cost,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      requests: r.requests,
    }))
    return {
      ...summarize(rows, Date.now()),
      syncedAt,
      ...(error ? { error } : {}),
    }
  }

  /** Read the newest logs now, from the Spend page. */
  @callable()
  async refreshSpend() {
    if (!this.spendAccess()) throw new Error("Spend is not set up.")
    await this.syncSpend()
  }

  /** Remember the app's origin to build MCP OAuth callback URLs. */
  onConnect(_connection: AgentConnection, ctx: ConnectionContext) {
    this.ctx.storage.kv.put("origin", new URL(ctx.request.url).origin)
    this.syncConnectionStatus()
  }

  private get userId() {
    return this.name
  }

  private get origin() {
    return this.ctx.storage.kv.get<string>("origin")
  }

  private bot(botId: string) {
    // The binding is declared by Worker name in cloudflare.config.ts, so its
    // generated type does not carry the class.
    return getAgentByName(
      this.env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(this.userId, botId)
    )
  }

  private patchBot(botId: string, patch: Partial<BotSummary>) {
    this.setState({
      ...this.state,
      bots: this.state.bots.map((b) =>
        b.id === botId ? { ...b, ...patch } : b
      ),
    })
  }

  // ── Bots (operations in src/control/bots.ts) ─────────────────────────

  async addBot(): Promise<BotSummary> {
    // Each bot gets its own shape until the roster runs out.
    const taken = new Set(this.state.bots.map((b) => b.avatar))
    const avatar =
      BOT_AVATARS.find((a) => !taken.has(a)) ??
      BOT_AVATARS[this.state.bots.length % BOT_AVATARS.length]
    const summary: BotSummary = {
      id: crypto.randomUUID().slice(0, 8),
      name: NEW_BOT_NAME,
      avatar,
      status: "idle",
      preview: "",
      updatedAt: Date.now(),
      unread: false,
    }
    this.setState({ ...this.state, bots: [summary, ...this.state.bots] })

    const bot = await this.bot(summary.id)
    await bot.setup(summary.avatar)
    return summary
  }

  async removeBot(botId: string) {
    // Drop it from the directory first: `destroy()` aborts the bot's isolate,
    // so calls to it reject ("destroyed") even when the teardown went through.
    // That includes the lookup, which calls the bot too, so neither may fail
    // the delete.
    this.setState({
      ...this.state,
      bots: this.state.bots.filter((b) => b.id !== botId),
    })
    // A step it was working on would never report back.
    for (const run of this.runs) {
      const index = run.steps.findIndex((s) => s.status === "running")
      const step = run.plan[index]
      if (step?.kind === "bot" && step.botId === botId) {
        await this.failStep(run.id, index, "Its bot was deleted.")
      }
    }
    this.sql`DELETE FROM desk_cards WHERE bot_id = ${botId}`
    this.refreshDesk()
    try {
      const bot = await this.bot(botId)
      await bot.destroy()
    } catch (err) {
      console.warn(`removeBot ${botId}: teardown reported`, err)
    }
  }

  async configureBot(botId: string, patch: BotSettingsPatch) {
    if (!this.state.bots.some((b) => b.id === botId)) return false
    const bot = await this.bot(botId)
    await bot.applySettings(patch)
    return true
  }

  async setPaused(botId: string, paused: boolean) {
    if (!this.state.bots.some((b) => b.id === botId)) return false
    this.patchBot(botId, { paused })
    const bot = await this.bot(botId)
    await bot.setPaused(paused)
    return true
  }

  async readBot(botId: string, limit: number) {
    const summary = this.state.bots.find((b) => b.id === botId)
    if (!summary) return null
    const bot = await this.bot(botId)
    return { name: summary.name, messages: await bot.transcript(limit) }
  }

  // ── Browser-facing ──────────────────────────────────────────────────

  @callable()
  async createBot(): Promise<BotSummary> {
    return (await runAsUser(ops.createBot, { hub: this }, {})).bot
  }

  /** Onboarding's first bot: one that sets up and runs the others. */
  @callable()
  async createChiefOfStaff(): Promise<BotSummary> {
    return (await runAsUser(ops.createBot, { hub: this }, ops.CHIEF_OF_STAFF))
      .bot
  }

  @callable()
  async deleteBot(botId: string) {
    await runAsUser(ops.deleteBot, { hub: this }, { bot: botId })
  }

  @callable()
  async pauseBot(botId: string) {
    await runAsUser(ops.pauseBot, { hub: this }, { bot: botId })
  }

  @callable()
  async resumeBot(botId: string) {
    await runAsUser(ops.resumeBot, { hub: this }, { bot: botId })
  }

  @callable()
  markRead(botId: string) {
    if (this.state.bots.find((b) => b.id === botId)?.unread) {
      this.patchBot(botId, { unread: false })
    }
  }

  /** A bot's unanswered cards, for answering them from the sidebar. */
  @callable()
  async waitingParts(botId: string) {
    if (!this.state.bots.some((b) => b.id === botId)) return null
    return (await this.bot(botId)).waitingParts()
  }

  @callable()
  async answerApproval(botId: string, approvalId: string, approved: boolean) {
    if (!this.state.bots.some((b) => b.id === botId)) {
      throw new Error("No such bot.")
    }
    await (await this.bot(botId)).answerApproval(approvalId, approved)
  }

  /** A bot's script app calls waiting on the user, for the sidebar. */
  @callable()
  async waitingScripts(botId: string) {
    if (!this.state.bots.some((b) => b.id === botId)) return []
    return (await this.bot(botId)).waitingScripts()
  }

  @callable()
  async answerScriptApproval(
    botId: string,
    runId: string,
    callId: string,
    approved: boolean,
    all = false
  ) {
    if (!this.state.bots.some((b) => b.id === botId)) {
      throw new Error("No such bot.")
    }
    await (
      await this.bot(botId)
    ).answerScriptApproval(runId, callId, approved, all)
  }

  @callable()
  async addConnection(input: {
    name: string
    url: string
    headers?: Record<string, string>
  }): Promise<Connection> {
    const url = new URL(input.url)
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Connection URL must use https")
    }
    const headers = input.headers ?? {}
    const id = crypto.randomUUID().slice(0, 8)
    const name = input.name.trim() || url.hostname
    // The MCP client persists the URL and headers itself; only header names
    // go into `state`, which is broadcast to the browser.
    await this.addMcpServer(name, url.toString(), {
      id: serverId(id),
      callbackHost: this.origin,
      transport: { headers },
    })
    const connection: Connection = {
      id,
      name,
      url: url.toString(),
      headerNames: Object.keys(headers),
      status: "connecting",
      tools: 0,
    }
    this.setState({
      ...this.state,
      connections: [...this.state.connections, connection],
    })
    this.syncConnectionStatus()
    return this.state.connections.find((c) => c.id === id) ?? connection
  }

  @callable()
  async removeConnection(connectionId: string) {
    if (this.getMcpServers().servers[serverId(connectionId)]) {
      await this.removeMcpServer(serverId(connectionId))
    }
    this.setState({
      ...this.state,
      connections: this.state.connections.filter((c) => c.id !== connectionId),
    })
  }

  /**
   * Re-read connection state, e.g. when the Connections page opens. Right
   * after a sign-in the MCP client finishes connecting in the background, so
   * wait for it before reporting.
   */
  @callable()
  async refreshConnections() {
    this.syncConnectionStatus()
    await this.mcp.waitForConnections({ timeout: 10_000 })
    this.syncConnectionStatus()
  }

  /** Retry a connection: a fresh sign-in link, or a new handshake. */
  @callable()
  async reconnect(connectionId: string) {
    const id = serverId(connectionId)
    const result = await this.mcp.connectToServer(id)
    if (result.state === "connected") await this.mcp.discoverIfConnected(id)
    this.syncConnectionStatus()
  }

  // ── Push notifications ──────────────────────────────────────────────

  /** Null when the deployment has no VAPID keys, so push is unavailable. */
  @callable()
  pushPublicKey(): string | null {
    return this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY
      ? this.env.VAPID_PUBLIC_KEY
      : null
  }

  @callable()
  subscribePush(subscription: PushSubscriptionData) {
    const url = new URL(subscription.endpoint)
    if (url.protocol !== "https:") throw new Error("Invalid push endpoint")
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error("Push subscription is missing its keys")
    }
    this
      .sql`INSERT OR REPLACE INTO push_subscriptions (endpoint, data, created_at)
      VALUES (${subscription.endpoint}, ${JSON.stringify(subscription)}, ${Date.now()})`
  }

  @callable()
  unsubscribePush(endpoint: string) {
    this.sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
  }

  @callable()
  isPushSubscribed(endpoint: string): boolean {
    return (
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions
        WHERE endpoint = ${endpoint}`[0]?.n > 0
    )
  }

  /** Send a test notification to every device this user subscribed. */
  @callable()
  async testPush() {
    return this.push({
      title: "Coworkers",
      body: "Notifications are on. Your bots will reach you here.",
      tag: "test",
      url: "/",
    })
  }

  private async push(payload: {
    title: string
    body: string
    tag: string
    url: string
  }): Promise<{ sent: number }> {
    const publicKey = this.pushPublicKey()
    if (!publicKey) return { sent: 0 }
    const rows = this.sql<{ endpoint: string; data: string }>`
      SELECT endpoint, data FROM push_subscriptions`
    if (rows.length === 0) return { sent: 0 }
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      publicKey,
      this.env.VAPID_PRIVATE_KEY
    )
    let sent = 0
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            JSON.parse(row.data) as PushSubscriptionData,
            JSON.stringify(payload),
            { TTL: 60 * 60 * 12 }
          )
          sent++
        } catch (err) {
          const status =
            err instanceof webpush.WebPushError ? err.statusCode : 0
          // The browser unsubscribed or the subscription expired.
          if (status === 404 || status === 410) {
            this
              .sql`DELETE FROM push_subscriptions WHERE endpoint = ${row.endpoint}`
          } else {
            console.error("Push failed", status, err)
          }
        }
      })
    )
    return { sent }
  }

  /** Copy live MCP client state (status, sign-in URL, tool count) into `state`. */
  private syncConnectionStatus() {
    const { servers, tools } = this.getMcpServers()
    const connections = this.state.connections.map((c) => {
      const server = servers[serverId(c.id)]
      const next: Connection = {
        id: c.id,
        name: c.name,
        url: c.url,
        headerNames: c.headerNames,
        status: server?.state ?? "failed",
        tools: tools.filter((t) => t.serverId === serverId(c.id)).length,
        ...(c.lastFailure ? { lastFailure: c.lastFailure } : {}),
        ...(server?.auth_url ? { authUrl: server.auth_url } : {}),
        ...(server?.error
          ? { error: server.error }
          : server
            ? {}
            : { error: "Not connected. Remove it and add it again." }),
      }
      return next
    })
    if (
      JSON.stringify(connections) !== JSON.stringify(this.state.connections)
    ) {
      this.setState({ ...this.state, connections })
    }
  }

  /**
   * Connections used to live on each bot, with header values in a table
   * here. Re-register any that the hub's MCP client does not know yet.
   */
  private async restoreLegacyConnections() {
    const legacy = this.sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'connection_headers'`
    const rows = legacy.length
      ? this.sql<{ connection_id: string; headers: string }>`
          SELECT connection_id, headers FROM connection_headers`
      : []
    const headers = new Map(
      rows.map((r) => [
        r.connection_id,
        JSON.parse(r.headers) as Record<string, string>,
      ])
    )
    const known = this.getMcpServers().servers
    for (const c of this.state.connections) {
      if (known[serverId(c.id)]) continue
      try {
        await this.addMcpServer(c.name, c.url, {
          id: serverId(c.id),
          callbackHost: this.origin,
          transport: { headers: headers.get(c.id) ?? {} },
        })
      } catch (err) {
        console.error(`Restoring connection "${c.name}" failed`, err)
      }
    }
    if (legacy.length) this.sql`DROP TABLE connection_headers`
    // Older states also carried a per-bot toolkit; every bot now gets all.
    if (this.state.bots.some((b) => "connectionIds" in b)) {
      this.setState({
        ...this.state,
        bots: this.state.bots.map(
          ({
            connectionIds: _unused,
            ...b
          }: BotSummary & {
            connectionIds?: string[]
          }) => b
        ),
      })
    }
    this.syncConnectionStatus()
  }

  // ── Server-facing (Durable Object RPC) ──────────────────────────────

  /** State for the first server render, before the WebSocket connects. */
  async snapshot(): Promise<HubState> {
    return this.state
  }

  // ── Bot-facing (Durable Object RPC) ─────────────────────────────────

  /** A bot reports its own status, preview, or new name. */
  async reportBot(
    botId: string,
    patch: Partial<
      Pick<
        BotSummary,
        "name" | "status" | "preview" | "unread" | "role" | "access" | "paused"
      >
    >
  ) {
    const touched = patch.preview !== undefined || patch.name !== undefined
    this.patchBot(botId, {
      ...patch,
      ...(touched ? { updatedAt: Date.now() } : {}),
    })
  }

  // ── Desk ────────────────────────────────────────────────────────────

  private cardRows(where: "live" | { id: string }): DeskCard[] {
    const rows =
      where === "live"
        ? this.sql<{ data: string; status: DeskCard["status"] }>`
            SELECT data, status FROM desk_cards
            WHERE status IN ('open', 'snoozed')`
        : this.sql<{ data: string; status: DeskCard["status"] }>`
            SELECT data, status FROM desk_cards WHERE id = ${where.id}`
    return rows.map((r) => ({
      ...(JSON.parse(r.data) as DeskCard),
      status: r.status,
    }))
  }

  /** Rebuild the Desk in state from SQL. */
  private refreshDesk() {
    const desk = visibleCards(this.cardRows("live"), Date.now())
    if (JSON.stringify(desk) !== JSON.stringify(this.state.desk ?? [])) {
      this.setState({ ...this.state, desk })
    }
  }

  private insertCard(botId: string, input: DeskCardInput) {
    const card: DeskCard = {
      ...input,
      id: `${botId}:${input.key}`,
      botId,
      status: "open",
    }
    const now = Date.now()
    this.sql`INSERT INTO desk_cards
      (id, bot_id, lane, status, created_at, updated_at, data)
      VALUES (${card.id}, ${botId}, ${card.lane}, 'open', ${card.createdAt},
              ${now}, ${JSON.stringify(card)})
      ON CONFLICT (id) DO UPDATE SET data = excluded.data,
        lane = excluded.lane, updated_at = excluded.updated_at
      WHERE desk_cards.status = 'open'`
  }

  private setCardStatus(ids: string[], status: DeskCard["status"]) {
    const now = Date.now()
    for (const id of ids) {
      this.sql`UPDATE desk_cards SET status = ${status}, updated_at = ${now}
        WHERE id = ${id}`
    }
    // Closed cards are kept a month, for undo and later for feedback.
    this.sql`DELETE FROM desk_cards WHERE status IN ('acted', 'dismissed')
      AND updated_at < ${now - 30 * 24 * 60 * 60 * 1000}`
  }

  /** Durable Object RPC: a bot puts something on the Desk, once per key. */
  async postCard(botId: string, input: DeskCardInput) {
    if (!this.state.bots.some((b) => b.id === botId)) return
    const id = `${botId}:${input.key}`
    if (this.sql`SELECT 1 FROM desk_cards WHERE id = ${id}`.length) return
    this.insertCard(botId, input)
    this.refreshDesk()
  }

  /**
   * Durable Object RPC: everything a bot is waiting on right now. Cards for
   * approvals no longer in the list were answered or expired, so they close.
   */
  async syncWaiting(botId: string, inputs: DeskCardInput[]) {
    if (!this.state.bots.some((b) => b.id === botId)) return
    const live = new Set<string>()
    for (const input of inputs) {
      live.add(`${botId}:${input.key}`)
      this.insertCard(botId, input)
    }
    const stale = this.sql<{ id: string }>`SELECT id FROM desk_cards
      WHERE bot_id = ${botId} AND lane = 'needs_you' AND status = 'open'
        AND (id LIKE ${`${botId}:approval:%`} OR id LIKE ${`${botId}:script:%`})`
      .map((r) => r.id)
      .filter((id) => !live.has(id))
    this.setCardStatus(stale, "acted")
    this.refreshDesk()
  }

  /** Press a card's button: approve or reject what it is waiting on. */
  @callable()
  async actOnCard(cardId: string, actionId: string) {
    const card = this.cardRows({ id: cardId })[0]
    const action = card?.actions.find((a) => a.id === actionId)
    if (!card || card.status !== "open" || !action) {
      throw new Error("That card is gone.")
    }
    if (action.kind === "open_chat") return
    const approved = action.kind !== "reject"
    try {
      const bot = await this.bot(card.botId)
      if (card.refs.approvalId) {
        await bot.answerApproval(card.refs.approvalId, approved)
      } else if (card.refs.script) {
        await bot.answerScriptApproval(
          card.refs.script.runId,
          card.refs.script.callId,
          approved,
          action.kind === "approve_all"
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      // Answered somewhere else first: the card was just out of date.
      if (!/already answered|no longer waiting/i.test(message)) throw err
    }
    this.setCardStatus([cardId], "acted")
    this.refreshDesk()
  }

  /** "Got it" on one card, or "Clear all" on a lane. */
  @callable()
  dismissCards(cardIds: string[]) {
    this.setCardStatus(cardIds, "dismissed")
    this.refreshDesk()
  }

  /** Undo a dismissal. */
  @callable()
  restoreCards(cardIds: string[]) {
    const now = Date.now()
    for (const id of cardIds) {
      this.sql`UPDATE desk_cards SET status = 'open', updated_at = ${now}
        WHERE id = ${id} AND status = 'dismissed'`
    }
    this.refreshDesk()
  }

  /** The user looked at the Desk; newer cards get the "new" marker. */
  @callable()
  markDeskSeen() {
    this.setState({ ...this.state, deskSeenAt: Date.now() })
  }

  /**
   * Durable Object RPC from /api/demo-profile: replace the local "jane"
   * profile's bots, chats and Desk with fresh demo data.
   */
  async seedDemo() {
    if (this.userId !== "jane") {
      throw new Error("Demo data only goes in the local demo profile.")
    }
    for (const bot of [...this.state.bots]) await this.removeBot(bot.id)
    this.sql`DELETE FROM desk_cards`
    const now = Date.now()
    const seed = demoSeed(now)
    for (const bot of seed.bots) {
      await (await this.bot(bot.id)).seedDemo(bot)
    }
    const bots: BotSummary[] = seed.bots.map((b) => {
      const last = b.messages.findLast((m) => m.role === "assistant")
      const text = last?.parts.find((p) => p.type === "text")
      return {
        id: b.id,
        name: b.name,
        avatar: b.avatar,
        status: "idle",
        preview: clip(
          (text?.type === "text" ? text.text : "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/[`*_#>|]+/g, "")
            .replace(/\s+/g, " ")
            .trim(),
          140
        ),
        updatedAt: (last?.metadata as { at?: number } | undefined)?.at ?? now,
        unread: b.unread,
      }
    })
    // Cards from the last 50 minutes count as new.
    this.setState({ ...this.state, bots, deskSeenAt: now - 50 * 60_000 })
    for (const { botId, card } of seed.cards) this.insertCard(botId, card)
    this.refreshDesk()
    await this.setSharedMemory(seed.sharedMemory)
  }

  // ── Models ──────────────────────────────────────────────────────────

  /** Durable Object RPC: what a bot's next turn runs on. */
  async modelSettings(): Promise<ModelSettings> {
    return { ...DEFAULT_MODEL_SETTINGS, ...this.state.models }
  }

  @callable()
  setModels(patch: Partial<ModelSettings>) {
    const next = { ...DEFAULT_MODEL_SETTINGS, ...this.state.models }
    for (const key of ["chat", "background"] as const) {
      const value = patch[key]
      if (value === undefined) continue
      const id = value?.trim() || null
      if (id && !isModelId(id)) throw new Error(`"${id}" is not a model id.`)
      next[key] = id
    }
    if (patch.fallback !== undefined) next.fallback = !!patch.fallback
    this.setState({ ...this.state, models: next })
  }

  /**
   * One short call through the gateway, without the fallback, so the
   * Models page can say whether a model actually works before bots use it.
   */
  @callable()
  async testModel(modelId: string): Promise<ModelTestResult> {
    const started = Date.now()
    try {
      if (!isModelId(modelId)) throw new Error("That is not a model id.")
      const result = await generateText({
        model: languageModel(this.env, modelId, {
          settings: { ...DEFAULT_MODEL_SETTINGS, fallback: false },
          metadata: { source: "model-test" },
        }),
        prompt:
          "Say hello to the person setting you up, in one short, warm sentence. No preamble.",
        maxOutputTokens: 400,
      })
      const meta = result.providerMetadata?.cloudflare as
        { logId?: string } | undefined
      return {
        ok: true,
        ms: Date.now() - started,
        reply: result.text.trim().slice(0, 300) || "(empty reply)",
        logId: meta?.logId,
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String(err.code)
          : "unknown"
      return {
        ok: false,
        ms: Date.now() - started,
        code,
        message: (err instanceof Error ? err.message : String(err)).slice(
          0,
          400
        ),
      }
    }
  }

  // ── Shared memory ───────────────────────────────────────────────────

  /** Durable Object RPC: what every bot reads in its prompt. */
  async sharedMemory(): Promise<string> {
    return (
      this.sql<{
        content: string
      }>`SELECT content FROM shared_memory ORDER BY id DESC LIMIT 1`[0]
        ?.content ?? ""
    )
  }

  /** Durable Object RPC: a bot saves a fact for all of the user's bots. */
  async rememberShared(fact: string, botName: string) {
    const result = appendFact(await this.sharedMemory(), fact)
    if ("content" in result) this.saveShared(result.content, botName)
    return "content" in result
      ? { saved: true }
      : "duplicate" in result
        ? { saved: false, reason: "Already remembered." }
        : { saved: false, error: result.error }
  }

  @callable()
  async getSharedMemory() {
    return {
      content: await this.sharedMemory(),
      revisions: this.sql<{
        id: number
        at: number
        source: string
      }>`SELECT id, at, source
        FROM shared_memory ORDER BY id DESC LIMIT 20`,
    }
  }

  @callable()
  async setSharedMemory(content: string) {
    if (content.length > MAX_MEMORY_CHARS) {
      throw new Error(
        `Shared memory is limited to ${MAX_MEMORY_CHARS} characters.`
      )
    }
    if (content !== (await this.sharedMemory())) this.saveShared(content, "You")
  }

  @callable()
  async restoreSharedMemory(revisionId: number) {
    const row = this.sql<{
      content: string
    }>`SELECT content FROM shared_memory WHERE id = ${revisionId}`[0]
    if (row) this.saveShared(row.content, "You (restored)")
  }

  private saveShared(content: string, source: string) {
    this
      .sql`INSERT INTO shared_memory (at, source, content) VALUES (${Date.now()}, ${source}, ${content})`
    this
      .sql`DELETE FROM shared_memory WHERE id <= (SELECT MAX(id) FROM shared_memory) - 50`
  }

  async listBots(): Promise<BotSummary[]> {
    return this.state.bots
  }

  /** Inbound email and webhooks check this before waking a bot. */
  async hasBot(botId: string): Promise<boolean> {
    return this.state.bots.some((b) => b.id === botId)
  }

  /** A bot has something for the user: push it to their devices. */
  async notifyUser(botId: string, body: string) {
    const bot = this.state.bots.find((b) => b.id === botId)
    if (!bot) return { sent: 0 }
    return this.push({
      title: bot.name,
      body,
      // One notification per bot: a newer one replaces the older.
      tag: `bot-${botId}`,
      url: `/bots/${botId}`,
    })
  }

  /** Every connected tool, for a bot's next turn. */
  async appCatalog(): Promise<AppCatalog> {
    await this.mcp.waitForConnections({ timeout: 5000 })
    this.syncConnectionStatus()
    const names = new Map(
      this.state.connections.map((c) => [serverId(c.id), c] as const)
    )
    const tools: AppTool[] = []
    for (const t of this.mcp.listTools()) {
      const connection = names.get(t.serverId)
      if (!connection) continue
      tools.push({
        connectionId: connection.id,
        connectionName: connection.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
        readOnly: isReadOnlyTool(t.name, t.annotations),
      })
    }
    return {
      apps: this.state.connections.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        tools: c.tools,
        ...(c.error ? { error: c.error } : {}),
      })),
      tools,
    }
  }

  /** Run a connection's tool on behalf of a bot. Credentials stay here. */
  async callAppTool(
    connectionId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.state.connections.some((c) => c.id === connectionId)) {
      throw new Error("That connection was removed.")
    }
    let result: unknown
    try {
      result = await this.mcp.callTool({
        serverId: serverId(connectionId),
        name,
        arguments: args,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const kind = classifyAppFailure(message)
      this.noteAppCall(connectionId, {
        at: Date.now(),
        message: message.slice(0, 300),
        kind,
      })
      const app =
        this.state.connections.find((c) => c.id === connectionId)?.name ??
        "This app"
      throw new Error(
        kind === "auth"
          ? `${app} rejected the request because its sign-in expired or was revoked. Tell the user to reconnect ${app} in Connections. Do not retry until they have.`
          : kind === "unreachable"
            ? `${app} could not be reached (${message.slice(0, 120)}). It may be down. Tell the user if it matters; do not retry more than once.`
            : message
      )
    }
    this.noteAppCall(connectionId, null)
    // Structured clone over RPC: keep the plain JSON parts of the result.
    return JSON.parse(JSON.stringify(result)) as unknown
  }

  /** Remember the latest failed call per connection, for the Connections page. */
  private noteAppCall(
    connectionId: string,
    failure: Connection["lastFailure"] | null
  ) {
    const current = this.state.connections.find((c) => c.id === connectionId)
    if (!current || (!failure && !current.lastFailure)) return
    this.setState({
      ...this.state,
      connections: this.state.connections.map((c) => {
        if (c.id !== connectionId) return c
        const { lastFailure: _, ...rest } = c
        return failure ? { ...rest, lastFailure: failure } : rest
      }),
    })
  }

  /** Where the user opens Coworkers, so bots can hand out full app links. */
  async appOrigin(): Promise<string | null> {
    return this.origin ?? null
  }

  /** Deliver a message from one bot to another, matched by name or id. */
  async relayMessage(
    fromBotId: string,
    to: string,
    text: string,
    delivery: { key?: string; hops?: number; files?: BotAttachment[] } = {}
  ): Promise<Delivery & { files?: string[] }> {
    const found = this.recipient(fromBotId, to)
    if ("error" in found) return { delivered: false, ...found }
    const { from, target } = found
    const bot = await this.bot(target.id)
    const saved = await bot.receiveBotMessage(
      { kind: "bot", name: from.name, avatar: from.avatar },
      text,
      delivery
    )
    return {
      delivered: true,
      to: target.name,
      botId: target.id,
      ...(saved.length ? { files: saved } : {}),
    }
  }

  /** The sender and the bot it named (by link, id or name), for bot-to-bot calls. */
  private recipient(
    fromBotId: string,
    to: string
  ):
    | { from: BotSummary; target: BotSummary }
    | { code: FailureCode; error: string } {
    const from = this.state.bots.find((b) => b.id === fromBotId)
    if (!from) return { code: "not_found", error: "Unknown sender" }
    const found = this.target(to, fromBotId)
    if ("error" in found) return found
    if (found.target.id === fromBotId) {
      return { code: "invalid", error: "A bot cannot message itself" }
    }
    return { from, target: found.target }
  }

  /** The bot `to` names (link, id or name), if it can take work now. */
  private target(
    to: string,
    exceptId?: string
  ): { target: BotSummary } | { code: FailureCode; error: string } {
    const needle = (botIdFromLink(to) ?? to.trim().replace(/^@/, ""))
      .trim()
      .toLowerCase()
    const target = this.state.bots.find(
      (b) => b.id === needle || b.name.toLowerCase() === needle
    )
    if (!target) {
      const names = this.state.bots
        .filter((b) => b.id !== exceptId)
        .map((b) => `${b.name} (${b.id})`)
      return {
        code: "not_found",
        error: `No bot named "${to}". Available: ${names.join(", ") || "none"}`,
      }
    }
    if (target.paused) {
      return {
        code: "paused",
        error: `${target.name} is paused. Do the work yourself, or ask the user to resume it.`,
      }
    }
    return { target }
  }

  // ── Outside agents (MCP clients) ────────────────────────────────────

  async messageFromClient(
    client: ClientRef,
    to: string,
    text: string,
    key: string
  ): Promise<Delivery> {
    const found = this.target(to)
    if ("error" in found) return { delivered: false, ...found }
    const { target } = found
    const bot = await this.bot(target.id)
    await bot.receiveAgentMessage(client.label, text, key)
    return { delivered: true, to: target.name, botId: target.id }
  }

  async delegateFromClient(
    client: ClientRef,
    to: string,
    task: string,
    taskId: string
  ): Promise<Delivery> {
    const found = this.target(to)
    if ("error" in found) return { delivered: false, ...found }
    const { target } = found
    // A retry with the same request id gets the task it already started.
    const existing = this.sql<{ bot_id: string; bot_name: string }>`
      SELECT bot_id, bot_name FROM client_tasks
      WHERE id = ${taskId} AND client_id = ${client.clientId}`[0]
    if (existing) {
      return { delivered: true, to: existing.bot_name, botId: existing.bot_id }
    }
    this.sql`INSERT INTO client_tasks
      (id, client_id, bot_id, bot_name, task, status, created_at)
      VALUES (${taskId}, ${client.clientId}, ${target.id}, ${target.name},
              ${clip(task, 4_000)}, 'open', ${Date.now()})`
    const bot = await this.bot(target.id)
    await bot.receiveTask(
      { kind: "agent", name: client.label },
      delegationPrompt(client.label, task, "agent"),
      {
        task: {
          id: taskId,
          replyTo: { kind: "client", clientId: client.clientId },
        },
        key: `client-task:${taskId}`,
        hops: 1,
        // Not background: approvals it needs reach the user as Needs-you
        // cards instead of the work being blocked.
        background: false,
      }
    )
    return { delivered: true, to: target.name, botId: target.id }
  }

  async clientTask(
    clientId: string,
    taskId: string
  ): Promise<ClientTask | null> {
    const row = this.sql<{
      id: string
      bot_id: string
      bot_name: string
      status: ClientTask["status"]
      result: string | null
      error: string | null
      created_at: number
      finished_at: number | null
    }>`SELECT * FROM client_tasks WHERE id = ${taskId} AND client_id = ${clientId}`[0]
    if (!row) return null
    return {
      id: row.id,
      botId: row.bot_id,
      botName: row.bot_name,
      status: row.status,
      result: row.result,
      error: row.error,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    }
  }

  /** A bot hands another a task; the result comes back through `completeTask`. */
  async delegateTask(
    fromBotId: string,
    to: string,
    task: string,
    delivery: {
      taskId: string
      key: string
      hops: number
      background: boolean
      files?: BotAttachment[]
    }
  ): Promise<Delivery> {
    const found = this.recipient(fromBotId, to)
    if ("error" in found) return { delivered: false, ...found }
    const { from, target } = found
    const bot = await this.bot(target.id)
    await bot.receiveTask(
      { kind: "bot", name: from.name, avatar: from.avatar },
      delegationPrompt(from.name, task),
      {
        task: {
          id: delivery.taskId,
          replyTo: { kind: "bot", botId: fromBotId },
        },
        key: delivery.key,
        hops: delivery.hops,
        background: delivery.background,
        ...(delivery.files ? { files: delivery.files } : {}),
      }
    )
    return { delivered: true, to: target.name, botId: target.id }
  }

  /** A bot finished a task: send the result to whoever handed it out. */
  async completeTask(botId: string, task: BotTask, outcome: TaskOutcome) {
    const { replyTo } = task
    if (replyTo.kind === "pipeline") {
      await this.finishBotStep(replyTo.runId, replyTo.step, botId, outcome)
      return
    }
    if (replyTo.kind === "client") {
      // Waits here for the agent's task_status.
      this.sql`UPDATE client_tasks SET status = ${outcome.status},
        result = ${clip(outcome.result, MAX_CLIENT_RESULT_CHARS)},
        error = ${outcome.error ?? null}, finished_at = ${Date.now()}
        WHERE id = ${task.id} AND client_id = ${replyTo.clientId}`
      return
    }
    if (!this.state.bots.some((b) => b.id === replyTo.botId)) return
    const from = this.state.bots.find((b) => b.id === botId)
    const sender = await this.bot(replyTo.botId)
    await sender.receiveTaskResult(
      {
        kind: "bot",
        name: from?.name ?? "A deleted bot",
        ...(from ? { avatar: from.avatar } : {}),
      },
      task.id,
      outcome
    )
  }

  // ── Pipelines ───────────────────────────────────────────────────────

  private get pipelines() {
    return this.state.pipelines ?? []
  }

  private get runs() {
    return this.state.pipelineRuns ?? []
  }

  @callable()
  async savePipeline(
    input: PipelineDraft & { id?: string }
  ): Promise<Pipeline> {
    const draft = validatePipeline(
      input,
      new Set(this.state.bots.map((b) => b.id))
    )
    const now = Date.now()
    const existing = input.id
      ? this.pipelines.find((p) => p.id === input.id)
      : undefined
    if (!existing && this.pipelines.length >= MAX_PIPELINES) {
      throw new Error(`You can have at most ${MAX_PIPELINES} pipelines.`)
    }
    const pipeline: Pipeline = existing
      ? { ...existing, ...draft, updatedAt: now }
      : {
          id: crypto.randomUUID().slice(0, 8),
          ...draft,
          createdAt: now,
          updatedAt: now,
        }
    this.setState({
      ...this.state,
      pipelines: existing
        ? this.pipelines.map((p) => (p.id === pipeline.id ? pipeline : p))
        : [pipeline, ...this.pipelines],
    })
    await this.cancelPipelineSchedule(pipeline.id)
    if (pipeline.cron) {
      await this.schedule(pipeline.cron, "runScheduledPipeline", {
        id: pipeline.id,
      })
    }
    return pipeline
  }

  @callable()
  async deletePipeline(pipelineId: string) {
    await this.cancelPipelineSchedule(pipelineId)
    const gone = this.runs.filter((r) => r.pipelineId === pipelineId)
    for (const run of gone) this.dropRunData(run.id)
    this.setState({
      ...this.state,
      pipelines: this.pipelines.filter((p) => p.id !== pipelineId),
      pipelineRuns: this.runs.filter((r) => r.pipelineId !== pipelineId),
    })
  }

  @callable()
  async runPipeline(pipelineId: string, input = ""): Promise<PipelineRun> {
    const pipeline = this.pipelines.find((p) => p.id === pipelineId)
    if (!pipeline) throw new Error("No such pipeline.")
    return this.startRun(pipeline, "manual", input)
  }

  /** The user's answer to an approval step. */
  @callable()
  async answerPipelineStep(runId: string, approved: boolean) {
    const run = this.runs.find((r) => r.id === runId)
    const index = run?.steps.findIndex((s) => s.status === "waiting") ?? -1
    if (!run || run.status !== "waiting" || index === -1) {
      throw new Error("That step was already answered.")
    }
    if (!approved) {
      this.patchStep(runId, index, {
        status: "failed",
        error: "You turned it down.",
        finishedAt: Date.now(),
      })
      await this.finishRun(runId, "stopped")
      return
    }
    this.patchStep(runId, index, { status: "done", finishedAt: Date.now() })
    this.patchRun(runId, { status: "running" })
    await this.advanceRun(runId)
  }

  /**
   * Stop a run. A bot already working on a step finishes its turn, but its
   * result goes nowhere.
   */
  @callable()
  async stopPipelineRun(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run || (run.status !== "running" && run.status !== "waiting")) return
    const index = run.steps.findIndex(
      (s) => s.status === "running" || s.status === "waiting"
    )
    if (index !== -1) {
      this.patchStep(runId, index, {
        status: "failed",
        error: "Stopped.",
        finishedAt: Date.now(),
      })
    }
    await this.finishRun(runId, "stopped")
  }

  /** A step's full result; state only carries the start of it. */
  @callable()
  pipelineOutput(runId: string, step: number): string | null {
    return (
      this.sql<{ output: string }>`SELECT output FROM pipeline_outputs
        WHERE run_id = ${runId} AND step = ${step}`[0]?.output ?? null
    )
  }

  /** Schedule callback. */
  async runScheduledPipeline(payload: { id: string }) {
    const pipeline = this.pipelines.find((p) => p.id === payload.id)
    if (!pipeline?.cron) return
    // Two runs of one pipeline at once would do the same work twice.
    const busy = this.runs.some(
      (r) =>
        r.pipelineId === pipeline.id &&
        (r.status === "running" || r.status === "waiting")
    )
    if (busy) return
    await this.startRun(pipeline, "schedule", "")
  }

  private async cancelPipelineSchedule(pipelineId: string) {
    const matches = this.getSchedules<{ id: string }>().filter(
      (s) =>
        s.callback === "runScheduledPipeline" && s.payload.id === pipelineId
    )
    for (const match of matches) await this.cancelSchedule(match.id)
  }

  private async startRun(
    pipeline: Pipeline,
    trigger: PipelineRun["trigger"],
    input: string
  ): Promise<PipelineRun> {
    const run: PipelineRun = {
      id: crypto.randomUUID().slice(0, 8),
      pipelineId: pipeline.id,
      name: pipeline.name,
      status: "running",
      trigger,
      input: input.trim().slice(0, MAX_PIPELINE_INPUT_CHARS),
      plan: pipeline.steps,
      steps: pipeline.steps.map(() => ({ status: "pending" })),
      startedAt: Date.now(),
      finishedAt: null,
    }
    const runs = [run, ...this.runs]
    for (const old of runs.slice(MAX_PIPELINE_RUNS)) this.dropRunData(old.id)
    this.setState({
      ...this.state,
      pipelineRuns: runs.slice(0, MAX_PIPELINE_RUNS),
    })
    await this.advanceRun(run.id)
    return this.runs.find((r) => r.id === run.id) ?? run
  }

  /** Start the run's next pending step, or finish the run. */
  private async advanceRun(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run || run.status !== "running") return
    const index = run.steps.findIndex((s) => s.status === "pending")
    if (index === -1) {
      await this.finishRun(runId, "done")
      return
    }
    const step = run.plan[index]
    if (step.kind === "approval") {
      this.patchStep(runId, index, { status: "waiting", startedAt: Date.now() })
      this.patchRun(runId, { status: "waiting" })
      await this.push({
        title: `Pipeline · ${run.name}`,
        body: step.note
          ? `Needs your OK: ${clip(step.note, 140)}`
          : `Step ${index + 1} needs your OK to continue`,
        tag: `pipeline-${run.pipelineId}`,
        url: `/pipelines/${run.pipelineId}`,
      })
      return
    }

    const bot = this.state.bots.find((b) => b.id === step.botId)
    if (!bot) {
      await this.failStep(runId, index, "Its bot was deleted.")
      return
    }
    if (bot.paused) {
      await this.failStep(runId, index, `${bot.name} is paused.`)
      return
    }
    this.patchStep(runId, index, {
      status: "running",
      botName: bot.name,
      startedAt: Date.now(),
    })
    const previous = this.previousResult(run, index)
    try {
      const target = await this.bot(bot.id)
      await target.receiveTask(
        { kind: "pipeline", name: run.name },
        pipelineStepPrompt({
          pipeline: run.name,
          step: index,
          steps: run.plan.length,
          instructions: step.instructions,
          from: previous.from,
          input: previous.text,
          next: this.nextRecipient(run.plan, index),
        }),
        {
          task: {
            id: `${run.id}:${index}`,
            replyTo: { kind: "pipeline", runId: run.id, step: index },
          },
          key: `pipeline:${run.id}:${index}`,
          hops: 1,
          // Nobody is watching a scheduled run: no approvals, cheaper model.
          background: run.trigger === "schedule",
          ...(previous.files.length ? { files: previous.files } : {}),
        }
      )
    } catch (err) {
      console.error(`Pipeline ${run.id} step ${index} did not start`, err)
      await this.failStep(runId, index, "The bot could not be reached.")
    }
  }

  /** A bot step reported back. */
  private async finishBotStep(
    runId: string,
    index: number,
    botId: string,
    outcome: TaskOutcome
  ) {
    const run = this.runs.find((r) => r.id === runId)
    const step = run?.plan[index]
    // Stopped runs, and re-delivered results, are ignored.
    if (
      !run ||
      run.status !== "running" ||
      run.steps[index]?.status !== "running" ||
      step?.kind !== "bot" ||
      step.botId !== botId
    ) {
      return
    }
    this.sql`INSERT OR REPLACE INTO pipeline_outputs (run_id, step, output)
      VALUES (${runId}, ${index}, ${outcome.result})`
    const passed: string[] = []
    const notes: string[] = []
    for (const file of outcome.files ?? []) {
      if (file.bytes.byteLength > MAX_STORED_FILE_BYTES) {
        notes.push(`${file.name} was too big to pass on.`)
        continue
      }
      // The tagged `sql` helper takes no blobs.
      this.ctx.storage.sql.exec(
        "INSERT INTO pipeline_files (run_id, step, name, bytes) VALUES (?, ?, ?, ?)",
        runId,
        index,
        file.name,
        file.bytes.slice().buffer
      )
      passed.push(file.name)
    }
    if (outcome.status !== "done") {
      this.patchStep(runId, index, {
        output: clip(outcome.result, MAX_STEP_OUTPUT_IN_STATE),
      })
      await this.failStep(
        runId,
        index,
        outcome.error ??
          (outcome.status === "stopped" ? "It was stopped." : "It failed.")
      )
      return
    }
    const error = [outcome.error, ...notes].filter(Boolean).join(" ")
    this.patchStep(runId, index, {
      status: "done",
      output: clip(outcome.result, MAX_STEP_OUTPUT_IN_STATE),
      ...(passed.length ? { files: passed } : {}),
      ...(error ? { error } : {}),
      finishedAt: Date.now(),
    })
    await this.advanceRun(runId)
  }

  private async failStep(runId: string, index: number, error: string) {
    this.patchStep(runId, index, {
      status: "failed",
      error,
      finishedAt: Date.now(),
    })
    await this.finishRun(runId, "failed")
  }

  private async finishRun(
    runId: string,
    status: "done" | "failed" | "stopped"
  ) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    this.patchRun(runId, {
      status,
      finishedAt: Date.now(),
      steps: run.steps.map((s) =>
        s.status === "pending" ? { ...s, status: "skipped" } : s
      ),
    })
    // Outputs stay for the run history; files were only for the next step.
    this.sql`DELETE FROM pipeline_files WHERE run_id = ${runId}`
    if (status === "stopped") return
    const failed = run.steps.findIndex((s) => s.status === "failed")
    const last = run.steps.findLast((s) => s.output)
    await this.push({
      title: `Pipeline · ${run.name}`,
      body:
        status === "done"
          ? clip(last?.output?.replace(/\s+/g, " ").trim() || "Finished.", 160)
          : `Step ${failed + 1} failed: ${clip(run.steps[failed]?.error ?? "", 140)}`,
      tag: `pipeline-${run.pipelineId}`,
      url: `/pipelines/${run.pipelineId}`,
    })
  }

  /** What a step starts from: the latest finished bot step, or the user's input. */
  private previousResult(run: PipelineRun, index: number) {
    for (let i = index - 1; i >= 0; i--) {
      if (run.plan[i].kind !== "bot" || run.steps[i].status !== "done") {
        continue
      }
      const files = this.sql<{ name: string; bytes: ArrayBuffer }>`
        SELECT name, bytes FROM pipeline_files
        WHERE run_id = ${run.id} AND step = ${i}`.map((f): BotAttachment => ({
        name: f.name,
        bytes: new Uint8Array(f.bytes),
      }))
      return {
        from: `${run.steps[i].botName ?? "the previous bot"} (step ${i + 1})`,
        text: this.pipelineOutput(run.id, i) ?? "",
        files,
      }
    }
    return { from: "the user", text: run.input, files: [] }
  }

  /** Who sees a step's result next: the next bot, or the user. */
  private nextRecipient(plan: PipelineStep[], index: number) {
    for (const step of plan.slice(index + 1)) {
      if (step.kind === "approval") return "the user, for approval"
      const bot = this.state.bots.find((b) => b.id === step.botId)
      if (bot) return `the ${bot.name} bot`
    }
    return "the user"
  }

  private patchRun(runId: string, patch: Partial<PipelineRun>) {
    this.setState({
      ...this.state,
      pipelineRuns: this.runs.map((r) =>
        r.id === runId ? { ...r, ...patch } : r
      ),
    })
  }

  private patchStep(
    runId: string,
    index: number,
    patch: Partial<PipelineRunStep>
  ) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    this.patchRun(runId, {
      steps: run.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  private dropRunData(runId: string) {
    this.sql`DELETE FROM pipeline_outputs WHERE run_id = ${runId}`
    this.sql`DELETE FROM pipeline_files WHERE run_id = ${runId}`
  }
}

/** Sorts a failed app call: an expired sign-in, a server that is down, or the tool itself. */
function classifyAppFailure(message: string): "auth" | "unreachable" | "tool" {
  if (
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]token|token (has )?expired/i.test(
      message
    )
  ) {
    return "auth"
  }
  if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|timed? ?out|\b(502|503|504)\b|not connected/i.test(
      message
    )
  ) {
    return "unreachable"
  }
  return "tool"
}
