import {
  Workspace,
  WorkspaceServiceProxy,
  unsafeToRepeat,
} from "@cloudflare/computer"
import type {
  DurableObjectStorageLike,
  WorkspaceModuleCallContext,
  WorkspaceModuleFactory,
  WorkspaceRuntimePendingCall,
  WorkspaceRuntimeResult,
  WorkspaceRuntimeValue,
  WorkspaceStub,
} from "@cloudflare/computer"
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript"
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell"
import curl from "@cloudflare/computer/shell/curl"
import jq from "@cloudflare/computer/shell/jq"
import { createAITools } from "@cloudflare/computer/tools/ai-sdk"
import { Think } from "@cloudflare/think"
import type {
  ChatResponseResult,
  ThinkIntervalSchedule,
  PrepareStepContext,
  StepConfig,
  ThinkScheduledTasks,
  ToolCallContext,
  ToolCallDecision,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think"
import { createBrowserRuntime } from "@cloudflare/think/tools/browser"
import type { BrowserRuntime } from "@cloudflare/think/tools/browser"
import { exports } from "cloudflare:workers"
import { callable, getAgentByName } from "agents"
import { CHAT_MESSAGE_TYPES } from "agents/chat"
import type { ContextConfig } from "agents/context"
import { isAutoReplyEmail } from "agents/email"
import type { AgentEmail } from "agents/email"
import { jsonSchema, tool } from "ai"
import type { JSONSchema7, ToolSet, UIMessage } from "ai"
import PostalMime from "postal-mime"
import { isModelId } from "@/lib/models"
import type { ModelSettings } from "@/lib/models"
import { z } from "zod"
import {
  DEFAULT_PROACTIVE,
  DEFAULT_RULES,
  NEW_BOT_NAME,
  NO_UPDATE,
  appPath,
} from "@/lib/types"
import type {
  ActionClass,
  AppCatalog,
  AppLink,
  ActivityEntry,
  BotAppDetail,
  BotAttachment,
  BotAvatarKind,
  BotInbound,
  BotState,
  BotStatus,
  BotTask,
  BrowserFrame,
  MessageMeta,
  MessageOrigin,
  OpenItem,
  ScriptApproval,
  ProactiveSettings,
  Routine,
  RoutineRun,
  RoutineWatch,
  RulePolicy,
  Skill,
  TaskOutcome,
} from "@/lib/types"
import {
  APPS_ROOT,
  AppDataError,
  AppStore,
  assertCollection,
  isAppSlug,
} from "./app-store"
import type { AppItem } from "./app-store"
import { MIME_TYPES, appLiveName } from "./apps-runtime"
import type {
  AppCaller,
  AppDataOp,
  AppLive,
  AppLiveMessage,
} from "./apps-runtime"
import {
  GREETING,
  SOUL,
  appEventPrompt,
  checkInPrompt,
  crawlPrompt,
  emailPrompt,
  routinePrompt,
  scriptPrompt,
  turnContext,
  webhookPrompt,
  withSentTimes,
} from "./prompt"
import type { ReportedEntry, ScriptOutcome } from "./prompt"
import { frameCode, navCode } from "./browser-frame"
import type { BrowserNav, FrameResult, SeenTab } from "./browser-frame"
import { finishTeachingCode, startTeachingCode } from "./teach"
import type { TeachRecording, TeachSession } from "./teach"
import type { UserHub } from "./user-hub"
import { LoopGuard, shapeToolResults } from "./guards"
import { MAX_MEMORY_CHARS, appendFact } from "./memory"
import { gatewayId, languageModel, pickModel } from "./models"
import { createSearchTools } from "./search-tools"
import {
  MAX_SECRET_RESPONSE_CHARS,
  SECRET_REQUEST_TIMEOUT_MS,
  authHeader,
  httpsOrigin,
  redact,
  validSecretName,
} from "./secrets"
import type { SecretMeta, SecretScheme } from "./secrets"
import { createWebTools } from "./web-tools"
import type { CrawlInput, QuickEngine } from "./web-tools"

// The worker-shell backend hands this class to its Dynamic Worker as a
// loopback binding (via `ctx.exports`), so it must be exported by the Worker
// entry. `src/server.ts` re-exports it from here.
export { WorkspaceServiceProxy }

const WORKSPACE_DIRS = [
  "inbox",
  "drafts",
  "artifacts",
  "downloads",
  "scratch",
  "skills",
  "apps",
] as const

/** Which rule governs each built-in tool. Tools not listed are always allowed. */
const TOOL_CLASS: Record<string, ActionClass> = {
  write: "files",
  edit: "files",
  delete: "files",
  exec: "shell",
  run_js: "shell",
  web_search: "browse",
  browser_markdown: "browse",
  browser_extract: "browse",
  browser_links: "browse",
  browser_scrape: "browse",
  browser_screenshot: "browse",
  browser_pdf: "browse",
  browser_crawl: "browse",
  browser_execute: "browser",
  message_bot: "bots",
  delegate_task: "bots",
  secret_request: "apps",
  schedule_routine: "routines",
  update_routine: "routines",
  start_teaching: "browser",
  finish_teaching: "browser",
  save_skill: "files",
  save_app: "files",
  delete_app: "files",
}

const MAX_PREVIEW = 140
/** A routine run still "running" after this long no longer blocks the next. */
const ROUTINE_OVERLAP_MS = 30 * 60_000
/** A failed routine run is retried once, this long after it failed. */
const ROUTINE_RETRY_DELAY_S = 10 * 60
/** No retry when the next scheduled run is closer than this. */
const ROUTINE_RETRY_SKIP_MS = 30 * 60_000
/** "Typing…" with no tool activity for this long, and no turn running, is stale. */
const STALE_STATUS_MS = 10 * 60_000
/** An unanswered approval card gets one push reminder after this long… */
const APPROVAL_REMIND_MS = 4 * 3_600_000
/** …and is closed as unanswered after this long. */
const APPROVAL_EXPIRE_MS = 24 * 3_600_000
/** exec returns a job id when a command takes longer than this. */
const EXEC_WAIT_MS = 60_000
/** How long a script may run, not counting time paused for approval. */
const SCRIPT_TIMEOUT_MS = 10 * 60_000
/** A detached script not heard from this long past its timeout is given up. */
const SCRIPT_GRACE_MS = 15 * 60_000
/** How often detached scripts are checked on, and resumed after a restart. */
const SCRIPT_POLL_S = 60
/** How much of a watched output is kept and shown to the model, in characters. */
const WATCH_SAMPLE_CHARS = 3_000
/** Past this many app tools, the bot searches for tools instead of seeing all. */
const LAZY_APP_TOOLS = 20
/** Files one message_bot call can carry, and their combined size. */
const MAX_BOT_FILES = 10
const MAX_BOT_FILE_BYTES = 5 * 1024 * 1024
/** A chain of bot-to-bot messages stops after this many bots. */
const MAX_BOT_HOPS = 6
/** Tools that only read: rerunning one after an interruption is harmless. */
const READ_ONLY_TOOLS = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "web_search",
  "browser_markdown",
  "browser_extract",
  "browser_links",
  "browser_scrape",
  "list_routines",
  "list_secrets",
  "app_tools_search",
  "search_history",
  "read_history",
  "ask_user",
  "shell_job",
  "script_wait",
  "was_reported",
  "list_apps",
  "app_data_list",
])
/** A foreground turn longer than this gets a push when it finishes. */
const LONG_TURN_MS = 90_000
const MAX_OPEN_ITEMS_IN_PROMPT = 25
const MAX_REPORTED_IN_PROMPT = 40
const MAX_INBOUND_CHARS = 8000
const MAX_WEBHOOK_BYTES = 256 * 1024
const DAY_MS = 86_400_000
/** A task handed out longer ago than this no longer shows as outstanding. */
const DELEGATION_STALE_MS = 3 * DAY_MS
/** How much of a task's instructions a result message repeats back. */
const TASK_ECHO_CHARS = 300
const MAX_FILE_PREVIEW_BYTES = 200_000
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const WORKSPACE_ROOT = "/workspace"
const MAX_TREE_ENTRIES = 5000
/** App edits are batched into one background turn this long after the first. */
const APP_EVENT_DELAY_S = 30
const MAX_APP_EVENTS = 30
const MAX_APP_FILE_BYTES = 512 * 1024
/** Files in an app folder that are never served to the browser. */
const PRIVATE_APP_FILES = new Set(["server.js", "app.json"])

/**
 * Main module of an app's Dynamic Worker. The binding arrives per request
 * as entrypoint props; this puts it on `env.BOT` for the app's server.js.
 */
const APP_SERVER_MAIN = "__coworkers_main.js"
const APP_SERVER_WRAPPER = `import app from "./server.js";
export default {
  fetch(request, env, ctx) {
    const handler = app && (app.fetch || (app.default && app.default.fetch));
    if (typeof handler !== "function") {
      return new Response("server.js must export default { fetch }", { status: 500 });
    }
    return handler.call(app, request, { ...env, BOT: ctx.props.BOT }, ctx);
  },
};
`

/** A safe path inside an app folder, or null. */
function appFilePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/")
  if (
    parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))
  )
    return null
  return parts.join("/")
}

function stripMeta(item: AppItem) {
  const { updatedAt: _a, updatedBy: _b, ...rest } = item
  return rest
}

interface RoutinePayload {
  id: string
  name: string
  prompt: string
  kind: Routine["kind"]
  onlyNew?: boolean
  watch?: RoutineWatch
}

/** A task this bot handed to another bot (`delegate_task`). */
interface DelegationRow {
  id: string
  to_name: string
  task: string
  created_at: number
  finished_at: number | null
  status: "open" | TaskOutcome["status"]
  hops: number
  background: number
}

interface RoutineRunRow {
  id: string
  routine_id: string
  name: string
  started_at: number
  finished_at: number | null
  status: RoutineRun["status"]
  attempt: number
  note: string
}

function toRoutineRun(r: RoutineRunRow): RoutineRun {
  return {
    id: r.id,
    routineId: r.routine_id,
    name: r.name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    attempt: r.attempt,
    note: r.note,
  }
}

/** The approval id of a tool part waiting on the user, if it is one. */
function pendingApprovalId(part: UIMessage["parts"][number]): string | null {
  const p = part as {
    state?: string
    approval?: { id?: string }
    toolCallId?: string
  }
  if (p.state !== "approval-requested") return null
  return p.approval?.id ?? p.toolCallId ?? null
}

/** Close an approval nobody answered, so the card stops asking. */
function expireApproval(
  part: UIMessage["parts"][number]
): UIMessage["parts"][number] {
  const p = part as { approval?: Record<string, unknown> }
  return {
    ...part,
    state: "output-denied",
    approval: {
      ...p.approval,
      approved: false,
      reason: "Nobody answered within 24 hours, so this was not done.",
    },
  } as UIMessage["parts"][number]
}

/** A Browser Run crawl the bot started, polled until it finishes. */
interface CrawlJob {
  id: string
  url: string
  purpose: string
  startedAt: number
  polls: number
}

interface CrawlRecord {
  url: string
  status: string
  markdown?: string
  metadata?: { title?: string; status?: number }
}

const CRAWL_FIRST_POLL_S = 20
const CRAWL_MAX_POLL_S = 300
/** Give up on a crawl that has not finished after this long. */
const CRAWL_MAX_WAIT_MS = 6 * 60 * 60 * 1000
const CRAWL_PAGE_SIZE = 50
const MAX_CRAWL_PAGES = 500
/** Images and PDFs the Files pane and thread can preview. */
const MAX_FILE_DATA_BYTES = 10 * 1024 * 1024
/** Browser frames kept for Computer cards; older cards lose their picture. */
const MAX_BROWSER_FRAMES = 60
/** A step waits this long for its frame before the card is marked done. */
const FRAME_TIMEOUT_MS = 8_000
const ROUTINE_REPORTED_IN_PROMPT = 60

function textOf(message: UIMessage | undefined) {
  if (!message) return ""
  return (
    message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      // Previews are plain text: drop Markdown emphasis and code marks.
      .replace(/[`*_#>]+/g, "")
      .replace(/(^|\s)[-•]\s+/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function metaOf(message: UIMessage | undefined): MessageMeta {
  return (message?.metadata ?? {}) as MessageMeta
}

/** The model may narrate before its tools run; the final text part decides. */
function finalText(message: UIMessage) {
  const parts = message.parts.filter((p) => p.type === "text" && p.text.trim())
  const last = parts.at(-1)
  return last?.type === "text" ? last.text : ""
}

/** Models sometimes explain themselves before or after the token; it wins. */
function isNoUpdate(text: string) {
  const t = text.trim()
  return t.startsWith(NO_UPDATE) || t.endsWith(NO_UPDATE)
}

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Whether `now` falls inside the quiet window, which may wrap midnight. */
function inQuietHours(p: ProactiveSettings, now = new Date()) {
  let local: string
  try {
    local = now.toLocaleTimeString("en-GB", {
      timeZone: p.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  } catch {
    local = now.toISOString().slice(11, 16)
  }
  const t = minutesOf(local)
  const start = minutesOf(p.quietStart)
  const end = minutesOf(p.quietEnd)
  if (start === end) return false
  return start < end ? t >= start && t < end : t >= start || t < end
}

function slugify(text: string, max = 48) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  )
}

function fileStamp(at = Date.now()) {
  return new Date(at).toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface OpenItemRow {
  id: string
  title: string
  note: string
  source_url: string | null
  created_at: number
  updated_at: number
  check_after: number | null
  status: "open" | "resolved"
}

function toOpenItem(r: OpenItemRow): OpenItem {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    ...(r.source_url ? { sourceUrl: r.source_url } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.check_after ? { checkAfter: r.check_after } : {}),
    status: r.status,
  }
}

/**
 * Model-facing name for a connection's tool: `tool_<connection>_<tool>`,
 * limited to the characters and length tool names allow.
 */
function appToolName(connectionId: string, name: string) {
  return `tool_c${connectionId}_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(
    0,
    64
  )
}

/** MCP results carry text in `content`; an `isError` result becomes a throw. */
function unescapeHtml(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function unwrapToolResult(result: unknown) {
  const r = result as {
    content?: { type: string; text?: string }[]
    structuredContent?: unknown
    isError?: boolean
  }
  if (r?.isError) {
    const text = r.content?.map((c) => c.text ?? "").join("\n")
    throw new Error(text || "The app returned an error.")
  }
  return r?.structuredContent ?? r?.content ?? result
}

/**
 * One per bot (instance name = `<userId>:<botId>`). A Think agent with its
 * own chat history, memory, routines, computer (files + shell) and browser.
 */
export class BotAgent extends Think<Env, BotState> {
  initialState: BotState = {
    name: NEW_BOT_NAME,
    avatar: "blue-rectangle",
    role: "",
    status: "idle",
    rules: DEFAULT_RULES,
    routines: [],
    proactive: DEFAULT_PROACTIVE,
    skills: [],
    apps: [],
  }

  override maxSteps = 40

  /** Tools from the user's connections, refreshed from the hub each turn. */
  #appTools: ToolSet = {}
  #appToolNames = new Set<string>()

  /**
   * Scripts (run_js): JavaScript in a fresh Dynamic Worker. "replay" makes a
   * run survive a deploy or crash: it restarts and every call it already
   * made is answered from a journal, so nothing it did happens twice. It is
   * also what lets an app call pause for the user's OK (see ws:apps).
   */
  #js = new WorkerJavaScriptBackend({
    id: "js",
    loader: this.env.LOADER,
    egress: { mode: "direct" },
    onInterrupt: "replay",
    defaultTimeoutMs: SCRIPT_TIMEOUT_MS,
    maxTimeoutMs: SCRIPT_TIMEOUT_MS,
    modules: { "ws:apps": this.appsModule() },
    onWait: (call) => this.scriptWaiting(call),
  })

  /**
   * The bot's computer: a durable filesystem in this Durable Object's SQLite
   * plus a shell and a JavaScript runtime in Dynamic Workers (no container).
   */
  override workspace = new Workspace({
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
    backends: [
      new WorkerShellBackend({
        id: "shell",
        loader: this.env.LOADER,
        workspace: { binding: "BotAgent", id: this.ctx.id.toString() },
        ctx: this.ctx,
        commands: [curl, jq],
        // Without this the shell has no network at all and `curl` fails,
        // which pushes the bot onto the browser for plain HTTP work.
        egress: { mode: "direct" },
      }),
      this.#js,
    ],
  })

  #browser?: BrowserRuntime
  /** App tools a background turn may call without anyone approving. */
  #readOnlyAppTools = new Set<string>()
  #turnStartedAt = 0
  #appStore?: AppStore
  /** The user's Coworkers origin, from the hub each turn. Empty until known. */
  #origin = ""
  #reports: Promise<void> = Promise.resolve()
  /** Shell commands share one backend, so they run one at a time. */
  #shell: Promise<unknown> = Promise.resolve()
  #loopGuard = new LoopGuard()
  /** Results of scripts this isolate started or is watching, by run id. */
  #scripts = new Map<string, Promise<WorkspaceRuntimeResult<"utf8">>>()
  /** run_js and script_wait calls to wake when their script pauses. */
  #scriptWaiters = new Map<string, Set<() => void>>()
  /** Shell commands still running after exec returned. Lost on restart. */
  #jobs = new Map<
    string,
    { command: string; startedAt: number; result: Promise<unknown> }
  >()
  /** In memory only: a restart ends any turn, and onStart resets status. */
  #turnActive = false
  #lastActivity = 0

  /** Apps this bot built, their links and their data. */
  private get apps(): AppStore {
    this.#appStore ??= new AppStore(this.ctx.storage.sql, (slug, token) =>
      appPath(this.userId, this.botId, slug, token)
    )
    return this.#appStore
  }

  /** The Dynamic Worker shell reaches the workspace through this method. */
  async __getWorkspaceStub(): Promise<WorkspaceStub> {
    await this.workspace.ready()
    return this.workspace.stub()
  }

  // ── Identity ────────────────────────────────────────────────────────

  private get userId() {
    return this.name.slice(0, this.name.lastIndexOf(":"))
  }

  private get botId() {
    return this.name.slice(this.name.lastIndexOf(":") + 1)
  }

  private hub() {
    // The binding is declared by Worker name in cloudflare.config.ts, so its
    // generated type does not carry the class.
    return getAgentByName(
      this.env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      this.userId
    )
  }

  /**
   * Best-effort: the sidebar is a cache, a failed report must not fail a turn.
   * Reports are queued so a slow "working" can never land after the turn's
   * "idle" and leave the sidebar stuck on Typing.
   */
  private report(patch: Parameters<UserHub["reportBot"]>[1]) {
    this.#reports = this.#reports.then(async () => {
      try {
        const hub = await this.hub()
        await hub.reportBot(this.botId, patch)
      } catch (err) {
        console.error("reportBot failed", err)
      }
    })
    return this.#reports
  }

  private async setStatus(status: BotStatus) {
    if (this.state.status === status) return
    this.setState({ ...this.state, status })
    await this.report({ status })
  }

  /** Push to the user's devices, unless it is their quiet time. */
  private async notify(body: string) {
    if (!body || inQuietHours(this.state.proactive)) return
    try {
      const hub = await this.hub()
      await hub.notifyUser(this.botId, clip(body, 180))
    } catch (err) {
      console.error("notifyUser failed", err)
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      tool TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      ok INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`
    this.sql`CREATE TABLE IF NOT EXISTS open_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      check_after INTEGER,
      status TEXT NOT NULL DEFAULT 'open'
    )`
    // What the bot already told the user, so background turns do not repeat.
    this.sql`CREATE TABLE IF NOT EXISTS reported (
      key TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    )`
    // Credentials the user typed into a request_secret card. Never in state,
    // never in a message, never sent to the model.
    this.sql`CREATE TABLE IF NOT EXISTS bot_secrets (
      name TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      scheme TEXT NOT NULL,
      header TEXT NOT NULL,
      purpose TEXT NOT NULL,
      value TEXT,
      created_at INTEGER NOT NULL
    )`
    // Every version of the memory block, so a bad edit can be undone.
    this.sql`CREATE TABLE IF NOT EXISTS memory_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL
    )`
    // The last output a watching routine saw, to tell whether it changed.
    this.sql`CREATE TABLE IF NOT EXISTS routine_watch (
      routine_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      sample TEXT NOT NULL,
      checked_at INTEGER NOT NULL
    )`
    // Every routine run and how it ended, for retries, overlap and history.
    this.sql`CREATE TABLE IF NOT EXISTS routine_runs (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL,
      name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT ''
    )`
    // Tasks this bot handed to other bots, until their results come back.
    this.sql`CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      to_name TEXT NOT NULL,
      task TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      hops INTEGER NOT NULL,
      background INTEGER NOT NULL
    )`
    // One row per unprompted message, for the daily cap.
    this.sql`CREATE TABLE IF NOT EXISTS proactive_log (
      at INTEGER NOT NULL
    )`
    // The page each browser_execute step ended on, for its Computer card.
    this.sql`CREATE TABLE IF NOT EXISTS browser_frames (
      tool_call_id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      image TEXT NOT NULL
    )`
    // Scripts (run_js), so one that outlives its turn, a restart or a wait
    // for approval still gets its result back to the bot. "running": a turn
    // is waiting on it. "detached": the result comes back as a message.
    this.sql`CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      answered_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL,
      background INTEGER NOT NULL
    )`
    this.apps.init()
    // Bots created before proactive work, skills or apps existed.
    if (!this.state.proactive || !this.state.skills || !this.state.apps) {
      this.setState({
        ...this.state,
        proactive: { ...DEFAULT_PROACTIVE, ...this.state.proactive },
        skills: this.state.skills ?? [],
        apps: this.apps.list(),
      })
      await this.internal_reconcileScheduledTasks()
    }
    // Connections used to be registered on each bot; they live on the
    // UserHub now. Drop any leftovers so stale tokens are not kept here.
    for (const id of Object.keys(this.getMcpServers().servers)) {
      await this.removeMcpServer(id)
    }
    // A turn cannot survive the isolate going away mid-status, so anything
    // other than a pending approval is stale on a fresh start.
    if (this.state.status === "thinking" || this.state.status === "working") {
      this.setState({ ...this.state, status: "idle" })
    }
    if (!this.getSchedules().some((s) => s.callback === "sweepStuck")) {
      await this.scheduleEvery(15 * 60, "sweepStuck")
    }
    // No turn survives a restart, but its scripts do (they replay), so
    // their results come back as messages. pollScripts resumes them.
    this
      .sql`UPDATE script_runs SET status = 'detached' WHERE status = 'running'`
    if (this.openScripts().length) await this.ensureScriptPoll(1)
    // The hub may still hold a status from before the restart. A bot the hub
    // does not know yet (mid-create) is ignored there.
    if (this.name) void this.report({ status: this.state.status })
  }

  /** Called once by the UserHub right after the bot is created. */
  async setup(avatar: BotAvatarKind) {
    this.setState({ ...this.state, avatar })
    await Promise.all(
      WORKSPACE_DIRS.map((dir) =>
        this.workspace.fs.mkdir(`/workspace/${dir}`, { recursive: true })
      )
    )
    await this.addMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: GREETING }],
      },
    ])
    await this.report({ preview: GREETING })
    // Browser sessions that outlive their idle window are reclaimed here.
    await this.scheduleEvery(30 * 60, "sweepBrowser")
  }

  // ── Working on its own ──────────────────────────────────────────────

  override getDefaultTimezone() {
    return this.state?.proactive?.timezone || "UTC"
  }

  /** The check-in loop. Re-read after settings change (reconcile). */
  override getScheduledTasks(): ThinkScheduledTasks {
    const p = this.state?.proactive
    if (!p?.enabled) return {}
    return {
      "check-in": {
        // Think rejects "every 1 hours": the unit must agree with the count.
        schedule:
          `every ${p.everyHours} ${p.everyHours === 1 ? "hour" : "hours"}` as ThinkIntervalSchedule,
        handler: async ({ idempotencyKey }) => {
          await this.checkIn({ key: idempotencyKey })
        },
      },
    }
  }

  private proactiveToday() {
    return (
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM proactive_log
        WHERE at > ${Date.now() - DAY_MS}`[0]?.n ?? 0
    )
  }

  private openItems(limit = MAX_OPEN_ITEMS_IN_PROMPT): OpenItem[] {
    return this.sql<OpenItemRow>`SELECT * FROM open_items WHERE status = 'open'
      ORDER BY COALESCE(check_after, updated_at) ASC LIMIT ${limit}`.map(
      toOpenItem
    )
  }

  private recentlyReported(): ReportedEntry[] {
    return this.sql<ReportedEntry>`SELECT key, note, at FROM reported
      ORDER BY at DESC LIMIT ${MAX_REPORTED_IN_PROMPT}`
  }

  /**
   * Wake up, look around, and say something only if it is worth it.
   * Skipped in quiet hours, past the daily cap, while a turn is running, and
   * for a bot that has no job yet.
   */
  private async checkIn(options: { key?: string; force?: boolean } = {}) {
    const p = this.state.proactive
    if (!options.force) {
      if (!p.enabled || inQuietHours(p)) return
      if (this.proactiveToday() >= p.maxPerDay) return
      if (this.state.status !== "idle") return
      const hasJob =
        this.state.role.trim() !== "" || this.state.name !== NEW_BOT_NAME
      if (!hasJob && this.openItems(1).length === 0) return
    }
    await this.submitAs(
      { kind: "check-in", name: "Check-in" },
      checkInPrompt({
        lastCheckIn: this.state.lastCheckIn,
        reported: this.recentlyReported(),
        timeZone: p.timezone,
      }),
      { background: true, key: options.key }
    )
  }

  /** Background turns run without the user: see `decide()` and the prompt. */
  private isBackgroundTurn() {
    // The turn's trigger is the latest user message, and approval
    // continuations keep answering it, so its flag covers the whole turn.
    return (
      metaOf(this.messages.findLast((m) => m.role === "user")).background ===
      true
    )
  }

  private inbound(): BotInbound {
    const domain = this.env.EMAIL_DOMAIN?.trim()
    return {
      email: domain ? `${this.userId}.${this.botId}@${domain}` : null,
      webhookUrl: `/api/hooks/${encodeURIComponent(this.userId)}/${this.botId}/${this.webhookToken()}`,
    }
  }

  private webhookToken() {
    let token = this.ctx.storage.kv.get<string>("webhook_token")
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "")
      this.ctx.storage.kv.put("webhook_token", token)
    }
    return token
  }

  // ── Model and prompt ────────────────────────────────────────────────

  /** The account's model choice, as of this bot's latest turn. */
  #models?: ModelSettings

  override getModel() {
    return this.modelFor(false)
  }

  /**
   * Background turns (routines, check-ins, email) can run on a cheaper model
   * than chat, so a strong interactive model does not run up the bill on
   * every scheduled check.
   */
  private turnModel() {
    return this.modelFor(this.isBackgroundTurn())
  }

  private modelFor(background: boolean) {
    const id = pickModel(this.env, this.#models, this.state.model, background)
    return languageModel(this.env, id, {
      settings: this.#models,
      // Shown on each AI Gateway log entry.
      metadata: {
        bot: this.state.name,
        botId: this.botId,
        turn: background ? "background" : "chat",
      },
    })
  }

  override configureContext(): ContextConfig[] {
    return [
      { label: "soul", provider: { get: async () => SOUL } },
      {
        label: "memory",
        description:
          "Durable facts about the user: preferences, people, how they want work done, things to ignore.",
        maxTokens: 2000,
      },
    ]
  }

  /**
   * Think freezes the rendered system prompt per bot, so edits to SOUL would
   * never reach existing bots. Rebuild it once whenever SOUL changes.
   */
  private async refreshSoulIfChanged(): Promise<string | null> {
    let hash = 0
    for (let i = 0; i < SOUL.length; i++) {
      hash = (Math.imul(31, hash) + SOUL.charCodeAt(i)) | 0
    }
    const fingerprint = `${SOUL.length}:${hash}`
    if (this.ctx.storage.kv.get<string>("soul_fingerprint") === fingerprint) {
      return null
    }
    try {
      const system = await this.context.refreshSystemPrompt()
      this.ctx.storage.kv.put("soul_fingerprint", fingerprint)
      return system
    } catch (err) {
      console.error("Refreshing the system prompt failed", err)
      return null
    }
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    await this.setStatus("thinking")
    const system = (await this.refreshSoulIfChanged()) ?? ctx.system
    let others: Awaited<ReturnType<UserHub["listBots"]>> = []
    let catalog: AppCatalog = { apps: [], tools: [] }
    let sharedMemory = ""
    try {
      const hub = await this.hub()
      let origin: string | null
      ;[others, catalog, origin, sharedMemory, this.#models] =
        await Promise.all([
          hub
            .listBots()
            .then((bots) => bots.filter((b) => b.id !== this.botId)),
          hub.appCatalog(),
          hub.appOrigin(),
          // In the per-turn context rather than a context block: it is fresh
          // every turn, and a block's "remind" message breaks approval
          // continuations (it lands after the approval response).
          hub.sharedMemory(),
          hub.modelSettings(),
        ])
      this.#origin = origin ?? ""
    } catch (err) {
      console.error("Loading bots or apps failed", err)
    }
    this.#turnStartedAt = Date.now()
    this.#turnActive = true
    this.#lastActivity = Date.now()
    this.#loopGuard.reset()
    this.#appTools = this.buildAppTools(catalog)
    this.#appToolNames = new Set([
      ...Object.keys(this.#appTools),
      // In lazy mode these are reached through app_tool_call.
      ...catalog.tools.map((t) => appToolName(t.connectionId, t.name)),
    ])
    this.#readOnlyAppTools = new Set(
      catalog.tools
        .filter((t) => t.readOnly)
        .map((t) => appToolName(t.connectionId, t.name))
    )
    const context = turnContext(this.state, others, catalog.apps, {
      openItems: this.openItems(),
      delegations: this.openDelegations().map((d) => ({
        to: d.to_name,
        task: clip(d.task, TASK_ECHO_CHARS),
        at: d.created_at,
      })),
      task: this.currentTask(),
      inbound: this.inbound(),
      sharedMemory,
      builtApps: this.apps.list().map((app) => ({
        ...app,
        path: `${this.#origin}${this.apps.ownerLink(app.slug).path}`,
        collections: this.apps.collections(app.slug),
      })),
    })
    return {
      model: this.turnModel(),
      instructions: `${system}\n\n${context}`,
      messages: withSentTimes(
        ctx.messages,
        this.messages.filter((m) => m.role === "user").map((m) => metaOf(m).at),
        this.state.proactive.timezone
      ),
      tools: this.#appTools,
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────

  private get browser(): BrowserRuntime {
    // One persistent Chromium session per bot ("reuse"), so a login done
    // during a hand-off is still there on the next call.
    this.#browser ??= createBrowserRuntime({
      ctx: this.ctx,
      browser: this.env.BROWSER,
      loader: this.env.LOADER,
      session: { mode: "reuse", key: "main" },
      // Quick Actions come from ./web-tools instead.
      quickActions: false,
    })
    return this.#browser
  }

  /** Quick Actions (and crawl, when configured) on Browser Run. */
  private webTools(): ToolSet {
    // Typed as the literal default; deploys may set it to "chromium".
    const configured: string = this.env.QUICK_ACTION_ENGINE
    const engine: QuickEngine =
      configured === "chromium" ? "chromium" : "kitesurf"
    return createWebTools({
      browser: this.env.BROWSER,
      engine,
      save: (path, content) => this.saveFile(path, content),
      startCrawl: this.crawlConfigured()
        ? (input) => this.startCrawl(input)
        : undefined,
    })
  }

  /** Write a file under /workspace, creating its folder. */
  private async saveFile(relative: string, content: string | Uint8Array) {
    const path = `${WORKSPACE_ROOT}/${relative.replace(/^\/+/, "")}`
    await this.workspace.fs.mkdir(path.slice(0, path.lastIndexOf("/")), {
      recursive: true,
    })
    await this.workspace.fs.writeFile(path, content)
    return path
  }

  private policyFor(toolName: string): RulePolicy {
    // The stand-in for a broken app only explains; it never acts.
    if (toolName.endsWith("_unavailable") && this.#appToolNames.has(toolName))
      return "allow"
    const cls = this.#appToolNames.has(toolName) ? "apps" : TOOL_CLASS[toolName]
    return cls ? this.state.rules[cls] : "allow"
  }

  /**
   * The user's rule for this call, adjusted for background turns: nobody is
   * there to approve, so "ask" becomes "block", while read-only app tools
   * run so the bot can look around (dots-style proactive research).
   */
  private decide(toolName: string): RulePolicy {
    const policy = this.policyFor(toolName)
    if (policy === "block" || !this.isBackgroundTurn()) return policy
    if (this.#readOnlyAppTools.has(toolName)) return "allow"
    if (
      this.#appToolNames.has(toolName) &&
      this.state.proactive.appsInBackground === true
    ) {
      return "allow"
    }
    return policy === "ask" ? "block" : "allow"
  }

  /** Wrap the hub's catalog as AI SDK tools that call back through the hub. */
  /**
   * Many app tools would flood every request with schemas. Past
   * LAZY_APP_TOOLS the bot searches for the tool it needs, then calls it.
   */
  private lazyAppTools(catalog: AppCatalog): ToolSet {
    const byName = new Map(
      catalog.tools.map(
        (t) => [appToolName(t.connectionId, t.name), t] as const
      )
    )
    return {
      app_tools_search: tool({
        description: `Find a tool in the user's connected apps (${catalog.apps
          .filter((a) => a.status === "ready")
          .map((a) => a.name)
          .join(
            ", "
          )}). Returns names, descriptions and argument schemas for app_tool_call.`,
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "What you want to do, e.g. 'search email' or 'create issue'"
            ),
        }),
        execute: async ({ query }) => {
          const words = query
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 1)
          const scored = [...byName.entries()]
            .map(([name, t]) => {
              const hay =
                `${t.connectionName} ${t.name} ${t.description}`.toLowerCase()
              return {
                name,
                t,
                score: words.filter((w) => hay.includes(w)).length,
              }
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
          return {
            tools: scored.map(({ name, t }) => ({
              name,
              app: t.connectionName,
              description: clip(t.description, 300),
              readOnly: t.readOnly,
              inputSchema: t.inputSchema,
            })),
            ...(scored.length
              ? {}
              : {
                  note: "Nothing matched. Try other words, or the app may not offer this.",
                }),
          }
        },
      }),
      app_tool_call: tool({
        description: "Call a connected-app tool found with app_tools_search.",
        inputSchema: z.object({
          tool: z.string().describe("The name app_tools_search returned"),
          args: z.record(z.string(), z.unknown()).optional(),
        }),
        // The rule for the tool itself applies, as if it were called directly.
        needsApproval: async ({ tool: name }) => this.decide(name) === "ask",
        execute: async ({ tool: name, args }) => {
          const t = byName.get(name)
          if (!t)
            return {
              error: "Unknown tool. Find it with app_tools_search first.",
            }
          const hub = await this.hub()
          return unwrapToolResult(
            await hub.callAppTool(t.connectionId, t.name, args ?? {})
          )
        },
      }),
    }
  }

  private buildAppTools(catalog: AppCatalog): ToolSet {
    const tools: ToolSet = {}
    // An app that is not ready has no tools to list. Without a stand-in the
    // bot would say the app is not connected; this lets it say what is wrong.
    for (const app of catalog.apps) {
      if (app.status === "ready") continue
      const problem =
        app.status === "authenticating"
          ? `${app.name} is waiting for the user to sign in.`
          : app.status === "connecting" || app.status === "discovering"
            ? `${app.name} is still connecting.`
            : `${app.name} failed to connect${app.error ? `: ${app.error}` : "."}`
      tools[appToolName(app.id, "unavailable")] = tool({
        description: `[${app.name}] Not available right now. Call this only to learn why, if the user asks for something in ${app.name}.`,
        inputSchema: z.object({}),
        execute: async () => ({
          available: false,
          problem,
          tellTheUser: `${problem} They can fix it in Connections. Offer the browser in the meantime if that would work.`,
        }),
      })
    }
    if (catalog.tools.length > LAZY_APP_TOOLS) {
      return { ...tools, ...this.lazyAppTools(catalog) }
    }
    for (const t of catalog.tools) {
      tools[appToolName(t.connectionId, t.name)] = tool({
        description: `[${t.connectionName}] ${t.description}`.trim(),
        inputSchema: jsonSchema(
          (t.inputSchema as JSONSchema7) ?? { type: "object" }
        ),
        needsApproval: async () =>
          this.decide(appToolName(t.connectionId, t.name)) === "ask",
        execute: async (args) => {
          const hub = await this.hub()
          const result = await hub.callAppTool(
            t.connectionId,
            t.name,
            (args ?? {}) as Record<string, unknown>
          )
          return unwrapToolResult(result)
        },
      })
    }
    return tools
  }

  override getTools(): ToolSet {
    const tools: ToolSet = {
      ...createAITools({
        workspace: this.workspace,
        // Shell only: scripts go through run_js, which tracks each run so
        // its result outlives the turn.
        exec: {
          shell: {
            description:
              "just-bash in a Dynamic Worker. Starts instantly and has internet access. Has cat, ls, grep, sed, awk, jq, sort, head, tail, find, curl and git. Use curl for public APIs and plain HTTP. Cannot run npm, node, python or other binaries.",
          },
        },
      }),
      ...this.scriptTools(),
      ...this.browser.tools,
      ...createSearchTools({
        apiKey: this.env.PARALLEL_API_KEY,
        gatewayToken: this.env.AI_GATEWAY_API_TOKEN,
        gatewayUrl: () =>
          this.env.AI.gateway(gatewayId(this.env)).getUrl("parallel"),
        save: (path, content) => this.saveFile(path, content),
      }),
      ...this.webTools(),
      // No app tools here: beforeTurn adds them, and Think appends them
      // after these. Listing last turn's here too moved them around between
      // turns, and a changed tool list makes the model re-read the whole
      // history uncached.
      ...this.botTools(),
    }

    // The model often runs several exec calls in one step. They share one
    // shell session, and running them at once mixes their output.
    // A slow command returns a job id after EXEC_WAIT_MS instead of holding
    // the step; shell_job waits on it, so the work stays in this turn.
    const exec = tools.exec
    if (exec?.execute) {
      const run = exec.execute.bind(exec)
      tools.exec = {
        ...exec,
        execute: async (input, options) => {
          const result = this.#shell.then(() => run(input, options))
          this.#shell = result.catch(() => undefined)
          const command = String((input as { command?: unknown }).command ?? "")
          return this.waitOrPark(command, result)
        },
      }
      tools.shell_job = tool({
        description:
          "Wait for a shell command that exec reported as still running. Waits up to 60 seconds per call and returns its output once it finishes. Call it again while it says running.",
        inputSchema: z.object({
          id: z.string().describe("The job id exec returned"),
        }),
        execute: async ({ id }) => {
          const job = this.#jobs.get(id)
          if (!job) {
            return {
              error:
                "No such job. It finished and was already collected, or the bot restarted and it was lost. Check its effects before running the command again.",
            }
          }
          return this.waitOrPark(job.command, job.result, id)
        },
      })
    }
    // Each browser step ends with a frame of the page it left the bot on.
    const browse = tools.browser_execute
    if (browse?.execute) {
      const run = browse.execute.bind(browse)
      tools.browser_execute = {
        ...browse,
        execute: async (input, options) => {
          const output = await run(input, options)
          const id = (options as { toolCallId?: string } | undefined)
            ?.toolCallId
          if (id) await this.captureFrame(id)
          return output
        },
      }
    }
    // Apply the user's rules: "ask" pauses the call for an approval card.
    // "block" is enforced in beforeToolCall.
    for (const [name, def] of Object.entries(tools)) {
      if (def.needsApproval !== undefined) continue
      if (!TOOL_CLASS[name]) continue
      tools[name] = {
        ...def,
        needsApproval: async () => this.decide(name) === "ask",
      }
    }
    return tools
  }

  private botTools(): ToolSet {
    return {
      set_name: tool({
        description:
          "Give yourself a name that describes your job, 1-3 words in Title Case. Call once, when the user first tells you what you are for.",
        inputSchema: z.object({ name: z.string().min(2).max(40) }),
        execute: async ({ name }) => {
          await this.rename(name.trim())
          return { renamedTo: name.trim() }
        },
      }),

      request_handoff: tool({
        description:
          "Hand your browser to the user so they can do something you cannot: sign in, pass MFA, or solve a CAPTCHA. Open the right page with browser_execute first. This pauses until the user says they are done.",
        inputSchema: z.object({
          instructions: z
            .string()
            .describe(
              "One sentence telling the user what to do and why, e.g. 'Sign in to Salesforce so I can see the accounts you own.'"
            ),
        }),
        // The approval card is the hand-off: "I'm done" approves it.
        needsApproval: true,
        execute: async () => ({
          status: "user_finished",
          next: "The user says they are done. Inspect the page with browser_execute to confirm before continuing.",
        }),
      }),

      remember: tool({
        description:
          "Save one durable fact to your memory: a preference, a person, a correction, how the user wants something done. One short, plain fact with no pronouns for the user (e.g. 'Wants names of 8 letters or fewer'). Skips facts you already have. Use set_context instead to rewrite or remove lines.",
        inputSchema: z.object({ fact: z.string().max(300) }),
        execute: async ({ fact }) => {
          const current = this.session.getContextBlock("memory")?.content ?? ""
          const result = appendFact(current, fact)
          if ("duplicate" in result)
            return { saved: false, reason: "Already in memory." }
          if ("error" in result) return { saved: false, error: result.error }
          await this.session.replaceContextBlock("memory", result.content)
          this.logMemory("bot", result.content)
          return { saved: true }
        },
      }),

      remember_for_all_bots: tool({
        description:
          "Save a fact every one of the user's bots should know (their name, time zone, team, a standing preference). Only things that are true across jobs; job-specific facts go in remember. Write it as a plain fact with no pronouns, e.g. 'Name: Sam' or 'Time zone: IST'.",
        inputSchema: z.object({ fact: z.string().max(300) }),
        execute: async ({ fact }) => {
          const hub = await this.hub()
          return hub.rememberShared(fact, this.state.name)
        },
      }),

      search_history: tool({
        description:
          "Search everything said in this chat, including messages too old to be in your context. Use it before claiming you remember something exactly. Returns up to 5 matches with ids for read_history.",
        inputSchema: z.object({
          query: z.string().min(2).describe("Words to look for"),
        }),
        execute: async ({ query }) => {
          // The index matches the query as one exact phrase. When that
          // misses, fall back to its words and rank messages by how many hit.
          let hits = await this.session.search(query, { limit: 5 })
          if (hits.length === 0) {
            const words = [
              ...new Set(query.toLowerCase().split(/[^\p{L}\p{N}@.]+/u)),
            ].filter((w) => w.length > 2)
            const seen = new Map<
              string,
              { hit: (typeof hits)[number]; n: number }
            >()
            for (const word of words.slice(0, 6)) {
              for (const hit of await this.session.search(word, {
                limit: 10,
              })) {
                const entry = seen.get(hit.id)
                if (entry) entry.n++
                else seen.set(hit.id, { hit, n: 1 })
              }
            }
            hits = [...seen.values()]
              .sort((a, b) => b.n - a.n)
              .slice(0, 5)
              .map((e) => e.hit)
          }
          return {
            matches: hits.map((hit) => ({
              id: hit.id,
              role: hit.role,
              at: hit.createdAt,
              text: clip(hit.content.replace(/\s+/g, " "), 400),
            })),
            note: hits.length
              ? "Snippets only. Use read_history for the surrounding messages and any later correction."
              : "No matches. Say you do not have it rather than guessing.",
          }
        },
      }),

      read_history: tool({
        description:
          "Read the messages around one found with search_history, to see context and later corrections.",
        inputSchema: z.object({
          id: z.string(),
          around: z
            .number()
            .int()
            .min(0)
            .max(5)
            .optional()
            .describe("Messages before and after, default 2"),
        }),
        execute: async ({ id, around = 2 }) => {
          const history = await this.session.getHistory()
          const index = history.findIndex((m) => m.id === id)
          if (index === -1) return { error: "No message with that id." }
          return {
            messages: history
              .slice(Math.max(0, index - around), index + around + 1)
              .map((m) => ({
                id: m.id,
                role: m.role,
                at: metaOf(m as UIMessage).at
                  ? new Date(metaOf(m as UIMessage).at!).toISOString()
                  : undefined,
                // One message on its own is read in full, or close to it.
                text: clip(textOf(m as UIMessage), around === 0 ? 6000 : 1500),
              })),
          }
        },
      }),

      request_secret: tool({
        description:
          "Ask the user for an API key or token for one HTTPS service. They type it into a masked card; you never see it. Afterwards call secret_request with its name to make authenticated requests. Never ask for credentials in the chat.",
        inputSchema: z.object({
          name: z
            .string()
            .describe("Short id you will refer to it by, e.g. GITHUB_TOKEN"),
          origin: z
            .string()
            .describe(
              "The only HTTPS origin it may be sent to, e.g. https://api.github.com"
            ),
          scheme: z
            .enum(["bearer", "header", "basic"])
            .describe(
              "bearer: Authorization: Bearer <value>. header: a custom header. basic: user:password"
            ),
          header: z
            .string()
            .optional()
            .describe("For scheme header: the header name, e.g. X-API-Key"),
          purpose: z
            .string()
            .max(140)
            .describe("One line the user sees: what you need it for"),
        }),
        // The card is an approval: the value goes to provideSecret over the
        // user's socket, and the approval only says it was saved.
        needsApproval: true,
        execute: async ({ name }) => {
          const row = this.sql<{
            value: string | null
          }>`SELECT value FROM bot_secrets WHERE name = ${name}`[0]
          return row?.value
            ? { saved: true, name, next: "Use secret_request with this name." }
            : { saved: false, name, note: "The user did not enter it." }
        },
      }),

      secret_request: tool({
        description:
          "Make an HTTPS request with a saved credential attached. The URL must be on the origin it was saved for. The response comes back with the credential redacted.",
        inputSchema: z.object({
          name: z.string(),
          url: z.string(),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().optional().describe("Request body, e.g. JSON text"),
        }),
        // Reads are free; writes follow the user's rule for apps.
        needsApproval: async ({ method }) =>
          (method ?? "GET") !== "GET" &&
          this.decide("secret_request") === "ask",
        execute: async ({ name, url, method = "GET", headers = {}, body }) =>
          this.secretRequest(name, url, method, headers, body),
      }),

      list_secrets: tool({
        description:
          "List the credentials you have saved: names, origins and purposes, never values.",
        inputSchema: z.object({}),
        execute: async () => ({ secrets: this.listSecretMeta() }),
      }),

      ask_user: tool({
        description:
          "Ask the user one short question with 2-4 tappable answers, when their choice changes what you do next (which account, which of a few options, go or wait). Prefer it over asking them to type when a few options cover it. You get back the option they picked. If they reply in the chat instead, the call ends and their message is your answer.",
        inputSchema: z.object({
          question: z.string().max(200),
          options: z.array(z.string().max(60)).min(2).max(4),
        }),
        // The card is an approval. Approvals do not carry the tapped option,
        // so the card hands it over with answerChoice() before approving.
        needsApproval: true,
        execute: async (_input, { toolCallId }) => {
          const answer = this.ctx.storage.kv.get<string>(`choice:${toolCallId}`)
          this.ctx.storage.kv.delete(`choice:${toolCallId}`)
          return answer
            ? { answer }
            : {
                answer: null,
                note: "They confirmed without picking an option.",
              }
        },
      }),

      message_bot: tool({
        description:
          "Send a message to another of the user's bots, to delegate work or pass on something it needs. It replies in its own thread.",
        inputSchema: z.object({
          to: z.string().describe("The other bot's name"),
          message: z.string(),
          files: z
            .array(z.string())
            .max(MAX_BOT_FILES)
            .optional()
            .describe(
              "Your own files to send along (paths under /workspace). Each bot has its own computer, so the other bot cannot open your paths: attach the file instead. They are copied into its inbox."
            ),
        }),
        execute: async ({ to, message, files = [] }, { toolCallId }) => {
          const hops =
            (metaOf(this.messages.findLast((m) => m.role === "user")).hops ??
              0) + 1
          if (hops > MAX_BOT_HOPS) {
            return {
              delivered: false,
              error: `This conversation has already passed through ${MAX_BOT_HOPS} bots. Do not forward it again: finish the work yourself or tell the user.`,
            }
          }
          const attachments = await this.readAttachments(files)
          if ("error" in attachments) {
            return { delivered: false, error: attachments.error }
          }
          const hub = await this.hub()
          // Keyed on the tool call, so a recovered turn that re-runs this call
          // does not deliver the message twice.
          return hub.relayMessage(this.botId, to, message, {
            key: `bot:${this.botId}:${toolCallId}`,
            hops,
            ...(attachments.files.length ? { files: attachments.files } : {}),
          })
        },
      }),

      delegate_task: tool({
        description:
          "Hand a piece of work to another of the user's bots and get its result back. Returns at once: the result arrives later as a new message, when that bot finishes. To split a job, delegate the parts to several bots in one step, then end your turn and combine the results as they come in.",
        inputSchema: z.object({
          to: z.string().describe("The other bot's name"),
          task: z
            .string()
            .describe(
              "Self-contained instructions: the goal, what you already know, and what to send back. The other bot has not seen this conversation."
            ),
          files: z
            .array(z.string())
            .max(MAX_BOT_FILES)
            .optional()
            .describe(
              "Your own files it needs (paths under /workspace). They are copied into its inbox."
            ),
        }),
        execute: async ({ to, task, files = [] }, { toolCallId }) => {
          const hops =
            (metaOf(this.messages.findLast((m) => m.role === "user")).hops ??
              0) + 1
          if (hops > MAX_BOT_HOPS) {
            return {
              delegated: false,
              error: `This work has already passed through ${MAX_BOT_HOPS} bots. Do not hand it on again: finish it yourself or tell the user.`,
            }
          }
          const attachments = await this.readAttachments(files)
          if ("error" in attachments) {
            return { delegated: false, error: attachments.error }
          }
          // Derived from the tool call, so a recovered turn that re-runs this
          // call hands out the same task instead of a second one.
          const taskId = `t${toolCallId.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`
          const background = this.isBackgroundTurn()
          this.sql`INSERT OR IGNORE INTO delegations
            (id, to_name, task, created_at, status, hops, background)
            VALUES (${taskId}, ${to}, ${task}, ${Date.now()}, 'open', ${hops},
                    ${background ? 1 : 0})`
          const hub = await this.hub()
          const sent = await hub.delegateTask(this.botId, to, task, {
            taskId,
            key: `task:${this.botId}:${taskId}`,
            hops,
            background,
            ...(attachments.files.length ? { files: attachments.files } : {}),
          })
          if (!sent.delivered) {
            this.sql`DELETE FROM delegations WHERE id = ${taskId}`
            return { delegated: false, error: sent.error }
          }
          this.sql`UPDATE delegations SET to_name = ${sent.to ?? to}
            WHERE id = ${taskId}`
          return {
            delegated: true,
            to: sent.to,
            taskId,
            note: "Its result arrives as a new message when it finishes. Do not wait or check on it.",
          }
        },
      }),

      attach_result_files: tool({
        description:
          "While working on a task another bot (or a pipeline) gave you: send files back with your result. Your final reply is the result; these go with it.",
        inputSchema: z.object({
          files: z
            .array(z.string())
            .min(1)
            .max(MAX_BOT_FILES)
            .describe("Paths under /workspace"),
        }),
        execute: async ({ files }) => {
          const task = this.currentTask()
          if (!task) {
            return {
              error:
                "You are not working on a task from another bot. To send files, use message_bot.",
            }
          }
          const attachments = await this.readAttachments(files)
          if ("error" in attachments) return { error: attachments.error }
          const key = `task_files:${task.id}`
          const earlier = this.ctx.storage.kv.get<string[]>(key) ?? []
          const all = [...new Set([...earlier, ...files])].slice(
            0,
            MAX_BOT_FILES
          )
          this.ctx.storage.kv.put(key, all)
          return { attached: all }
        },
      }),

      schedule_routine: tool({
        description:
          "Schedule work for later. Use `cron` (5-field, UTC) for something recurring, or `at` (ISO 8601 date-time) for a one-off. When it fires you receive `prompt` as a new task, with no memory of this conversation. If you just did the task, write down the method that worked so the routine does not have to rediscover it.",
        inputSchema: z.object({
          name: z.string().describe("Short label, e.g. 'Morning inbox digest'"),
          prompt: z
            .string()
            .describe(
              "Self-contained instructions for your future self: the goal, the exact method that worked (tool, URL, CSS selectors or schema, skill file), and how to format the report"
            ),
          cron: z.string().optional(),
          at: z.string().optional(),
          onlyNew: z
            .boolean()
            .optional()
            .describe(
              "Only message the user about things not reported on an earlier run, and stay quiet otherwise. Use it for routines that run more than daily, or when the user wants changes only. Each run is told how to track what it reported, so the prompt does not need to explain it."
            ),
          watch: z
            .union([
              z.object({
                url: z
                  .string()
                  .describe("A public http(s) page or API to fetch"),
              }),
              z.object({
                command: z
                  .string()
                  .describe(
                    "A shell command whose output to compare, e.g. a curl | jq"
                  ),
              }),
            ])
            .optional()
            .describe(
              "For 'tell me when X changes': checked before each run without using the model. The first check records a baseline, unchanged output skips the run, and a change runs you with the before and after."
            ),
        }),
        execute: async ({ name, prompt, cron, at, onlyNew, watch }) => {
          if (!cron === !at) {
            return { error: "Provide exactly one of `cron` or `at`." }
          }
          const routine = await this.addRoutine({
            name,
            prompt,
            when: (cron ?? at)!,
            kind: cron ? "cron" : "once",
            ...(onlyNew ? { onlyNew: true } : {}),
            ...(watch ? { watch } : {}),
          })
          return { scheduled: routine }
        },
      }),

      update_routine: tool({
        description:
          "Change a routine: fix its instructions when the method in them stopped working, or change its name, schedule or onlyNew. Only the fields you pass change.",
        inputSchema: z.object({
          id: z.string(),
          name: z.string().optional(),
          prompt: z.string().optional(),
          cron: z.string().optional(),
          at: z.string().optional(),
          onlyNew: z.boolean().optional(),
          watch: z
            .union([
              z.object({
                url: z
                  .string()
                  .describe("A public http(s) page or API to fetch"),
              }),
              z.object({
                command: z
                  .string()
                  .describe(
                    "A shell command whose output to compare, e.g. a curl | jq"
                  ),
              }),
            ])
            .nullable()
            .optional()
            .describe(
              "Pass null to stop watching. For 'tell me when X changes': checked before each run without using the model. The first check records a baseline, unchanged output skips the run, and a change runs you with the before and after."
            ),
        }),
        execute: async ({ id, cron, at, ...patch }) => {
          if (cron && at) {
            return { error: "Provide at most one of `cron` or `at`." }
          }
          const routine = await this.updateRoutine(id, {
            ...patch,
            ...(cron ? { when: cron, kind: "cron" as const } : {}),
            ...(at ? { when: at, kind: "once" as const } : {}),
          })
          return routine ? { updated: routine } : { error: `No routine ${id}` }
        },
      }),

      list_routines: tool({
        description: "List your scheduled routines.",
        inputSchema: z.object({}),
        execute: async () => ({
          routines: this.state.routines.map((r) => {
            const last = this.sql<RoutineRunRow>`SELECT * FROM routine_runs
              WHERE routine_id = ${r.id} AND status != 'running'
              ORDER BY started_at DESC LIMIT 1`[0]
            return last
              ? {
                  ...r,
                  lastRun: {
                    status: last.status,
                    at: new Date(last.started_at).toISOString(),
                    note: last.note,
                  },
                }
              : r
          }),
        }),
      }),

      cancel_routine: tool({
        description: "Cancel a scheduled routine by id.",
        inputSchema: z.object({ id: z.string() }),
        execute: async ({ id }) => ({
          cancelled: await this.removeRoutine(id),
        }),
      }),

      track_item: tool({
        description:
          "Start keeping an eye on something for the user: a reply you are waiting for, a receipt you have not found yet, a deadline, a problem to re-check. It shows in your open items on every turn until you resolve it.",
        inputSchema: z.object({
          title: z
            .string()
            .max(120)
            .describe(
              "Short, specific, e.g. 'Airport → hotel receipt, Sep 21'"
            ),
          note: z
            .string()
            .max(600)
            .optional()
            .describe("Current state and what you are waiting for"),
          sourceUrl: z.string().url().optional(),
          checkAfter: z
            .string()
            .optional()
            .describe(
              "ISO 8601 date-time to look again, if there is a natural one"
            ),
        }),
        execute: async ({ title, note, sourceUrl, checkAfter }) => {
          const id = crypto.randomUUID().slice(0, 6)
          const now = Date.now()
          const after = checkAfter ? Date.parse(checkAfter) : NaN
          this.sql`INSERT INTO open_items
            (id, title, note, source_url, created_at, updated_at, check_after, status)
            VALUES (${id}, ${title}, ${note ?? ""}, ${sourceUrl ?? null}, ${now},
                    ${now}, ${Number.isNaN(after) ? null : after}, 'open')`
          return { tracking: id }
        },
      }),

      update_item: tool({
        description: "Record what changed on one of your open items.",
        inputSchema: z.object({
          id: z.string(),
          note: z.string().max(600),
          sourceUrl: z.string().url().optional(),
          checkAfter: z.string().optional(),
        }),
        execute: async ({ id, note, sourceUrl, checkAfter }) => {
          const after = checkAfter ? Date.parse(checkAfter) : NaN
          const rows = this.sql<{ id: string }>`UPDATE open_items
            SET note = ${note},
                source_url = COALESCE(${sourceUrl ?? null}, source_url),
                check_after = ${Number.isNaN(after) ? null : after},
                updated_at = ${Date.now()}
            WHERE id = ${id} RETURNING id`
          return rows.length ? { updated: id } : { error: `No open item ${id}` }
        },
      }),

      resolve_item: tool({
        description:
          "Close an open item because it is done, answered, or no longer matters.",
        inputSchema: z.object({
          id: z.string(),
          outcome: z.string().max(400).describe("What happened, in one line"),
        }),
        execute: async ({ id, outcome }) => {
          const rows = this.sql<{ id: string }>`UPDATE open_items
            SET status = 'resolved', note = ${outcome}, updated_at = ${Date.now()}
            WHERE id = ${id} RETURNING id`
          // Resolved items are kept a while for the settings panel, then dropped.
          this.sql`DELETE FROM open_items
            WHERE status = 'resolved' AND updated_at < ${Date.now() - 14 * DAY_MS}`
          return rows.length
            ? { resolved: id }
            : { error: `No open item ${id}` }
        },
      }),

      mark_reported: tool({
        description:
          "Remember that you told the user about these things, so future check-ins do not repeat them. Use stable keys: an email or thread id, an order number, a URL.",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                key: z.string().max(300),
                note: z.string().max(200).optional(),
              })
            )
            .min(1)
            .max(20),
        }),
        execute: async ({ items }) => {
          const now = Date.now()
          for (const item of items) {
            this.sql`INSERT OR REPLACE INTO reported (key, note, at)
              VALUES (${item.key}, ${item.note ?? ""}, ${now})`
          }
          this.sql`DELETE FROM reported WHERE at < ${now - 60 * DAY_MS}`
          return { remembered: items.length }
        },
      }),

      was_reported: tool({
        description:
          "Check whether you already told the user about these keys (looks back 60 days).",
        inputSchema: z.object({ keys: z.array(z.string()).min(1).max(50) }),
        execute: async ({ keys }) => {
          const placeholders = keys.map(() => "?").join(",")
          const rows = this.ctx.storage.sql
            .exec<{ key: string; at: number }>(
              `SELECT key, at FROM reported WHERE key IN (${placeholders})`,
              ...keys
            )
            .toArray()
          const seen = new Map(rows.map((r) => [r.key, r.at]))
          return Object.fromEntries(
            keys.map((k) => [
              k,
              seen.has(k) ? new Date(seen.get(k)!).toISOString() : false,
            ])
          )
        },
      }),

      start_teaching: tool({
        description:
          "Start recording the user doing a task in your browser, so you can learn it. Opens `startUrl` in your tab. Follow with request_handoff, then finish_teaching.",
        inputSchema: z.object({
          task: z.string().describe("What the user is about to show you"),
          startUrl: z
            .string()
            .url()
            .optional()
            .describe(
              "Where the task begins. Omit to start from the current page."
            ),
        }),
        execute: async ({ task, startUrl }) => {
          const run = await this.browser.runtime.execute({
            code: startTeachingCode(startUrl),
          })
          if (run.status !== "completed") {
            return {
              error:
                run.status === "error"
                  ? run.error
                  : "The browser is waiting on something else.",
            }
          }
          const result = run.result as {
            targetId: string
            startIndex: number
            url?: string
          }
          const session: TeachSession = {
            targetId: result.targetId,
            startIndex: result.startIndex,
            task,
            startedAt: Date.now(),
          }
          this.ctx.storage.kv.put("teach_session", session)
          return {
            recording: true,
            url: result.url,
            next: "Call request_handoff asking the user to do the task in your browser and press I'm done when finished.",
          }
        },
      }),

      finish_teaching: tool({
        description:
          "Stop recording and get what the user did: pages visited, clicks, and values typed (secrets hidden).",
        inputSchema: z.object({}),
        execute: async () => {
          const session = this.ctx.storage.kv.get<TeachSession>("teach_session")
          if (!session)
            return {
              error: "Nothing is being recorded. Call start_teaching first.",
            }
          const run = await this.browser.runtime.execute({
            code: finishTeachingCode(session),
          })
          this.ctx.storage.kv.delete("teach_session")
          if (run.status !== "completed") {
            return {
              error:
                run.status === "error" ? run.error : "The browser is busy.",
            }
          }
          const recording = run.result as TeachRecording
          const path = `/workspace/scratch/teach-${fileStamp(session.startedAt)}.json`
          await this.workspace.fs.writeFile(
            path,
            JSON.stringify({ task: session.task, ...recording }, null, 2)
          )
          return {
            task: session.task,
            pages: recording.pages,
            events: recording.events.slice(-150).map((e) => ({
              t: e.t,
              url: e.url,
              ...(e.title ? { title: e.title } : {}),
              ...(e.value !== undefined ? { value: e.value } : {}),
              ...(e.el ? { el: e.el } : {}),
            })),
            finalUrl: recording.finalUrl,
            savedTo: path,
            note: recording.recycled
              ? "The browser was restarted while the user worked, so this only covers the tab open now. Use it, and ask the user to describe any steps that are missing."
              : recording.events.length === 0
                ? "No clicks were captured (the page may block scripts). Use the pages list and ask the user to fill in the steps."
                : undefined,
          }
        },
      }),

      save_skill: tool({
        description:
          "Save a workflow you learned as a skill under /workspace/skills, so you (and scheduled routines) can follow it later. Saving with an existing name replaces it.",
        inputSchema: z.object({
          name: z
            .string()
            .min(2)
            .max(60)
            .describe("e.g. 'Weekly expense report'"),
          description: z
            .string()
            .max(240)
            .describe("When to use it, in one sentence"),
          steps: z
            .string()
            .describe(
              "Markdown: numbered steps with URLs, where things are on each page, what to type or pick, and how to check it worked"
            ),
        }),
        execute: async ({ name, description, steps }) => {
          const slug = slugify(name)
          const path = `/workspace/skills/${slug}.md`
          const body = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${steps.trim()}\n`
          await this.workspace.fs.mkdir("/workspace/skills", {
            recursive: true,
          })
          await this.workspace.fs.writeFile(path, body)
          const skill: Skill = { slug, name, description }
          this.setState({
            ...this.state,
            skills: [
              ...this.state.skills.filter((s) => s.slug !== slug),
              skill,
            ],
          })
          return { saved: path }
        },
      }),

      save_app: tool({
        description: `Build or update a small web app for the user, served from their Coworkers host. Writes \`files\` to ${APPS_ROOT}/<slug>/, checks the app and publishes it; open copies reload. To publish files you already wrote or edited there yourself, omit \`files\`. See "Building apps".`,
        inputSchema: z.object({
          slug: z
            .string()
            .describe(
              "Folder and URL name, e.g. 'tokyo-trip'. Lowercase, digits, '-'"
            ),
          name: z.string().min(1).max(60).describe("Title, e.g. 'Tokyo trip'"),
          description: z.string().max(240).describe("What it is, in one line"),
          files: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              "Path (relative to the app folder) → the complete file content, never a placeholder. The app needs index.html; server.js is optional. Omit to publish what is already in the folder."
            ),
        }),
        execute: async ({ slug, name, description, files }) =>
          this.publishApp({ slug, name, description, files }),
      }),

      list_apps: tool({
        description:
          "List the apps you built, with their links, collections and item counts.",
        inputSchema: z.object({}),
        execute: async () => ({ apps: this.appDetails() }),
      }),

      delete_app: tool({
        description:
          "Delete an app: its files, its data and every link to it. Only when the user asks.",
        inputSchema: z.object({ slug: z.string() }),
        execute: async ({ slug }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          await this.removeApp(slug)
          return { deleted: slug }
        },
      }),

      app_data_list: tool({
        description:
          "Read the items in one of an app's collections. Items people changed in the app show updatedBy with their link label.",
        inputSchema: z.object({ slug: z.string(), collection: z.string() }),
        execute: async ({ slug, collection }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          return { items: this.apps.items(slug, collection) }
        },
      }),

      app_data_put: tool({
        description:
          "Add or update items in an app's collection. The app shows changes live. An item with an existing id is replaced, or with merge: true only the given fields change. Without an id a new one is made.",
        inputSchema: z.object({
          slug: z.string(),
          collection: z
            .string()
            .describe("e.g. 'flights', 'todos'. Lowercase, digits, '-', '_'"),
          items: z
            .array(z.record(z.string(), z.unknown()))
            .min(1)
            .max(100)
            .describe("JSON objects; give each a stable id when you can"),
          merge: z.boolean().optional(),
        }),
        execute: async ({ slug, collection, items, merge }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          const saved: string[] = []
          for (const item of items) {
            saved.push(
              this.apps.put(slug, collection, item, "bot", { merge }).id
            )
          }
          await this.broadcastApp(slug, { type: "change", collection })
          return { saved }
        },
      }),

      app_data_delete: tool({
        description: "Remove items from an app's collection by id.",
        inputSchema: z.object({
          slug: z.string(),
          collection: z.string(),
          ids: z.array(z.string()).min(1).max(100),
        }),
        execute: async ({ slug, collection, ids }) => {
          if (!this.apps.get(slug)) return { error: `No app "${slug}"` }
          const removed = this.apps.remove(slug, collection, ids)
          await this.broadcastApp(slug, { type: "change", collection })
          return { removed }
        },
      }),
    }
  }

  // ── Apps ────────────────────────────────────────────────────────────

  private appDetails(): BotAppDetail[] {
    return this.apps.list().map((app) => ({
      ...app,
      hasServer: this.apps.get(app.slug)?.hasServer ?? false,
      links: this.apps.links(app.slug),
      collections: this.apps.collections(app.slug),
    }))
  }

  private syncAppsState() {
    this.setState({ ...this.state, apps: this.apps.list() })
  }

  private appLive(slug: string) {
    // Declared by Worker name in cloudflare.config.ts, so untyped.
    const ns = this.env.AppLive as unknown as DurableObjectNamespace<AppLive>
    return ns.getByName(appLiveName(this.userId, this.botId, slug))
  }

  /** Best-effort: a viewer missing one event catches up on its next change. */
  private async broadcastApp(slug: string, message: AppLiveMessage) {
    try {
      await this.appLive(slug).broadcast(message)
    } catch (err) {
      console.error("App broadcast failed", err)
    }
  }

  private async publishApp(input: {
    slug: string
    name: string
    description: string
    files?: Record<string, string>
  }) {
    const slug = input.slug.trim().toLowerCase()
    if (!isAppSlug(slug)) {
      return {
        error: "slug must be lowercase letters, digits and '-', up to 48",
      }
    }
    const dir = `${APPS_ROOT}/${slug}`
    await this.workspace.fs.mkdir(dir, { recursive: true })
    for (const [rawPath, content] of Object.entries(input.files ?? {})) {
      const path = appFilePath(rawPath)
      if (!path) return { error: `Bad file path: ${rawPath}` }
      if (content.length > MAX_APP_FILE_BYTES) {
        return { error: `${rawPath} is over 512 KB` }
      }
      const full = `${dir}/${path}`
      // Models sometimes pass a stub after writing the real file themselves.
      const existing = await this.fileSize(full)
      if (existing > 200 && content.length < Math.min(200, existing / 4)) {
        return {
          error: `${path} already has ${existing} bytes and you passed ${content.length}. Leave it out of files to keep what you wrote, or pass the full content.`,
        }
      }
      await this.workspace.fs.mkdir(full.slice(0, full.lastIndexOf("/")), {
        recursive: true,
      })
      await this.workspace.fs.writeFile(full, content)
    }
    if (!(await this.fileExists(`${dir}/index.html`))) {
      return { error: `${dir}/index.html is missing` }
    }
    const hasServer = await this.fileExists(`${dir}/server.js`)
    const previous = this.apps.get(slug)
    if (hasServer) {
      // Load the new code once before publishing, so a syntax error is
      // reported here instead of to whoever opens the app.
      const problem = await this.checkAppServer(
        slug,
        (previous?.version ?? 0) + 1
      )
      if (problem) return { error: `server.js failed to load: ${problem}` }
    }
    await this.workspace.fs.writeFile(
      `${dir}/app.json`,
      JSON.stringify(
        { name: input.name, description: input.description },
        null,
        2
      )
    )
    const app = this.apps.save({
      slug,
      name: input.name.trim(),
      description: input.description.trim(),
      hasServer,
    })
    this.syncAppsState()
    await this.broadcastApp(slug, { type: "reload", version: app.version })
    return {
      published: slug,
      version: app.version,
      link: `${this.#origin}${this.apps.ownerLink(slug).path}`,
      note: "Give the user this link as is. It is private to them; they can share the app from the Apps tab in your computer panel. Your browser may not reach this host, so do not try to open it.",
    }
  }

  private async removeApp(slug: string) {
    try {
      await this.workspace.fs.rm(`${APPS_ROOT}/${slug}`, { recursive: true })
    } catch {
      // Files already gone.
    }
    this.apps.delete(slug)
    this.syncAppsState()
    try {
      await this.appLive(slug).disconnect()
    } catch (err) {
      console.error("Closing app viewers failed", err)
    }
  }

  private async fileSize(path: string) {
    try {
      const stat = await this.workspace.fs.stat(path)
      return stat.isFile ? stat.size : 0
    } catch {
      return 0
    }
  }

  private async fileExists(path: string) {
    try {
      return (await this.workspace.fs.stat(path)).isFile
    } catch {
      return false
    }
  }

  /** server.js plus anything under server/, as Dynamic Worker modules. */
  private async appModules(slug: string) {
    const dir = `${APPS_ROOT}/${slug}`
    const modules: Record<string, string> = {
      "server.js": await this.workspace.fs.readFile(`${dir}/server.js`, "utf8"),
    }
    let extra: { path: string; type: string }[] = []
    try {
      extra = await this.workspace.fs.find(`${dir}/server`, "**/*.js", {
        limit: 100,
      })
    } catch {
      // No server/ folder.
    }
    for (const entry of extra) {
      if (entry.type !== "file") continue
      const relative = entry.path.slice(dir.length + 1)
      modules[relative] = await this.workspace.fs.readFile(entry.path, "utf8")
    }
    return modules
  }

  /**
   * The app's server.js in a Dynamic Worker, cached per version. The
   * returned fetcher hands it `env.BOT`, scoped to this app and to the
   * link the request came in on.
   */
  private appServer(slug: string, version: number, caller: AppCaller) {
    const worker = this.env.LOADER.get(
      `app:${this.name}:${slug}:${version}`,
      async () => ({
        compatibilityDate: "2026-09-01",
        mainModule: APP_SERVER_MAIN,
        modules: {
          ...(await this.appModules(slug)),
          [APP_SERVER_MAIN]: APP_SERVER_WRAPPER,
        },
        // No internet: app code only talks to its own data, through env.BOT.
        globalOutbound: null,
      })
    )
    const BOT = (
      exports as unknown as {
        AppBinding: (options: { props: unknown }) => Fetcher
      }
    ).AppBinding({
      props: { userId: this.userId, botId: this.botId, slug, caller },
    })
    return worker.getEntrypoint(undefined, { props: { BOT } })
  }

  /** Load new server code once, so errors reach the bot, not the viewer. */
  private async checkAppServer(slug: string, version: number) {
    try {
      const server = this.appServer(slug, version, {
        label: "coworkers check",
        mode: "view",
      })
      await server.fetch("https://app.invalid/__coworkers_check")
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /** Queue an edit someone made in an app; the bot hears about it in a batch. */
  private async queueAppEvent(slug: string, line: string) {
    const key = `app_events:${slug}`
    const events = this.ctx.storage.kv.get<string[]>(key) ?? []
    events.push(line)
    this.ctx.storage.kv.put(key, events.slice(-MAX_APP_EVENTS))
    if (events.length === 1) {
      await this.schedule(APP_EVENT_DELAY_S, "flushAppEvents", { slug })
    }
  }

  /** Schedule callback: tell the bot what people did in one of its apps. */
  async flushAppEvents(payload: { slug: string }) {
    const key = `app_events:${payload.slug}`
    const queued = this.ctx.storage.kv.get<string[]>(key) ?? []
    this.ctx.storage.kv.delete(key)
    const app = this.apps.get(payload.slug)
    if (!app) return
    // Errors from copies still running code the bot has since replaced.
    const events = queued.filter((line) => {
      const match = /^PAGE ERROR \(v(\d+)/.exec(line)
      return !match || Number(match[1]) >= app.version
    })
    if (events.length === 0) return
    // The current contents of what changed, so the bot does not guess.
    const changed = new Set<string>()
    for (const line of events) {
      const match = / (?:added|changed|removed) ([a-z0-9][a-z0-9_-]*)\//.exec(
        line
      )
      if (match) changed.add(match[1])
    }
    const current = [...changed].map((collection) => ({
      collection,
      items: clip(
        JSON.stringify(this.apps.items(app.slug, collection).map(stripMeta)),
        3000
      ),
    }))
    await this.submitAs(
      { kind: "app", name: app.name },
      appEventPrompt({ name: app.name, slug: app.slug, events, current }),
      { background: true }
    )
  }

  /** Durable Object RPC from the Worker: the link behind an app URL. */
  async appLink(slug: string, token: string): Promise<AppLink | null> {
    return this.apps.findLink(slug, token)
  }

  /** Durable Object RPC from the Worker: one request to an app. */
  async serveApp(
    slug: string,
    token: string,
    path: string,
    request: Request
  ): Promise<Response> {
    const link = this.apps.findLink(slug, token)
    const app = link ? this.apps.get(slug) : null
    if (!link || !app) return new Response("Not found", { status: 404 })
    const caller: AppCaller = { label: link.label, mode: link.mode }

    if (
      path === "_data" ||
      path.startsWith("_data/") ||
      path === "_tell" ||
      path === "_error"
    ) {
      return this.serveAppData(slug, caller, path, request)
    }
    if (path.startsWith("_")) return new Response("Not found", { status: 404 })

    const file = await this.readAppFile(slug, path)
    if (file) return file
    if (app.hasServer) {
      // server.js sees paths relative to the app, e.g. "/api/todos".
      const url = new URL(request.url)
      url.pathname = `/${path}`
      try {
        return await this.appServer(slug, app.version, caller).fetch(
          new Request(url, request)
        )
      } catch (err) {
        console.error("App server failed", err)
        return new Response("The app's server crashed", { status: 500 })
      }
    }
    return new Response("Not found", { status: 404 })
  }

  private async readAppFile(
    slug: string,
    path: string
  ): Promise<Response | null> {
    let relative =
      path === "" || path.endsWith("/") ? `${path}index.html` : path
    const clean = appFilePath(relative)
    if (!clean || PRIVATE_APP_FILES.has(clean) || clean.startsWith("server/")) {
      return null
    }
    relative = clean
    const full = `${APPS_ROOT}/${slug}/${relative}`
    let isFile = false
    let isDir = false
    try {
      const stat = await this.workspace.fs.stat(full)
      isFile = stat.isFile
      isDir = stat.isDirectory
    } catch {
      return null
    }
    if (isDir) return this.readAppFile(slug, `${relative}/`)
    if (!isFile) return null
    const ext = relative.slice(relative.lastIndexOf(".") + 1).toLowerCase()
    const type = MIME_TYPES[ext] ?? "application/octet-stream"
    if (type.startsWith("text/html")) {
      // Stamp the version, so errors from stale copies can be told apart.
      const html = await this.workspace.fs.readFile(full, "utf8")
      const version = this.apps.get(slug)?.version ?? 0
      const meta = `<meta name="coworkers-version" content="${version}">`
      const stamped = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`)
        : html
      return new Response(stamped, { headers: { "Content-Type": type } })
    }
    const body = await this.workspace.fs.readFile(full)
    return new Response(body, {
      headers: {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      },
    })
  }

  private async serveAppData(
    slug: string,
    caller: AppCaller,
    path: string,
    request: Request
  ): Promise<Response> {
    const [, collection, id] = path.split("/")
    const method = request.method
    let body: Record<string, unknown> = {}
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const text = await request.text()
      if (text.length > 64 * 1024) {
        return Response.json({ error: "Body too large" }, { status: 413 })
      }
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        return Response.json({ error: "Body must be JSON" }, { status: 400 })
      }
    }
    let op: AppDataOp | null = null
    if (path === "_tell") {
      if (method === "POST") op = { op: "tell", text: String(body.text ?? "") }
    } else if (path === "_error") {
      if (method === "POST") {
        op = {
          op: "error",
          message: String(body.message ?? ""),
          stack: typeof body.stack === "string" ? body.stack : undefined,
          source: typeof body.source === "string" ? body.source : undefined,
          version: Number.isInteger(body.version)
            ? (body.version as number)
            : undefined,
        }
      }
    } else if (!collection) {
      if (method === "GET") op = { op: "info" }
    } else if (!id) {
      if (method === "GET") op = { op: "list", collection }
      if (method === "POST") op = { op: "put", collection, item: body }
    } else {
      if (method === "GET") op = { op: "get", collection, id }
      if (method === "PUT")
        op = { op: "put", collection, item: { ...body, id } }
      if (method === "PATCH") {
        op = { op: "put", collection, item: { ...body, id }, merge: true }
      }
      if (method === "DELETE") op = { op: "remove", collection, id }
    }
    if (!op) {
      return Response.json({ error: "Method not allowed" }, { status: 405 })
    }
    const result = await this.appData(slug, caller, op)
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status })
    }
    const key = op.op === "list" ? "items" : op.op === "info" ? "app" : "item"
    return Response.json(
      op.op === "info" ? result.value : { [key]: result.value },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  /**
   * Durable Object RPC: what an app (its page or its server.js) does with
   * its data. Edits wake the bot so it can react ("dog sitter booked").
   */
  async appData(
    slug: string,
    caller: AppCaller,
    op: AppDataOp
  ): Promise<{ value: unknown } | { error: string; status: number }> {
    const app = this.apps.get(slug)
    if (!app) return { error: "Not found", status: 404 }
    const writes = op.op === "put" || op.op === "remove" || op.op === "tell"
    if (writes && caller.mode !== "edit") {
      return { error: "This link is view-only", status: 403 }
    }
    const by = `link:${caller.label}`
    try {
      switch (op.op) {
        case "info":
          return {
            value: {
              app: { name: app.name, description: app.description },
              collections: this.apps.collections(slug),
              caller,
            },
          }
        case "list":
          return { value: this.apps.items(slug, op.collection) }
        case "get": {
          assertCollection(op.collection)
          const item = this.apps.item(slug, op.collection, op.id)
          return item ? { value: item } : { error: "Not found", status: 404 }
        }
        case "put": {
          const before = op.item.id
            ? this.apps.item(slug, op.collection, String(op.item.id))
            : null
          const item = this.apps.put(slug, op.collection, op.item, by, {
            merge: op.merge,
          })
          await this.broadcastApp(slug, {
            type: "change",
            collection: op.collection,
            id: item.id,
          })
          await this.queueAppEvent(
            slug,
            `${caller.label} ${before ? "changed" : "added"} ${op.collection}/${item.id}: ${clip(JSON.stringify(stripMeta(item)), 400)}`
          )
          return { value: item }
        }
        case "remove": {
          const removed = this.apps.remove(slug, op.collection, [op.id])
          if (removed) {
            await this.broadcastApp(slug, {
              type: "change",
              collection: op.collection,
            })
            await this.queueAppEvent(
              slug,
              `${caller.label} removed ${op.collection}/${op.id}`
            )
          }
          return { value: { removed } }
        }
        case "error": {
          // Once per message per version: every viewer hits the same bug.
          const message = clip(op.message.trim(), 500)
          const key = `app_errors:${slug}`
          const seen = this.ctx.storage.kv.get<{
            version: number
            messages: string[]
          }>(key)
          const messages = seen?.version === app.version ? seen.messages : []
          if (!message || messages.includes(message) || messages.length >= 5) {
            return { value: { reported: false } }
          }
          this.ctx.storage.kv.put(key, {
            version: app.version,
            messages: [...messages, message],
          })
          // A copy opened before the last publish is running old code.
          const version = op.version ?? app.version
          if (version < app.version) return { value: { reported: false } }
          const where = op.source ? ` in ${clip(op.source, 80)}` : ""
          const stack = op.stack ? `\n  ${clip(op.stack, 800)}` : ""
          await this.queueAppEvent(
            slug,
            `PAGE ERROR (v${version}, seen by ${caller.label})${where}: ${message}${stack}`
          )
          return { value: { reported: true } }
        }
        case "tell": {
          const text = op.text.trim()
          if (!text) return { error: "text is required", status: 400 }
          await this.queueAppEvent(
            slug,
            `${caller.label} wrote: ${clip(text, 1000)}`
          )
          return { value: { sent: true } }
        }
      }
    } catch (err) {
      if (err instanceof AppDataError) {
        return { error: err.message, status: err.status }
      }
      throw err
    }
  }

  /**
   * The command's result if it finishes within EXEC_WAIT_MS, otherwise a
   * job id to wait on with shell_job.
   */
  private async waitOrPark(
    command: string,
    result: Promise<unknown>,
    jobId?: string
  ) {
    const TIMEOUT = Symbol("timeout")
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      result.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      ),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), EXEC_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
    if (outcome !== TIMEOUT) {
      if (jobId) this.#jobs.delete(jobId)
      if ("error" in outcome) throw outcome.error
      return outcome.value
    }
    const id = jobId ?? crypto.randomUUID().slice(0, 8)
    const job = this.#jobs.get(id) ?? { command, startedAt: Date.now(), result }
    this.#jobs.set(id, job)
    return {
      running: true,
      job: id,
      runningForSeconds: Math.round((Date.now() - job.startedAt) / 1000),
      notice:
        "Still running. Call shell_job with this id to wait for the output. If the command printed a one-time code or sign-in URL the user needs, tell them now. Next time, split slow work into smaller batches.",
    }
  }

  // ── Scripts ─────────────────────────────────────────────────────────

  private scriptTools(): ToolSet {
    return {
      run_js: tool({
        description: [
          "Run JavaScript in a fresh sandbox and get its result. For data work, parsing, math, and many calls to the user's apps in a loop. Use exec for plain shell work.",
          "Runs survive restarts and deploys. An app call the user's rules ask about pauses the script until the user answers, which can take hours: run_js then says it is waiting, and the result comes back to you as a message.",
          this.#js.description.replaceAll("`command`", "`code`"),
        ].join("\n\n"),
        inputSchema: z.object({
          code: z.string().describe("ECMAScript module source"),
          purpose: z
            .string()
            .max(80)
            .describe(
              "What it does in a few words, shown to the user if it needs their OK, e.g. 'Close stale Linear issues'"
            ),
          input: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Passed to the default export"),
        }),
        execute: async ({ code, purpose, input }) => {
          const id = await this.startScript(code, purpose, input)
          return this.awaitScript(id)
        },
      }),
      script_wait: tool({
        description:
          "Wait for a script that run_js reported as still running or waiting. Waits up to 60 seconds per call and returns its result once it finishes.",
        inputSchema: z.object({
          run: z.string().describe("The run id run_js returned"),
        }),
        execute: async ({ run }) => {
          const row = this.sql<{ status: string }>`SELECT status
            FROM script_runs WHERE id = ${run}`[0]
          if (!row) return { error: "No such script." }
          if (row.status === "done") {
            return {
              error:
                "That script already finished and its result was given to you. Look for it in this chat.",
            }
          }
          this.sql`UPDATE script_runs SET status = 'running' WHERE id = ${run}`
          return this.awaitScript(run)
        },
      }),
    }
  }

  /**
   * `ws:apps` for scripts: the user's connected-app tools under the same
   * rules as when the bot calls them directly. One the rules ask about
   * pauses the script, durably, until the user answers (scriptWaiting).
   */
  private appsModule(): WorkspaceModuleFactory {
    const factory = () => ({
      list: async (): Promise<WorkspaceRuntimeValue> => {
        const { tools }: AppCatalog = await (await this.hub()).appCatalog()
        return tools.map((t) => ({
          name: appToolName(t.connectionId, t.name),
          app: t.connectionName,
          description: clip(t.description, 300),
          readOnly: t.readOnly,
        }))
      },
      // Reads are safe to repeat after an interruption; anything else is
      // not, so a restart while it is in flight fails the run instead of
      // possibly sending it twice.
      read: (
        args: readonly WorkspaceRuntimeValue[],
        ctx: WorkspaceModuleCallContext
      ) => this.scriptAppCall(args, ctx, "read"),
      call: unsafeToRepeat(
        (
          args: readonly WorkspaceRuntimeValue[],
          ctx: WorkspaceModuleCallContext
        ) => this.scriptAppCall(args, ctx, "call")
      ),
    })
    return Object.assign(factory, {
      description: [
        "- `ws:apps`: the user's connected apps (the same tools you have as tool_c… tools). `list()` returns `[{ name, app, description, readOnly }]`.",
        "  `read(name, args)` calls a readOnly tool; `call(name, args)` calls any tool. Both return the tool's result and throw if it fails, if the user's rules block it, or if the user rejects it.",
        "  A call the user's rules ask about pauses the script until they answer, so batch the work into one script rather than one per item.",
      ].join("\n"),
    })
  }

  private async scriptAppCall(
    args: readonly WorkspaceRuntimeValue[],
    ctx: WorkspaceModuleCallContext,
    mode: "read" | "call"
  ): Promise<WorkspaceRuntimeValue> {
    const [name, input = {}] = args
    if (typeof name !== "string") {
      throw new Error(
        "Pass a tool name from list(), then an object of arguments."
      )
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Arguments must be an object.")
    }
    const hub = await this.hub()
    const catalog: AppCatalog = await hub.appCatalog()
    const t = catalog.tools.find(
      (t) => appToolName(t.connectionId, t.name) === name
    )
    if (!t) {
      throw new Error(
        `No connected app has a tool named ${name}. Call list() to see them.`
      )
    }
    if (mode === "read" && !t.readOnly) {
      throw new Error(`${name} can change things, so use call() for it.`)
    }
    const policy = this.scriptAppPolicy(t.readOnly)
    if (policy === "block") {
      throw new Error(
        `The user's rules do not allow ${t.connectionName} here. Do not retry.`
      )
    }
    if (policy === "ask") {
      // Everything above runs again when the answer arrives, so it must
      // stay free of side effects.
      const answer = await ctx.interrupt<{
        approved?: boolean
        expired?: boolean
      }>({
        kind: "app",
        app: t.connectionName,
        tool: t.name,
        args: input,
      })
      if (!answer?.approved) {
        throw new Error(
          answer?.expired
            ? `Nobody approved ${t.connectionName} (${t.name}) within a day, so it was not done.`
            : `The user rejected ${t.connectionName} (${t.name}). It was not done.`
        )
      }
    }
    const result = unwrapToolResult(
      await hub.callAppTool(t.connectionId, t.name, input)
    )
    // Only plain JSON crosses back into the script.
    return JSON.parse(JSON.stringify(result ?? null)) as WorkspaceRuntimeValue
  }

  /** decide() for an app call from a script, which has no tool name of its own. */
  private scriptAppPolicy(readOnly: boolean): RulePolicy {
    const policy = this.state.rules.apps
    if (policy === "block" || !this.isBackgroundTurn()) return policy
    if (readOnly || this.state.proactive.appsInBackground === true)
      return "allow"
    return policy === "ask" ? "block" : "allow"
  }

  private async startScript(
    code: string,
    purpose: string,
    input?: Record<string, unknown>
  ) {
    const id = `js_${crypto.randomUUID().slice(0, 8)}`
    this
      .sql`INSERT INTO script_runs (id, purpose, started_at, status, background)
      VALUES (${id}, ${purpose}, ${Date.now()}, 'running', ${this.isBackgroundTurn() ? 1 : 0})`
    try {
      const run = await this.workspace.runtime.exec(code, {
        backend: "js",
        id,
        encoding: "utf8",
        timeoutMs: SCRIPT_TIMEOUT_MS,
        output: { maxBytes: 16 * 1024, maxLines: 400 },
        ...(input ? { input: input as WorkspaceRuntimeValue } : {}),
      })
      this.watchScript(id, run.result())
    } catch (err) {
      this
        .sql`UPDATE script_runs SET status = 'done', finished_at = ${Date.now()}
        WHERE id = ${id}`
      throw err
    }
    return id
  }

  /** Deliver a script's result whenever it settles, if no turn is waiting. */
  private watchScript(
    id: string,
    result: Promise<WorkspaceRuntimeResult<"utf8">>
  ) {
    this.#scripts.set(id, result)
    result
      .then(
        (r) => this.scriptSettled(id, r),
        (err: unknown) =>
          this.scriptSettled(id, {
            lost: err instanceof Error ? err.message : String(err),
          })
      )
      .catch((err) => console.error("Reporting a script failed", err))
      .finally(() => this.#scripts.delete(id))
  }

  /** A script's result, from this isolate or, after a restart, the runtime. */
  private scriptResult(id: string) {
    const known = this.#scripts.get(id)
    if (known) return known
    const result = this.workspace.runtime
      .getExec(id, { backend: "js", encoding: "utf8" })
      .then((run) => run.result())
    this.watchScript(id, result)
    return result
  }

  /**
   * Hold the tool call until the script finishes, pauses for approval, or
   * a minute passes. A pause hands it off: the result comes back as a
   * message, so the turn does not sit on an answer that may take hours.
   */
  private async awaitScript(id: string) {
    let approvals = (this.state.scriptApprovals ?? []).filter(
      (a) => a.runId === id
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    let wake = () => {}
    const outcome = approvals.length
      ? ("waiting" as const)
      : await Promise.race([
          this.scriptResult(id).then(
            (result) => ({ result }),
            (error: unknown) => ({ error })
          ),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), EXEC_WAIT_MS)
          }),
          new Promise<"waiting">((resolve) => {
            wake = () => resolve("waiting")
            const set = this.#scriptWaiters.get(id) ?? new Set()
            set.add(wake)
            this.#scriptWaiters.set(id, set)
          }),
        ])
    clearTimeout(timer)
    this.#scriptWaiters.get(id)?.delete(wake)
    if (outcome === "timeout") {
      return {
        running: true,
        run: id,
        notice:
          "Still running. Call script_wait with this id to wait for the result. Do not run it again.",
      }
    }
    if (outcome === "waiting") {
      this.sql`UPDATE script_runs SET status = 'detached'
        WHERE id = ${id} AND status = 'running'`
      if (!approvals.length) {
        approvals = (await this.syncScriptApprovals()).filter(
          (a) => a.runId === id
        )
      }
      return {
        waitingForApproval: true,
        run: id,
        waitingOn: approvals.map((a) => `${a.app}: ${a.tool}`),
        notice:
          "Paused until the user approves it in the app. Tell them what it is waiting on, then end your turn: the result comes back to you as a message when the script finishes. Do not run it again.",
      }
    }
    this.sql`UPDATE script_runs SET status = 'done', finished_at = ${Date.now()}
      WHERE id = ${id}`
    if ("error" in outcome) {
      return {
        run: id,
        error:
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error),
      }
    }
    const { result } = outcome
    return {
      run: id,
      exitCode: result.exitCode,
      ...(result.value !== undefined ? { result: result.value } : {}),
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.truncated ? { truncated: result.truncated } : {}),
    }
  }

  /** A detached script finished: hand its result to the bot as a message. */
  private async scriptSettled(
    id: string,
    result: WorkspaceRuntimeResult<"utf8"> | { lost: string }
  ) {
    const row = this.sql<{
      purpose: string
      status: string
      background: number
    }>`
      SELECT purpose, status, background FROM script_runs WHERE id = ${id}`[0]
    // "running": a turn collects it. "done": already delivered.
    if (row?.status !== "detached") return
    this.sql`UPDATE script_runs SET status = 'done', finished_at = ${Date.now()}
      WHERE id = ${id}`
    const outcome: ScriptOutcome =
      "lost" in result
        ? result
        : {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            value: result.value,
          }
    await this.submitAs(
      { kind: "script", name: clip(row.purpose, 60) },
      scriptPrompt({
        runId: id,
        purpose: row.purpose,
        outcome,
        background: row.background === 1,
      }),
      { background: row.background === 1, key: `script:${id}` }
    )
  }

  /** The turn ended: scripts it left running report back on their own. */
  private detachScripts() {
    const rows = this.sql<{ id: string }>`SELECT id FROM script_runs
      WHERE status = 'running'`
    if (!rows.length) return
    this
      .sql`UPDATE script_runs SET status = 'detached' WHERE status = 'running'`
    // One that already finished while a turn held it is delivered now.
    for (const { id } of rows) this.scriptResult(id).catch(() => undefined)
  }

  private openScripts() {
    return this.sql<{
      id: string
      started_at: number
      answered_at: number | null
    }>`
      SELECT id, started_at, answered_at FROM script_runs WHERE status = 'detached'`
  }

  /** One pending poll at most; the one firing now does not count. */
  private async ensureScriptPoll(delaySeconds = SCRIPT_POLL_S) {
    const now = Date.now() / 1000
    if (
      this.getSchedules().some(
        (s) => s.callback === "pollScripts" && s.time > now
      )
    ) {
      return
    }
    await this.schedule(delaySeconds, "pollScripts")
  }

  /**
   * Schedule callback. Resumes scripts a restart interrupted (replaying
   * them), watches the rest, and gives up on any that went silent. Scripts
   * only waiting on the user need no polling: answering them restarts it.
   */
  async pollScripts() {
    const rows = this.openScripts()
    // Bots that never ran a script do not wake the runtime.
    if (!rows.length && !this.state.scriptApprovals?.length) return
    const approvals = await this.syncScriptApprovals()
    if (!rows.length) return
    await this.workspace.runtime.recover()
    const waiting = new Set(approvals.map((a) => a.runId))
    const now = Date.now()
    let active = false
    for (const row of rows) {
      if (waiting.has(row.id)) continue
      const since = Math.max(row.started_at, row.answered_at ?? 0)
      if (now - since > SCRIPT_TIMEOUT_MS + SCRIPT_GRACE_MS) {
        await this.scriptSettled(row.id, { lost: "it stopped responding" })
        continue
      }
      active = true
      this.scriptResult(row.id).catch(() => undefined)
    }
    if (active) await this.ensureScriptPoll()
  }

  /** onWait: a script's app call is now paused for the user. */
  private async scriptWaiting(call: WorkspaceRuntimePendingCall) {
    for (const wake of this.#scriptWaiters.get(call.id) ?? []) wake()
    const approvals = await this.syncScriptApprovals()
    const approval = approvals.find((a) => a.callId === call.callId)
    // In a turn, the bot tells the user itself.
    if (approval && !this.#turnActive) {
      void this.notify(
        `Waiting for your OK: ${approval.app} (${approval.tool})`
      )
    }
  }

  /** Mirror the runtime's paused calls into state, for the UI. */
  private async syncScriptApprovals(): Promise<ScriptApproval[]> {
    const pending = await this.workspace.runtime.pending()
    const approvals = pending.flatMap((call) => {
      const p = call.payload as {
        kind?: string
        app?: string
        tool?: string
        args?: Record<string, unknown>
      } | null
      if (p?.kind !== "app") return []
      const row = this.sql<{ purpose: string }>`SELECT purpose FROM script_runs
        WHERE id = ${call.id}`[0]
      return [
        {
          runId: call.id,
          callId: call.callId,
          purpose: row?.purpose ?? "",
          app: String(p.app ?? ""),
          tool: String(p.tool ?? ""),
          argsJson: JSON.stringify(p.args ?? {}, null, 2),
          since: call.since,
        },
      ]
    })
    if (
      JSON.stringify(approvals) !==
      JSON.stringify(this.state.scriptApprovals ?? [])
    ) {
      const busy =
        this.state.status === "thinking" || this.state.status === "working"
      const status: BotStatus = busy
        ? this.state.status
        : approvals.length || this.hasPendingApproval()
          ? "action_needed"
          : "idle"
      this.setState({ ...this.state, scriptApprovals: approvals, status })
      void this.report({ status })
    }
    return approvals
  }

  /** Approval cards in the chat, or app calls from scripts. */
  private needsUser() {
    return (
      this.hasPendingApproval() || (this.state.scriptApprovals?.length ?? 0) > 0
    )
  }

  /** Answer a script's paused app call, from the thread or the sidebar. */
  @callable()
  async answerScriptApproval(runId: string, callId: string, approved: boolean) {
    try {
      await this.workspace.runtime.respond(
        runId,
        callId,
        { approved },
        { backend: "js" }
      )
    } catch (err) {
      await this.syncScriptApprovals()
      if ((err as { code?: string }).code === "ENOTWAITING") {
        throw new Error("That call is no longer waiting.")
      }
      throw err
    }
    this
      .sql`UPDATE script_runs SET answered_at = ${Date.now()} WHERE id = ${runId}`
    this.ctx.storage.kv.delete(`script_reminded:${callId}`)
    await this.syncScriptApprovals()
    // It resumes now; make sure its result is watched and reported.
    this.scriptResult(runId).catch(() => undefined)
    await this.ensureScriptPoll()
  }

  /** sweepStuck's part for scripts: remind, expire, and resume. */
  private async sweepScripts(now: number) {
    for (const a of this.state.scriptApprovals ?? []) {
      if (now - a.since > APPROVAL_EXPIRE_MS) {
        await this.workspace.runtime
          .respond(
            a.runId,
            a.callId,
            { approved: false, expired: true },
            { backend: "js" }
          )
          .catch(() => undefined)
        this.ctx.storage.kv.delete(`script_reminded:${a.callId}`)
        this.scriptResult(a.runId).catch(() => undefined)
        continue
      }
      if (
        now - a.since > APPROVAL_REMIND_MS &&
        this.ctx.storage.kv.get(`script_reminded:${a.callId}`) === undefined
      ) {
        this.ctx.storage.kv.put(`script_reminded:${a.callId}`, now)
        void this.notify(`Still waiting for your OK: ${a.app} (${a.tool})`)
      }
    }
    await this.pollScripts()
  }

  /** Keep long turns inside the context window (see shapeToolResults). */
  override beforeStep(ctx: PrepareStepContext): StepConfig | void {
    const messages = shapeToolResults(ctx.messages)
    // Think's StepConfig is an Omit over a union, which drops `messages`
    // from the type; the AI SDK accepts it (and carries it forward).
    if (messages) return { messages } as StepConfig
  }

  /**
   * A tool call cut off by an eviction or crash. Think records it as failed,
   * but for anything with side effects "failed" is a guess: the send or
   * write may have gone through. Say so, so the model checks before it
   * repeats the action.
   */
  protected override repairInterruptedToolPart(
    part: UIMessage["parts"][number]
  ): UIMessage["parts"][number] {
    const record = part as { type: string; toolName?: string }
    const name =
      record.type === "dynamic-tool"
        ? (record.toolName ?? "")
        : record.type.replace(/^tool-/, "")
    const safe = READ_ONLY_TOOLS.has(name) || this.#readOnlyAppTools.has(name)
    // A card the user moved past by sending a new message. Nothing ran.
    if ((part as { state?: string }).state === "approval-requested") {
      return {
        ...part,
        state: "output-error",
        errorText:
          name === "ask_user"
            ? "The user did not pick an option. They replied in the chat instead: their newest message is the answer."
            : "Not done: the user sent a new message instead of approving this. If it still matters, ask again.",
      } as UIMessage["parts"][number]
    }
    return {
      ...part,
      state: "output-error",
      errorText: safe
        ? "This call was interrupted before it returned. It only reads, so it is safe to run again."
        : "This call was interrupted before a result was recorded, so it may or may not have taken effect. Check the destination (the app, page, file or bot) before doing it again, and never repeat it blindly.",
    } as UIMessage["parts"][number]
  }

  override beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
    this.#lastActivity = Date.now()
    // Waiting on a job repeats the same call by design.
    const looping =
      ctx.toolName === "shell_job"
        ? null
        : this.#loopGuard.check(ctx.toolName, ctx.input)
    if (looping) return { action: "block", reason: looping }
    const readOnlySecretCall =
      ctx.toolName === "secret_request" &&
      ((ctx.input as { method?: string } | undefined)?.method ?? "GET") ===
        "GET"
    const ruled =
      ctx.toolName === "app_tool_call"
        ? String((ctx.input as { tool?: string } | undefined)?.tool ?? "")
        : ctx.toolName
    if (ctx.toolName === "app_tools_search") {
      // Searching the catalog touches nothing.
    } else if (!readOnlySecretCall && this.decide(ruled) === "block") {
      return {
        action: "block",
        reason:
          this.policyFor(ruled) === "block"
            ? "The user has blocked this kind of action for you. Tell them what you wanted to do instead of retrying."
            : "This is background work and this action needs the user's approval, which they cannot give right now. Do not retry. If it matters, tell them what you would do.",
      }
    }
    if (ctx.toolName !== "set_name" && ctx.toolName !== "set_context") {
      void this.setStatus("working")
    }
  }

  override afterToolCall(ctx: ToolCallResultContext) {
    this.#lastActivity = Date.now()
    if (ctx.toolName === "set_context" && ctx.success) {
      this.logMemory(
        "bot",
        this.session.getContextBlock("memory")?.content ?? ""
      )
    }
    const input = (ctx.input ?? {}) as Record<string, unknown>
    const summary = clip(
      String(
        input.command ??
          input.url ??
          input.path ??
          input.instructions ??
          input.objective ??
          input.to ??
          input.name ??
          input.code ??
          JSON.stringify(input)
      ).replace(/\s+/g, " "),
      200
    )
    const result = ctx.success ? ctx.output : ctx.error
    const detail = clip(
      typeof result === "string" ? result : JSON.stringify(result ?? null),
      4000
    )
    this.sql`INSERT INTO activity (at, tool, summary, detail, ok, duration_ms)
      VALUES (${Date.now()}, ${ctx.toolName}, ${summary}, ${detail},
              ${ctx.success ? 1 : 0}, ${Math.round(ctx.durationMs)})`
    this
      .sql`DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 500`
  }

  /** The user-role message that started the turn `message` answers. */
  private triggerOf(message: UIMessage): UIMessage | undefined {
    const messages = this.messages
    let index = messages.findIndex((m) => m.id === message.id)
    if (index === -1) index = messages.length
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i]
    }
    return undefined
  }

  override async onChatResponse(result: ChatResponseResult) {
    this.#turnActive = false
    const trigger = this.triggerOf(result.message)
    const background = metaOf(trigger).background === true
    const waiting = result.message.parts.some(
      (p) => "state" in p && p.state === "approval-requested"
    )
    const text = textOf(result.message)
    this.detachScripts()
    const status: BotStatus =
      waiting || this.state.scriptApprovals?.length ? "action_needed" : "idle"
    if (waiting) this.noteApprovalsAsked(result.message)
    const task = metaOf(trigger).task
    // An approval card keeps the turn open; the result goes back once the
    // continuation finishes.
    if (task && !waiting) await this.finishTask(task, result)
    const routineRun = metaOf(trigger).routine
    if (routineRun) {
      await this.finishRoutineRun(routineRun, result, {
        waiting,
        quiet: !text || isNoUpdate(finalText(result.message)),
      })
    }
    this.setState({
      ...this.state,
      status,
      ...(background ? { lastCheckIn: Date.now() } : {}),
    })

    // Nothing worth saying: drop the turn so it neither shows up nor
    // fills the context. Deleting re-parents anything that came after.
    if (
      background &&
      !waiting &&
      result.status === "completed" &&
      (!text || isNoUpdate(finalText(result.message)))
    ) {
      await this.report({ status })
      if (trigger) {
        await this.schedule(1, "pruneMessages", {
          ids: [trigger.id, result.message.id],
        })
      }
      return
    }

    await this.stampDuration(result.message)

    const final = background ? finalText(result.message) : ""
    const preview = clip(
      final
        ? textOf({ ...result.message, parts: [{ type: "text", text: final }] })
        : text,
      MAX_PREVIEW
    )
    await this.report({
      status,
      unread: true,
      ...(preview ? { preview } : {}),
    })
    if (background && !waiting && text) {
      this.sql`INSERT INTO proactive_log (at) VALUES (${Date.now()})`
      this.sql`DELETE FROM proactive_log WHERE at < ${Date.now() - 7 * DAY_MS}`
    }

    // Reach the user when they are probably not looking: anything the bot
    // found on its own, anything blocked on them, and long jobs finishing.
    const longTurn =
      this.#turnStartedAt > 0 && Date.now() - this.#turnStartedAt > LONG_TURN_MS
    if (waiting) {
      const question = result.message.parts.find(
        (p) => p.type === "tool-ask_user" && pendingApprovalId(p)
      ) as { input?: { question?: string } } | undefined
      await this.notify(
        question?.input?.question
          ? clip(question.input.question, 160)
          : preview
            ? `Needs your OK: ${preview}`
            : "Needs your OK to continue"
      )
    } else if ((background || longTurn) && preview) {
      await this.notify(preview)
    }
  }

  /**
   * Record how long the bot worked on a reply, for the thread's "Worked for"
   * header. Approval continuations add to the same message, so time spent
   * waiting on the user is not counted.
   */
  private async stampDuration(message: UIMessage) {
    if (this.#turnStartedAt <= 0) return
    const meta = metaOf(message)
    const updated: UIMessage = {
      ...message,
      metadata: {
        ...meta,
        durationMs: (meta.durationMs ?? 0) + (Date.now() - this.#turnStartedAt),
      } satisfies MessageMeta,
    }
    try {
      await this.updateMessageInHistory(updated)
      this.broadcast(
        JSON.stringify({
          type: CHAT_MESSAGE_TYPES.MESSAGE_UPDATED,
          message: updated,
        })
      )
    } catch (err) {
      console.error("Stamping turn duration failed", err)
    }
  }

  /** Schedule callback: remove a background turn that had nothing to say. */
  async pruneMessages(payload: { ids: string[] }) {
    await this.session.deleteMessages(payload.ids)
  }

  override onChatError(error: unknown) {
    this.#turnActive = false
    this.detachScripts()
    void this.setStatus("idle")
    return error
  }

  // ── Stuck work ──────────────────────────────────────────────────────

  /** Remember when each approval card first appeared, for reminders. */
  private noteApprovalsAsked(message: UIMessage) {
    for (const part of message.parts) {
      const id = pendingApprovalId(part)
      if (id && this.ctx.storage.kv.get(`approval_at:${id}`) === undefined) {
        this.ctx.storage.kv.put(`approval_at:${id}`, Date.now())
      }
    }
  }

  /**
   * Schedule callback, every 15 minutes. Nothing waits forever without the
   * user hearing about it, and the sidebar cannot stay on "Typing…" after
   * the work has stopped.
   */
  async sweepStuck() {
    const now = Date.now()
    const busy =
      this.state.status === "thinking" || this.state.status === "working"
    if (
      busy &&
      !this.#turnActive &&
      now - this.#lastActivity > STALE_STATUS_MS
    ) {
      this.setState({
        ...this.state,
        status: this.needsUser() ? "action_needed" : "idle",
      })
    }
    // The hub is only a cache of this; heal it on every sweep.
    void this.report({ status: this.state.status })

    for (const message of this.messages) {
      if (message.role !== "assistant") continue
      let changed = false
      const parts = message.parts.map((part) => {
        const id = pendingApprovalId(part)
        if (!id) return part
        const asked = this.ctx.storage.kv.get<number>(`approval_at:${id}`)
        if (asked === undefined) {
          this.ctx.storage.kv.put(`approval_at:${id}`, now)
          return part
        }
        if (now - asked > APPROVAL_EXPIRE_MS) {
          changed = true
          this.ctx.storage.kv.delete(`approval_at:${id}`)
          this.ctx.storage.kv.delete(`approval_reminded:${id}`)
          return expireApproval(part)
        }
        if (
          now - asked > APPROVAL_REMIND_MS &&
          this.ctx.storage.kv.get(`approval_reminded:${id}`) === undefined
        ) {
          this.ctx.storage.kv.put(`approval_reminded:${id}`, now)
          void this.notify(
            `Still waiting for your OK: ${clip(textOf(message) || this.state.name, 120)}`
          )
        }
        return part
      })
      if (!changed) continue
      const updated: UIMessage = { ...message, parts }
      try {
        await this.updateMessageInHistory(updated)
        this.broadcast(
          JSON.stringify({
            type: CHAT_MESSAGE_TYPES.MESSAGE_UPDATED,
            message: updated,
          })
        )
      } catch (err) {
        console.error("Expiring an approval failed", err)
      }
    }
    try {
      await this.sweepScripts(now)
    } catch (err) {
      console.error("Checking on scripts failed", err)
    }
    if (this.state.status === "action_needed" && !this.needsUser()) {
      await this.setStatus("idle")
    }
  }

  // ── Secrets ─────────────────────────────────────────────────────────

  private listSecretMeta(): SecretMeta[] {
    return this.sql<{
      name: string
      origin: string
      scheme: SecretScheme
      header: string
      purpose: string
      created_at: number
    }>`SELECT name, origin, scheme, header, purpose, created_at FROM bot_secrets
      WHERE value IS NOT NULL ORDER BY name`.map((r) => ({
      name: r.name,
      origin: r.origin,
      scheme: r.scheme,
      header: r.header,
      purpose: r.purpose,
      createdAt: r.created_at,
    }))
  }

  private async secretRequest(
    name: string,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined
  ) {
    const row = this.sql<{
      origin: string
      scheme: SecretScheme
      header: string
      purpose: string
      value: string | null
      created_at: number
    }>`
      SELECT origin, scheme, header, purpose, value, created_at FROM bot_secrets WHERE name = ${name}`[0]
    if (!row?.value) {
      return {
        error: `No saved credential named ${name}. Ask for it with request_secret.`,
      }
    }
    if (httpsOrigin(url) !== row.origin) {
      return {
        error: `${name} may only be sent to ${row.origin}. That URL is not on it.`,
      }
    }
    const meta: SecretMeta = {
      name,
      origin: row.origin,
      scheme: row.scheme,
      header: row.header,
      purpose: row.purpose,
      createdAt: row.created_at,
    }
    const [key, value] = authHeader(meta, row.value)
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      SECRET_REQUEST_TIMEOUT_MS
    )
    try {
      const response = await fetch(url, {
        method,
        headers: { ...headers, [key]: value },
        body: method === "GET" ? undefined : body,
        // A redirect could carry the credential to another origin.
        redirect: "manual",
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        return {
          status: response.status,
          error:
            "The service redirected. Redirects are not followed with a credential attached; use the final URL directly.",
        }
      }
      const text = redact(await response.text(), row.value)
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body:
          text.length > MAX_SECRET_RESPONSE_CHARS
            ? `${text.slice(0, MAX_SECRET_RESPONSE_CHARS)}\n[Truncated: ${text.length} characters in total.]`
            : text,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        error: redact(
          controller.signal.aborted
            ? "The request timed out after 30 seconds."
            : message,
          row.value
        ),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Called from the request_secret card over the user's own socket, before
   * the card is approved. The value never enters the chat.
   */
  @callable()
  async provideSecret(toolCallId: string, value: string) {
    const part = this.messages
      .flatMap((m) => m.parts)
      .find((p) => (p as { toolCallId?: string }).toolCallId === toolCallId) as
      | {
          type: string
          state?: string
          input?: {
            name?: string
            origin?: string
            scheme?: string
            header?: string
            purpose?: string
          }
        }
      | undefined
    if (
      !part ||
      part.type !== "tool-request_secret" ||
      part.state !== "approval-requested"
    ) {
      throw new Error("That request is no longer waiting for a credential.")
    }
    const input = part.input ?? {}
    const name = String(input.name ?? "")
    const origin = httpsOrigin(String(input.origin ?? ""))
    const scheme =
      (["bearer", "header", "basic"] as const).find(
        (s) => s === input.scheme
      ) ?? "bearer"
    if (!validSecretName(name) || !origin) {
      throw new Error(
        "The bot asked for this with an invalid name or a non-HTTPS origin, so it cannot be saved."
      )
    }
    const clean = value.trim()
    if (!clean) throw new Error("Enter a value.")
    this
      .sql`INSERT INTO bot_secrets (name, origin, scheme, header, purpose, value, created_at)
      VALUES (${name}, ${origin}, ${scheme}, ${String(input.header ?? "Authorization")}, ${String(input.purpose ?? "")}, ${clean}, ${Date.now()})
      ON CONFLICT(name) DO UPDATE SET origin = excluded.origin, scheme = excluded.scheme,
        header = excluded.header, purpose = excluded.purpose, value = excluded.value,
        created_at = excluded.created_at`
  }

  @callable()
  async getSecrets(): Promise<SecretMeta[]> {
    return this.listSecretMeta()
  }

  @callable()
  async deleteSecret(name: string) {
    this.sql`DELETE FROM bot_secrets WHERE name = ${name}`
  }

  /** Called by the ask_user card, just before it approves the call. */
  @callable()
  async answerChoice(toolCallId: string, option: string) {
    const part = this.messages
      .flatMap((m) => m.parts)
      .find((p) => (p as { toolCallId?: string }).toolCallId === toolCallId) as
      | { type: string; state?: string; input?: { options?: unknown } }
      | undefined
    if (part?.type !== "tool-ask_user" || part.state !== "approval-requested") {
      throw new Error("That question is no longer waiting for an answer.")
    }
    const options = Array.isArray(part.input?.options)
      ? part.input.options.map(String)
      : []
    if (!options.includes(option))
      throw new Error("That is not one of the options.")
    this.ctx.storage.kv.put(`choice:${toolCallId}`, option)
  }

  /** The newest reply's parts that wait on the user, for the sidebar. */
  waitingParts(): UIMessage | null {
    const message = this.messages.findLast((m) => m.role === "assistant")
    if (!message) return null
    const parts = message.parts.filter((p) => pendingApprovalId(p))
    return parts.length ? { ...message, parts } : null
  }

  /** Script app calls waiting on the user, for the sidebar. */
  waitingScripts(): ScriptApproval[] {
    return this.state.scriptApprovals ?? []
  }

  /**
   * Answer an approval card from outside the chat (the sidebar). Same path
   * Think takes for an approval resolved without a chat socket; the
   * continuation waits until every card in the reply is answered.
   */
  async answerApproval(approvalId: string, approved: boolean) {
    const part = this.messages
      .flatMap((m) => m.parts)
      .find((p) => pendingApprovalId(p) === approvalId) as
      { toolCallId?: string } | undefined
    if (!part?.toolCallId) throw new Error("That was already answered.")
    const { toolCallId } = part
    // Think keeps these private; they are its RPC approval path.
    const think = this as unknown as {
      _enqueueInteractionApply(apply: () => Promise<void>): Promise<unknown>
      _applyToolApproval(toolCallId: string, approved: boolean): Promise<void>
      _queueConnectionlessContinuation(): Promise<void>
    }
    await think._enqueueInteractionApply(() =>
      think._applyToolApproval(toolCallId, approved)
    )
    if (!this.hasPendingApproval()) {
      await think._queueConnectionlessContinuation()
    }
  }

  private hasPendingApproval() {
    return this.messages.some(
      (m) => m.role === "assistant" && m.parts.some((p) => pendingApprovalId(p))
    )
  }

  // ── Messages that do not come from the human ────────────────────────

  private async submitAs(
    origin: MessageOrigin,
    text: string,
    options: {
      background?: boolean
      key?: string
      hops?: number
      routine?: MessageMeta["routine"]
      task?: BotTask
      taskResult?: MessageMeta["taskResult"]
    } = {}
  ) {
    const metadata: MessageMeta = {
      origin,
      at: Date.now(),
      ...(options.background ? { background: true } : {}),
      ...(options.hops ? { hops: options.hops } : {}),
      ...(options.routine ? { routine: options.routine } : {}),
      ...(options.task ? { task: options.task } : {}),
      ...(options.taskResult ? { taskResult: options.taskResult } : {}),
    }
    await this.runTurn({
      mode: "submit",
      idempotencyKey: options.key,
      input: {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        metadata,
      },
    })
  }

  /** Durable Object RPC from the UserHub: another bot is talking to this one. */
  async receiveBotMessage(
    origin: MessageOrigin,
    text: string,
    delivery: { key?: string; hops?: number; files?: BotAttachment[] } = {}
  ): Promise<string[]> {
    const saved = await this.saveAttachments(origin.name, delivery)
    const listed = saved.length
      ? `\n\nAttached files, copied into your workspace:\n${saved.map((p) => `- ${p}`).join("\n")}`
      : ""
    await this.submitAs(
      origin,
      `[Message from the ${origin.name} bot]\n${text}${listed}`,
      { key: delivery.key, hops: delivery.hops }
    )
    return saved
  }

  /**
   * Durable Object RPC from the UserHub: work from another bot or a
   * pipeline. The hub writes the framing; when the turn ends, its final
   * reply goes back through `completeTask`.
   */
  async receiveTask(
    origin: MessageOrigin,
    text: string,
    delivery: {
      task: BotTask
      key?: string
      hops?: number
      background?: boolean
      files?: BotAttachment[]
    }
  ): Promise<string[]> {
    const saved = await this.saveAttachments(origin.name, delivery)
    const listed = saved.length
      ? `\n\nAttached files, copied into your workspace:\n${saved.map((p) => `- ${p}`).join("\n")}`
      : ""
    await this.submitAs(origin, `${text}${listed}`, {
      key: delivery.key,
      hops: delivery.hops,
      background: delivery.background,
      task: delivery.task,
    })
    return saved
  }

  /** Durable Object RPC from the UserHub: a bot finished a task this one handed out. */
  async receiveTaskResult(
    origin: MessageOrigin,
    taskId: string,
    outcome: TaskOutcome
  ) {
    const row = this.sql<DelegationRow>`SELECT * FROM delegations
      WHERE id = ${taskId}`[0]
    // A re-delivered result changes nothing.
    if (row && row.status !== "open") return
    this.sql`UPDATE delegations SET status = ${outcome.status},
      finished_at = ${Date.now()} WHERE id = ${taskId}`
    const saved = await this.saveAttachments(origin.name, {
      key: `result:${taskId}`,
      files: outcome.files,
    })
    const lines = [`[Result from the ${origin.name} bot]`]
    if (row) lines.push(`Your task: ${clip(row.task, TASK_ECHO_CHARS)}`)
    if (outcome.status !== "done") {
      lines.push(
        `It did not finish (${outcome.status}${outcome.error ? `: ${outcome.error}` : ""}).`
      )
    }
    lines.push(
      "",
      outcome.result.trim() || "(It ended without a written reply.)"
    )
    if (saved.length) {
      lines.push(
        "",
        "Files it sent back, copied into your workspace:",
        ...saved.map((p) => `- ${p}`)
      )
    }
    const open = this.openDelegations()
    lines.push(
      "",
      open.length
        ? `Still waiting on: ${open.map((d) => d.to_name).join(", ")}. Their results arrive as new messages; do not wait for them in this turn.`
        : "Every task you handed out is back."
    )
    await this.submitAs(origin, lines.join("\n"), {
      key: `task-result:${taskId}`,
      hops: row?.hops,
      background: row?.background === 1,
      taskResult: { taskId },
    })
  }

  /** Tasks this bot handed out that have not come back yet. */
  private openDelegations(): DelegationRow[] {
    return this.sql<DelegationRow>`SELECT * FROM delegations
      WHERE status = 'open' AND created_at > ${Date.now() - DELEGATION_STALE_MS}
      ORDER BY created_at ASC`
  }

  /** The task the current turn is working on, if another bot or a pipeline gave it. */
  private currentTask(): BotTask | undefined {
    return metaOf(this.messages.findLast((m) => m.role === "user")).task
  }

  /** Send a finished task's final reply back to whoever handed it out. */
  private async finishTask(task: BotTask, result: ChatResponseResult) {
    const doneKey = `task_done:${task.id}`
    // Recovery can deliver the hook twice; only the first one reports.
    if (this.ctx.storage.kv.get(doneKey) !== undefined) return
    this.ctx.storage.kv.put(doneKey, Date.now())
    const filesKey = `task_files:${task.id}`
    const paths = this.ctx.storage.kv.get<string[]>(filesKey) ?? []
    this.ctx.storage.kv.delete(filesKey)
    const attachments = paths.length
      ? await this.readAttachments(paths)
      : { files: [] }
    const outcome: TaskOutcome = {
      status:
        result.status === "completed"
          ? "done"
          : result.status === "aborted"
            ? "stopped"
            : "failed",
      result: isNoUpdate(finalText(result.message))
        ? ""
        : finalText(result.message) || textOf(result.message),
      ...(result.status === "error"
        ? { error: clip(result.error?.trim() || "The model call failed.", 300) }
        : "error" in attachments
          ? { error: `Files were not sent: ${attachments.error}` }
          : {}),
      ...("files" in attachments && attachments.files.length
        ? { files: attachments.files }
        : {}),
    }
    try {
      const hub = await this.hub()
      await hub.completeTask(this.botId, task, outcome)
    } catch (err) {
      console.error("Reporting a task result failed", err)
    }
  }

  /**
   * Read the sender's files for message_bot. All or nothing: a missing or
   * oversized file fails the send rather than delivering half of it.
   */
  private async readAttachments(
    paths: string[]
  ): Promise<{ files: BotAttachment[] } | { error: string }> {
    const files: BotAttachment[] = []
    let total = 0
    for (const raw of paths) {
      const path = raw.startsWith("/") ? raw : `${WORKSPACE_ROOT}/${raw}`
      if (
        !path.startsWith(`${WORKSPACE_ROOT}/`) ||
        path.split("/").includes("..")
      ) {
        return { error: `${raw} is not a file in your /workspace.` }
      }
      const stat = await this.workspace.fs.stat(path).catch(() => null)
      if (!stat?.isFile)
        return { error: `${raw} does not exist or is a folder.` }
      total += stat.size
      if (total > MAX_BOT_FILE_BYTES) {
        return {
          error: `Attachments are limited to ${MAX_BOT_FILE_BYTES / 1024 / 1024} MB in total. Send fewer or smaller files.`,
        }
      }
      const stream = await this.workspace.fs.readFile(path)
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      files.push({ name: path.slice(path.lastIndexOf("/") + 1), bytes })
    }
    return { files }
  }

  /** Save another bot's attachments under /workspace/inbox/bots/<sender>/. */
  private async saveAttachments(
    sender: string,
    delivery: { key?: string; files?: BotAttachment[] }
  ): Promise<string[]> {
    if (!delivery.files?.length) return []
    // Derived from the delivery key, so a re-delivered message rewrites the
    // same files instead of making copies.
    const digest = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(delivery.key ?? crypto.randomUUID())
    )
    const id = [...new Uint8Array(digest)]
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const folder = `inbox/bots/${slugify(sender, 40)}/${new Date().toISOString().slice(0, 10)}-${id}`
    const used = new Set<string>()
    const saved: string[] = []
    for (const file of delivery.files) {
      const dot = file.name.lastIndexOf(".")
      const stem = slugify(dot > 0 ? file.name.slice(0, dot) : file.name, 60)
      const ext =
        dot > 0
          ? file.name
              .slice(dot + 1)
              .replace(/[^a-zA-Z0-9]/g, "")
              .slice(0, 10)
          : ""
      let name = ext ? `${stem}.${ext}` : stem
      for (let n = 2; used.has(name); n++)
        name = ext ? `${stem}-${n}.${ext}` : `${stem}-${n}`
      used.add(name)
      saved.push(await this.saveFile(`${folder}/${name}`, file.bytes))
    }
    return saved
  }

  /** Schedule callback. */
  async runRoutine(payload: RoutinePayload) {
    if (payload.kind === "once") {
      this.setState({
        ...this.state,
        routines: this.state.routines.filter((r) => r.id !== payload.id),
      })
    }
    await this.startRoutineRun(payload, 1)
  }

  /** Schedule callback: the one retry after a run failed before doing anything. */
  async retryRoutine(payload: RoutinePayload) {
    // A recurring routine deleted since the failure stays deleted.
    if (
      payload.kind === "cron" &&
      !this.state.routines.some((r) => r.id === payload.id)
    ) {
      return
    }
    await this.startRoutineRun(payload, 2)
  }

  private async startRoutineRun(payload: RoutinePayload, attempt: number) {
    const now = Date.now()
    const busy = this.sql<{ id: string }>`SELECT id FROM routine_runs
      WHERE routine_id = ${payload.id} AND status = 'running'
        AND started_at > ${now - ROUTINE_OVERLAP_MS} LIMIT 1`
    const runId = crypto.randomUUID()
    if (busy.length) {
      // Two copies of one routine would report the same things twice.
      this
        .sql`INSERT INTO routine_runs (id, routine_id, name, started_at, finished_at, status, attempt, note)
        VALUES (${runId}, ${payload.id}, ${payload.name}, ${now}, ${now}, 'skipped', ${attempt},
                ${"The previous run was still going."})`
      this.trimRoutineRuns()
      return
    }
    let changeNote = ""
    if (payload.watch) {
      const check = await this.checkWatch(payload.id, payload.watch)
      if (check.status !== "changed") {
        // No model call: record why, and stop here.
        this
          .sql`INSERT INTO routine_runs (id, routine_id, name, started_at, finished_at, status, attempt, note)
          VALUES (${runId}, ${payload.id}, ${payload.name}, ${now}, ${Date.now()},
                  ${check.status === "failed" ? "failed" : "quiet"}, ${attempt}, ${check.note})`
        this.trimRoutineRuns()
        return
      }
      changeNote = check.note
    }
    this
      .sql`INSERT INTO routine_runs (id, routine_id, name, started_at, status, attempt)
      VALUES (${runId}, ${payload.id}, ${payload.name}, ${now}, 'running', ${attempt})`
    this.trimRoutineRuns()
    await this.submitAs(
      { kind: "routine", name: payload.name },
      routinePrompt({
        id: payload.id,
        name: payload.name,
        prompt: payload.prompt,
        onlyNew: payload.onlyNew === true,
        reported: payload.onlyNew ? this.reportedFor(payload.id) : [],
        timeZone: this.state.proactive.timezone,
      }) + changeNote,
      {
        background: true,
        // One submission per routine, attempt and minute: an alarm that
        // fires twice for the same slot does not start a second run.
        key: `routine:${payload.id}:${attempt}:${Math.floor(now / 60_000)}`,
        routine: { id: payload.id, runId, attempt },
      }
    )
  }

  /**
   * Fetch or run a routine's watch and compare it with last time. Costs no
   * model call, so a routine can check often and only wake the model when
   * something actually changed.
   */
  private async checkWatch(
    routineId: string,
    watch: RoutineWatch
  ): Promise<{
    status: "baseline" | "unchanged" | "changed" | "failed"
    note: string
  }> {
    let output: string
    try {
      output = await this.readWatch(watch)
    } catch (err) {
      return {
        status: "failed",
        note: `Watch check failed: ${clip(err instanceof Error ? err.message : String(err), 200)}`,
      }
    }
    const normalized = output.replace(/\s+/g, " ").trim()
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalized)
    )
    const fingerprint = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const previous = this.sql<{
      fingerprint: string
      sample: string
    }>`SELECT fingerprint, sample
      FROM routine_watch WHERE routine_id = ${routineId}`[0]
    this
      .sql`INSERT INTO routine_watch (routine_id, fingerprint, sample, checked_at)
      VALUES (${routineId}, ${fingerprint}, ${clip(output, WATCH_SAMPLE_CHARS)}, ${Date.now()})
      ON CONFLICT(routine_id) DO UPDATE SET fingerprint = excluded.fingerprint,
        sample = excluded.sample, checked_at = excluded.checked_at`
    if (!previous)
      return { status: "baseline", note: "First check: saved as the baseline." }
    if (previous.fingerprint === fingerprint)
      return { status: "unchanged", note: "No change since the last check." }
    const what = "url" in watch ? watch.url : `\`${watch.command}\``
    return {
      status: "changed",
      note: `\n\nThis run was started because ${what} changed since the last check.\nBefore:\n${previous.sample}\n\nNow:\n${clip(output, WATCH_SAMPLE_CHARS)}`,
    }
  }

  private async readWatch(watch: RoutineWatch): Promise<string> {
    if ("url" in watch) {
      const url = new URL(watch.url)
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Only http(s) URLs can be watched.")
      const response = await fetch(url, {
        headers: { "user-agent": "coworkers-watch/1" },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok)
        throw new Error(`${url.host} answered ${response.status}.`)
      const text = await response.text()
      // Pages carry noise (scripts, styles, tags); compare what a reader sees.
      return /html/i.test(response.headers.get("content-type") ?? "")
        ? text
            .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
        : text
    }
    const run = this.#shell.then(async () => {
      const handle = await this.workspace.runtime.exec(watch.command, {
        encoding: "utf8",
        cwd: "/workspace",
      })
      try {
        const { stdout, stderr, exitCode } = await handle.result()
        if (exitCode !== 0)
          throw new Error(`exit ${exitCode}: ${clip(stderr || stdout, 200)}`)
        return stdout
      } finally {
        handle[Symbol.dispose]()
      }
    })
    this.#shell = run.catch(() => undefined)
    return run
  }

  private trimRoutineRuns() {
    this.sql`DELETE FROM routine_runs WHERE id NOT IN
      (SELECT id FROM routine_runs ORDER BY started_at DESC LIMIT 300)`
  }

  /** When the next scheduled run of a routine is due, in Unix ms. */
  private nextRoutineRun(routineId: string): number | null {
    const next = this.getSchedules<RoutinePayload>().find(
      (s) => s.callback === "runRoutine" && s.payload.id === routineId
    )
    return next ? next.time * 1000 : null
  }

  /** Record how a routine run ended; retry or tell the user if it failed. */
  private async finishRoutineRun(
    run: NonNullable<MessageMeta["routine"]>,
    result: ChatResponseResult,
    outcome: { waiting: boolean; quiet: boolean }
  ) {
    const row = this.sql<{ name: string; status: string }>`SELECT name, status
      FROM routine_runs WHERE id = ${run.runId}`[0]
    // Recovery can deliver the hook twice; only the first one counts.
    if (!row || row.status !== "running") return
    const now = Date.now()
    if (result.status !== "error") {
      const status = outcome.waiting
        ? "waiting"
        : result.status === "aborted"
          ? "stopped"
          : outcome.quiet
            ? "quiet"
            : "reported"
      this.sql`UPDATE routine_runs SET status = ${status}, finished_at = ${now}
        WHERE id = ${run.runId}`
      return
    }

    const error = clip(result.error?.trim() || "The model call failed.", 300)
    const didWork = result.message.parts.some(
      (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
    )
    const next = this.nextRoutineRun(run.id)
    const nextIsSoon = next !== null && next - now < ROUTINE_RETRY_SKIP_MS
    // Retry only a run that failed before touching anything, so a retry can
    // never repeat a side effect.
    if (run.attempt === 1 && !didWork && !nextIsSoon) {
      const routine = this.state.routines.find((r) => r.id === run.id)
      const payload: RoutinePayload = routine
        ? {
            id: routine.id,
            name: routine.name,
            prompt: routine.prompt,
            kind: routine.kind,
            ...(routine.onlyNew ? { onlyNew: true } : {}),
            ...(routine.watch ? { watch: routine.watch } : {}),
          }
        : // A one-off routine is already gone from state; rebuild it from
          // the run so the retry still has its instructions.
          {
            id: run.id,
            name: row.name,
            prompt: this.routinePromptOf(run.runId),
            kind: "once",
          }
      if (payload.prompt) {
        await this.schedule(ROUTINE_RETRY_DELAY_S, "retryRoutine", payload)
        this
          .sql`UPDATE routine_runs SET status = 'retrying', finished_at = ${now},
          note = ${error} WHERE id = ${run.runId}`
        return
      }
    }

    this.sql`UPDATE routine_runs SET status = 'failed', finished_at = ${now},
      note = ${error} WHERE id = ${run.runId}`
    const when = next
      ? ` It runs again ${new Date(next).toLocaleString("en-GB", {
          timeZone: this.state.proactive.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })}.`
      : ""
    const notice = `Routine **${row.name}** failed: ${error}${when}`
    await this.addMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: notice }],
        metadata: {
          origin: { kind: "routine", name: row.name },
          at: now,
        } satisfies MessageMeta,
      },
    ])
    await this.report({
      status: "idle",
      unread: true,
      preview: clip(notice.replace(/\*\*/g, ""), MAX_PREVIEW),
    })
    await this.notify(`${row.name} failed: ${error}`)
  }

  /** The instructions a routine run was started with, from its trigger message. */
  private routinePromptOf(runId: string): string {
    const trigger = this.messages.find(
      (m) => m.role === "user" && metaOf(m).routine?.runId === runId
    )
    if (!trigger) return ""
    const text = textOf(trigger)
    // routinePrompt() puts the routine's own prompt after its header line.
    return text
      .split("\n")
      .slice(1)
      .join("\n")
      .split("\n\nRoutine id:")[0]
      .trim()
  }

  /** Recent runs, newest first, for the routine's history. */
  @callable()
  async getRoutineRuns(routineId?: string): Promise<RoutineRun[]> {
    const rows = routineId
      ? this
          .sql<RoutineRunRow>`SELECT * FROM routine_runs WHERE routine_id = ${routineId}
          ORDER BY started_at DESC LIMIT 50`
      : this
          .sql<RoutineRunRow>`SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT 50`
    return rows.map(toRoutineRun)
  }

  /** What earlier runs of this routine told the user (see routinePrompt). */
  private reportedFor(routineId: string): ReportedEntry[] {
    return this.sql<ReportedEntry>`SELECT key, note, at FROM reported
      WHERE key LIKE ${`routine:${routineId}:%`}
      ORDER BY at DESC LIMIT ${ROUTINE_REPORTED_IN_PROMPT}`
  }

  // ── Crawls ──────────────────────────────────────────────────────────

  private crawlConfigured() {
    return Boolean(
      this.env.BROWSER_RUN_ACCOUNT_ID?.trim() &&
      this.env.BROWSER_RUN_API_TOKEN?.trim()
    )
  }

  /** `/crawl` is REST-only, so it needs an account id and API token. */
  private crawlRequest(path: string, init: RequestInit = {}) {
    const account = this.env.BROWSER_RUN_ACCOUNT_ID.trim()
    return fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/crawl${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.env.BROWSER_RUN_API_TOKEN.trim()}`,
          "Content-Type": "application/json",
        },
      }
    )
  }

  private async startCrawl(input: CrawlInput) {
    const patterns = {
      ...(input.includePatterns?.length
        ? { includePatterns: input.includePatterns }
        : {}),
      ...(input.excludePatterns?.length
        ? { excludePatterns: input.excludePatterns }
        : {}),
    }
    const res = await this.crawlRequest("", {
      method: "POST",
      body: JSON.stringify({
        url: input.url,
        limit: input.limit ?? 25,
        ...(input.depth ? { depth: input.depth } : {}),
        formats: ["markdown"],
        render: input.render ?? false,
        // The bot reads and keeps what it crawls for the user. Declaring
        // that honestly lets sites that only refuse AI training through.
        crawlPurposes: ["ai-input"],
        contentUse: "reference",
        ...(Object.keys(patterns).length ? { options: patterns } : {}),
      }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean
      result?: string
      errors?: { message: string }[]
    }
    if (!res.ok || !body.success || !body.result) {
      throw new Error(
        body.errors?.[0]?.message ??
          `The crawl did not start (HTTP ${res.status})`
      )
    }
    const job: CrawlJob = {
      id: body.result,
      url: input.url,
      purpose: input.purpose,
      startedAt: Date.now(),
      polls: 0,
    }
    this.ctx.storage.kv.put(`crawl:${job.id}`, job)
    await this.schedule(CRAWL_FIRST_POLL_S, "pollCrawl", { id: job.id })
    return { jobId: job.id }
  }

  /** Schedule callback: check a crawl, and hand the result over when done. */
  async pollCrawl(payload: { id: string }) {
    const key = `crawl:${payload.id}`
    const job = this.ctx.storage.kv.get<CrawlJob>(key)
    if (!job) return
    let status = "running"
    try {
      const res = await this.crawlRequest(`/${job.id}?limit=1`)
      const body = (await res.json()) as { result?: { status?: string } }
      if (res.ok && body.result?.status) status = body.result.status
    } catch (err) {
      // A failed poll is retried on the next one.
      console.error("Crawl poll failed", err)
    }
    if (status === "running") {
      if (Date.now() - job.startedAt < CRAWL_MAX_WAIT_MS) {
        job.polls += 1
        this.ctx.storage.kv.put(key, job)
        const delay = Math.min(
          CRAWL_MAX_POLL_S,
          CRAWL_FIRST_POLL_S * 2 ** Math.min(job.polls, 4)
        )
        await this.schedule(delay, "pollCrawl", payload)
        return
      }
      status = "still running after 6 hours, so I stopped waiting"
    }
    this.ctx.storage.kv.delete(key)
    const saved = status === "completed" ? await this.saveCrawl(job) : undefined
    let host = job.url
    try {
      host = new URL(job.url).hostname
    } catch {
      // Keep the raw URL.
    }
    await this.submitAs(
      { kind: "crawl", name: host },
      crawlPrompt({ url: job.url, purpose: job.purpose, status, saved }),
      { background: true, key: `crawl:${job.id}` }
    )
  }

  /** Write every crawled page to its own Markdown file, plus an index. */
  private async saveCrawl(job: CrawlJob) {
    let host = "site"
    try {
      const u = new URL(job.url)
      host = `${u.hostname}${u.pathname}`
    } catch {
      // Keep "site".
    }
    const dir = `downloads/crawls/${fileStamp(job.startedAt)}-${slugify(host, 40)}`
    const index: string[] = []
    const skipped: Record<string, number> = {}
    let pages = 0
    let cursor: string | undefined
    for (let batch = 0; batch < MAX_CRAWL_PAGES / CRAWL_PAGE_SIZE; batch++) {
      const query = new URLSearchParams({ limit: String(CRAWL_PAGE_SIZE) })
      if (cursor) query.set("cursor", cursor)
      const res = await this.crawlRequest(`/${job.id}?${query}`)
      if (!res.ok) break
      const body = (await res.json()) as {
        result?: { records?: CrawlRecord[]; cursor?: string | number | null }
      }
      const records = body.result?.records ?? []
      for (const record of records) {
        if (record.status !== "completed" || !record.markdown) {
          skipped[record.status] = (skipped[record.status] ?? 0) + 1
          continue
        }
        pages += 1
        let path = record.url
        try {
          path = new URL(record.url).pathname
        } catch {
          // Keep the raw URL.
        }
        const title = record.metadata?.title?.trim() || record.url
        const file = `${String(pages).padStart(3, "0")}-${slugify(path, 50)}.md`
        await this.saveFile(
          `${dir}/${file}`,
          `---\nurl: ${record.url}\ntitle: ${JSON.stringify(title)}\n---\n\n${record.markdown}\n`
        )
        index.push(`- [${title.replace(/[[\]]/g, "")}](${file}) ${record.url}`)
      }
      const next = body.result?.cursor
      if (
        records.length < CRAWL_PAGE_SIZE ||
        next === undefined ||
        next === null ||
        String(next) === cursor
      ) {
        break
      }
      cursor = String(next)
    }
    const notes = Object.entries(skipped).map(([s, n]) => `${n} ${s}`)
    const indexPath = await this.saveFile(
      `${dir}/index.md`,
      [
        `# Crawl of ${job.url}`,
        "",
        `Purpose: ${job.purpose}`,
        `Pages saved: ${pages}${notes.length ? ` (not saved: ${notes.join(", ")})` : ""}`,
        "",
        ...index,
        "",
      ].join("\n")
    )
    return { pages, index: indexPath, skipped: notes }
  }

  /** Inbound mail to <user>.<bot>@EMAIL_DOMAIN, routed in `src/server.ts`. */
  async onEmail(email: AgentEmail) {
    const parsed = await PostalMime.parse(await email.getRaw())
    if (isAutoReplyEmail(parsed.headers)) return
    const from = parsed.from?.address ?? email.from
    const sender = parsed.from?.name ? `${parsed.from.name} <${from}>` : from
    const subject = parsed.subject?.trim() || "(no subject)"
    const body = (parsed.text ?? htmlToText(parsed.html ?? "")).trim()
    const stamp = fileStamp()
    const dir = `/workspace/inbox/email/${stamp}-${slugify(subject, 40)}`
    await this.workspace.fs.mkdir(dir, { recursive: true })
    const path = `${dir}/message.md`
    await this.workspace.fs.writeFile(
      path,
      `From: ${sender}\nTo: ${email.to}\nSubject: ${subject}\nDate: ${parsed.date ?? new Date().toISOString()}\n\n${body}\n`
    )
    const attachments: string[] = []
    for (const file of parsed.attachments.slice(0, 10)) {
      const name = (file.filename ?? "attachment").replace(/[^\w.\- ]+/g, "_")
      const content =
        typeof file.content === "string"
          ? file.content
          : new Uint8Array(file.content)
      await this.workspace.fs.writeFile(`${dir}/${name}`, content)
      attachments.push(`${dir}/${name}`)
    }
    await this.submitAs(
      { kind: "email", name: sender },
      emailPrompt({
        from: sender,
        subject,
        date: parsed.date,
        path,
        body: clip(body, MAX_INBOUND_CHARS),
        attachments,
      }),
      { background: true, key: parsed.messageId }
    )
  }

  /** Durable Object RPC from `/api/hooks/...`. False means a bad token. */
  async receiveWebhook(
    token: string,
    event: { source: string; contentType: string; body: string }
  ): Promise<boolean> {
    if (!timingSafeEqual(token, this.webhookToken())) return false
    const body = event.body.slice(0, MAX_WEBHOOK_BYTES)
    let pretty = body
    if (event.contentType.includes("json")) {
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2)
      } catch {
        // Not valid JSON after all: keep the raw text.
      }
    }
    const path = `/workspace/inbox/webhooks/${fileStamp()}-${slugify(event.source, 30)}.txt`
    await this.workspace.fs.mkdir("/workspace/inbox/webhooks", {
      recursive: true,
    })
    await this.workspace.fs.writeFile(path, pretty)
    await this.submitAs(
      { kind: "webhook", name: event.source },
      webhookPrompt({
        source: event.source,
        path,
        body: clip(pretty, MAX_INBOUND_CHARS),
      }),
      { background: true }
    )
    return true
  }

  /** Schedule callback. */
  async sweepBrowser() {
    await this.browser.connector.sweep()
    await this.browser.runtime.expirePaused()
  }

  private async rename(name: string) {
    this.setState({ ...this.state, name })
    await this.report({ name })
  }

  private async scheduleRoutine(routine: Routine) {
    const payload: RoutinePayload = {
      id: routine.id,
      name: routine.name,
      prompt: routine.prompt,
      kind: routine.kind,
      ...(routine.onlyNew ? { onlyNew: true } : {}),
      ...(routine.watch ? { watch: routine.watch } : {}),
    }
    const when = routine.kind === "cron" ? routine.when : new Date(routine.when)
    if (when instanceof Date && Number.isNaN(when.getTime())) {
      throw new Error(`Invalid date: ${routine.when}`)
    }
    await this.schedule(when, "runRoutine", payload)
  }

  private async cancelRoutineSchedule(id: string) {
    const matches = this.getSchedules<RoutinePayload>().filter(
      (s) =>
        (s.callback === "runRoutine" || s.callback === "retryRoutine") &&
        s.payload.id === id
    )
    for (const match of matches) await this.cancelSchedule(match.id)
  }

  private async addRoutine(input: Omit<Routine, "id">): Promise<Routine> {
    const routine: Routine = { id: crypto.randomUUID().slice(0, 8), ...input }
    await this.scheduleRoutine(routine)
    this.setState({
      ...this.state,
      routines: [...this.state.routines, routine],
    })
    return routine
  }

  private async updateRoutine(
    id: string,
    patch: Partial<Omit<Routine, "id" | "watch">> & {
      watch?: Routine["watch"] | null
    }
  ): Promise<Routine | null> {
    const current = this.state.routines.find((r) => r.id === id)
    if (!current) return null
    const next: Routine = { ...current }
    if (patch.name?.trim()) next.name = patch.name.trim()
    if (patch.prompt?.trim()) next.prompt = patch.prompt.trim()
    if (patch.when && patch.kind) {
      next.when = patch.when
      next.kind = patch.kind
    }
    if (patch.onlyNew !== undefined) {
      if (patch.onlyNew) next.onlyNew = true
      else delete next.onlyNew
    }
    if (patch.watch !== undefined) {
      if (patch.watch) next.watch = patch.watch
      else delete next.watch
      // A new watch starts from a fresh baseline.
      this.sql`DELETE FROM routine_watch WHERE routine_id = ${id}`
    }
    const stale = this.getSchedules<RoutinePayload>()
      .filter((s) => s.callback === "runRoutine" && s.payload.id === id)
      .map((s) => s.id)
    // Schedule (and so validate) the new one before dropping the old.
    await this.scheduleRoutine(next)
    for (const scheduleId of stale) await this.cancelSchedule(scheduleId)
    this.setState({
      ...this.state,
      routines: this.state.routines.map((r) => (r.id === id ? next : r)),
    })
    return next
  }

  private async removeRoutine(id: string) {
    await this.cancelRoutineSchedule(id)
    this.sql`DELETE FROM routine_watch WHERE routine_id = ${id}`
    const had = this.state.routines.some((r) => r.id === id)
    this.setState({
      ...this.state,
      routines: this.state.routines.filter((r) => r.id !== id),
    })
    return had
  }

  /** Durable Object RPC: state and history for the first server render. */
  async snapshot(): Promise<{ state: BotState; messages: UIMessage[] }> {
    return { state: this.state, messages: this.messages }
  }

  // ── Browser-facing (settings and the Computer panel) ────────────────

  @callable()
  async updateSettings(input: {
    name?: string
    role?: string
    rules?: Partial<Record<ActionClass, RulePolicy>>
    /** Null goes back to the account's model. */
    model?: string | null
  }) {
    const name = input.name?.trim()
    const model = input.model?.trim() || null
    if (model && !isModelId(model)) {
      throw new Error(`"${model}" is not a model id.`)
    }
    this.setState({
      ...this.state,
      ...(input.model !== undefined ? { model } : {}),
      ...(name ? { name } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() } : {}),
      ...(input.rules
        ? { rules: { ...this.state.rules, ...input.rules } }
        : {}),
    })
    if (name) await this.report({ name })
  }

  @callable()
  async deleteRoutine(id: string) {
    return this.removeRoutine(id)
  }

  @callable()
  async updateProactive(patch: Partial<ProactiveSettings>) {
    const next: ProactiveSettings = { ...this.state.proactive }
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled
    if (patch.appsInBackground !== undefined) {
      next.appsInBackground = !!patch.appsInBackground
    }
    if (patch.everyHours !== undefined) {
      next.everyHours = Math.min(24, Math.max(1, Math.round(patch.everyHours)))
    }
    for (const key of ["quietStart", "quietEnd"] as const) {
      const value = patch[key]
      if (value !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        next[key] = value
      }
    }
    if (patch.maxPerDay !== undefined) {
      next.maxPerDay = Math.min(50, Math.max(1, Math.round(patch.maxPerDay)))
    }
    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: patch.timezone })
        next.timezone = patch.timezone
      } catch {
        throw new Error(`Unknown time zone: ${patch.timezone}`)
      }
    }
    this.setState({ ...this.state, proactive: next })
    await this.internal_reconcileScheduledTasks()
  }

  /** The browser reports its zone so quiet hours mean the user's night. */
  @callable()
  async setTimezone(timezone: string) {
    if (timezone && timezone !== this.state.proactive.timezone) {
      await this.updateProactive({ timezone })
    }
  }

  /** Run a check-in now, ignoring quiet hours and the daily cap. */
  @callable()
  async checkInNow() {
    await this.checkIn({ force: true })
  }

  @callable()
  async listOpenItems(): Promise<OpenItem[]> {
    return this.sql<OpenItemRow>`SELECT * FROM open_items
      ORDER BY status = 'resolved', updated_at DESC LIMIT 100`.map(toOpenItem)
  }

  /** The user dismisses an item the bot is tracking. */
  @callable()
  async dismissOpenItem(id: string) {
    this.sql`UPDATE open_items SET status = 'resolved',
      note = 'Dismissed by the user', updated_at = ${Date.now()}
      WHERE id = ${id}`
  }

  @callable()
  async getInbound(): Promise<BotInbound> {
    return this.inbound()
  }

  @callable()
  async rotateWebhookToken(): Promise<BotInbound> {
    this.ctx.storage.kv.delete("webhook_token")
    return this.inbound()
  }

  @callable()
  async deleteSkill(slug: string) {
    const skill = this.state.skills.find((s) => s.slug === slug)
    if (!skill) return
    try {
      await this.workspace.fs.rm(`/workspace/skills/${slug}.md`)
    } catch {
      // Already gone from the computer.
    }
    this.setState({
      ...this.state,
      skills: this.state.skills.filter((s) => s.slug !== slug),
    })
  }

  @callable()
  async getApps(): Promise<BotAppDetail[]> {
    return this.appDetails()
  }

  @callable()
  async createAppLink(
    slug: string,
    label: string,
    mode: AppLink["mode"]
  ): Promise<AppLink> {
    if (!this.apps.get(slug)) throw new Error(`No app "${slug}"`)
    const name = label.trim().slice(0, 40) || "Shared link"
    return this.apps.createLink(slug, name, mode === "view" ? "view" : "edit")
  }

  @callable()
  async revokeAppLink(token: string) {
    const revoked = this.apps.revokeLink(token)
    if (revoked) {
      try {
        await this.appLive(revoked.slug).disconnect(token)
      } catch (err) {
        console.error("Closing app viewers failed", err)
      }
    }
  }

  @callable()
  async deleteApp(slug: string) {
    await this.removeApp(slug)
  }

  @callable()
  async getMemory(): Promise<string> {
    return this.session.getContextBlock("memory")?.content ?? ""
  }

  @callable()
  async setMemory(content: string) {
    if (content.length > MAX_MEMORY_CHARS) {
      throw new Error(`Memory is limited to ${MAX_MEMORY_CHARS} characters.`)
    }
    await this.session.replaceContextBlock("memory", content)
    this.logMemory("user", content)
  }

  @callable()
  async getMemoryRevisions() {
    return this.sql<{
      id: number
      at: number
      source: string
    }>`SELECT id, at, source
      FROM memory_revisions ORDER BY id DESC LIMIT 20`
  }

  @callable()
  async restoreMemory(revisionId: number) {
    const row = this.sql<{
      content: string
    }>`SELECT content FROM memory_revisions WHERE id = ${revisionId}`[0]
    if (!row) return
    await this.session.replaceContextBlock("memory", row.content)
    this.logMemory("restored", row.content)
  }

  private logMemory(source: string, content: string) {
    const last = this.sql<{
      content: string
    }>`SELECT content FROM memory_revisions ORDER BY id DESC LIMIT 1`[0]
    if (last?.content === content) return
    this
      .sql`INSERT INTO memory_revisions (at, source, content) VALUES (${Date.now()}, ${source}, ${content})`
    this
      .sql`DELETE FROM memory_revisions WHERE id <= (SELECT MAX(id) FROM memory_revisions) - 50`
  }

  /** Live View URLs for the bot's browser tabs. Valid for about 5 minutes. */
  @callable()
  async getLiveView(): Promise<
    { targetId: string; url: string; pageUrl?: string; title?: string }[]
  > {
    const view = await this.browser.connector.liveView({ mode: "tab" })
    if (!view) return []
    const pages = view.targets.filter(
      (t) => t.type === undefined || t.type === "page"
    )
    // Every session starts with a blank tab the bot never uses. Show it only
    // when nothing else is open, and put the bot's own tab first.
    const real = pages.filter((t) => t.pageUrl && t.pageUrl !== "about:blank")
    const active = this.ctx.storage.kv.get<string>("browser_tab")
    return (real.length ? real : pages.slice(0, 1))
      .sort(
        (a, b) => Number(b.targetId === active) - Number(a.targetId === active)
      )
      .map((t) => ({
        targetId: t.targetId,
        url: t.url,
        pageUrl: t.pageUrl,
        // The target listing HTML-escapes titles ("&quot;desk&quot;").
        title: t.title && unescapeHtml(t.title),
      }))
  }

  /** The page a browser_execute step ended on, with a JPEG of it. */
  @callable()
  async getBrowserFrame(toolCallId: string): Promise<BrowserFrame | null> {
    const [row] = this.sql<{
      url: string
      title: string
      image: string
      at: number
    }>`SELECT url, title, image, at FROM browser_frames
       WHERE tool_call_id = ${toolCallId}`
    return row
      ? {
          url: row.url,
          title: row.title,
          at: row.at,
          mediaType: "image/jpeg",
          base64: row.image,
        }
      : null
  }

  /** The back, forward and reload buttons on the user's browser chrome. */
  @callable()
  async navigateBrowser(action: BrowserNav): Promise<boolean> {
    if (!["back", "forward", "reload"].includes(action)) return false
    const run = await this.browser.runtime.execute({
      code: navCode(action, this.ctx.storage.kv.get<string>("browser_tab")),
    })
    void this.browser.runtime.deleteExecution(run.executionId).catch(() => {})
    return (
      run.status === "completed" &&
      (run.result as { moved?: boolean } | null)?.moved === true
    )
  }

  @callable()
  async closeBrowser() {
    await this.browser.connector.closeSession()
    this.ctx.storage.kv.delete("browser_tab")
    this.ctx.storage.kv.delete("browser_tabs")
  }

  /**
   * Save the page the bot's tab is on after a browser step. Best effort and
   * bounded: a missing frame only means the card shows no picture.
   */
  private async captureFrame(toolCallId: string) {
    const seen = this.ctx.storage.kv.get<SeenTab[]>("browser_tabs") ?? []
    const last = this.ctx.storage.kv.get<string>("browser_tab")
    try {
      const run = await Promise.race([
        this.browser.runtime.execute({ code: frameCode(seen, last) }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), FRAME_TIMEOUT_MS)
        ),
      ])
      if (!run) return
      void this.browser.runtime.deleteExecution(run.executionId).catch(() => {})
      if (run.status !== "completed" || !run.result) return
      const frame = run.result as FrameResult
      this.ctx.storage.kv.put("browser_tab", frame.targetId)
      this.ctx.storage.kv.put("browser_tabs", frame.tabs)
      this.sql`INSERT OR REPLACE INTO browser_frames
        (tool_call_id, at, url, title, image)
        VALUES (${toolCallId}, ${Date.now()}, ${frame.url}, ${frame.title},
                ${frame.data})`
      this.sql`DELETE FROM browser_frames WHERE tool_call_id NOT IN
        (SELECT tool_call_id FROM browser_frames ORDER BY at DESC
         LIMIT ${MAX_BROWSER_FRAMES})`
    } catch (err) {
      console.warn("captureFrame failed", err)
    }
  }

  /**
   * Every path under /workspace, relative to it, for the Files pane.
   * Directories end with "/" so empty ones still show up in the tree.
   */
  @callable()
  async listWorkspace(): Promise<string[]> {
    const entries = await this.workspace.fs.find(WORKSPACE_ROOT, "**", {
      limit: MAX_TREE_ENTRIES,
    })
    const prefix = `${WORKSPACE_ROOT}/`
    return entries
      .map((entry) => {
        const relative = entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path.replace(/^\/+/, "")
        return entry.type === "dir" ? `${relative}/` : relative
      })
      .filter((path) => path !== "" && path !== "/")
  }

  /** An image or PDF from the workspace, for previews in the thread and Files pane. */
  @callable()
  async readFileData(
    path: string
  ): Promise<{ mediaType: string; base64: string }> {
    const normalized = `/${path.replace(/^\/+/, "")}`
    if (
      !normalized.startsWith(`${WORKSPACE_ROOT}/`) ||
      normalized.split("/").includes("..")
    ) {
      throw new Error("Not a workspace file")
    }
    const ext = normalized.slice(normalized.lastIndexOf(".") + 1).toLowerCase()
    const mediaType = MIME_TYPES[ext]
    if (!mediaType || !/^(image\/|application\/pdf)/.test(mediaType)) {
      throw new Error("Only images and PDFs can be previewed")
    }
    const stat = await this.workspace.fs.stat(normalized)
    if (stat.size > MAX_FILE_DATA_BYTES) throw new Error("File is too large")
    const stream = await this.workspace.fs.readFile(normalized)
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return { mediaType, base64: btoa(binary) }
  }

  @callable()
  async readFileText(
    path: string
  ): Promise<{ content: string; truncated: boolean }> {
    const content = await this.workspace.fs.readFile(path, "utf8")
    return {
      content: content.slice(0, MAX_FILE_PREVIEW_BYTES),
      truncated: content.length > MAX_FILE_PREVIEW_BYTES,
    }
  }

  /** Save a file the user attached into the bot's inbox. */
  @callable()
  async uploadFile(name: string, base64: string): Promise<{ path: string }> {
    const safe = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file"
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error("Attachments are limited to 5 MB")
    }
    const path = `/workspace/inbox/${safe}`
    await this.workspace.fs.mkdir("/workspace/inbox", { recursive: true })
    await this.workspace.fs.writeFile(path, bytes)
    return { path }
  }

  /** Run a command in the bot's shell from the Terminal pane. */
  @callable()
  async runCommand(command: string) {
    const started = Date.now()
    const run = await this.workspace.runtime.exec(command, {
      encoding: "utf8",
      cwd: "/workspace",
    })
    let result: Awaited<ReturnType<typeof run.result>>
    try {
      result = await run.result()
    } finally {
      // Exec handles hold an RPC stub that is not garbage-collected.
      run[Symbol.dispose]()
    }
    const { stdout, stderr, exitCode } = result
    const output = [stdout, stderr].filter(Boolean).join("\n")
    this.sql`INSERT INTO activity (at, tool, summary, detail, ok, duration_ms)
      VALUES (${started}, ${"terminal"}, ${clip(command, 200)},
              ${clip(output, 4000)}, ${exitCode === 0 ? 1 : 0},
              ${Date.now() - started})`
    return { stdout, stderr, exitCode }
  }

  @callable()
  async getActivity(
    limit = 100
  ): Promise<(ActivityEntry & { detail: string })[]> {
    const rows = this.sql<{
      id: number
      at: number
      tool: string
      summary: string
      detail: string | null
      ok: number
      duration_ms: number
    }>`SELECT * FROM activity ORDER BY id DESC LIMIT ${limit}`
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      tool: r.tool,
      summary: r.summary,
      detail: r.detail ?? "",
      ok: r.ok === 1,
      durationMs: r.duration_ms,
    }))
  }
}
