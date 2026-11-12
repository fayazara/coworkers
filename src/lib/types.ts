/**
 * Types shared by the Durable Objects and the React client. Keep this file
 * free of server-only imports (`cloudflare:workers`, agent classes).
 */

import type { RobotHeadShape } from "robot-heads"
import type { DeploymentModels, ModelSettings } from "./models"
import type { ShopPick } from "./shop"

export type BotStatus = "idle" | "thinking" | "working" | "action_needed"

/**
 * `robot-heads` looks (a head shape and a shell colour), in the order new bots
 * receive them. Listed here (rather than imported) so the Durable Objects do
 * not bundle the canvas renderer.
 */
export const BOT_AVATAR_LOOKS = {
  "blue-rectangle": { shape: "rectangle", color: "#2b49a3" },
  "coral-circle": { shape: "circle", color: "#e0563f" },
  "green-hexagon": { shape: "hexagon", color: "#2f8f5b" },
  "violet-square": { shape: "square", color: "#6b46c1" },
  "amber-rectangle": { shape: "rectangle", color: "#d98a1c" },
  "teal-circle": { shape: "circle", color: "#1f8a99" },
  "pink-hexagon": { shape: "hexagon", color: "#d6457f" },
  "graphite-square": { shape: "square", color: "#3d4452" },
  "red-rectangle": { shape: "rectangle", color: "#b8323a" },
  "indigo-circle": { shape: "circle", color: "#3f3fb0" },
  "lime-hexagon": { shape: "hexagon", color: "#6e9a1f" },
  "sky-square": { shape: "square", color: "#2f86d6" },
} as const satisfies Record<string, { shape: RobotHeadShape; color: string }>

export type BotAvatarKind = keyof typeof BOT_AVATAR_LOOKS
export const BOT_AVATARS = Object.keys(BOT_AVATAR_LOOKS) as BotAvatarKind[]

/** One row of the sidebar. Owned by the UserHub, updated by each bot. */
export interface BotSummary {
  id: string
  name: string
  avatar: BotAvatarKind
  status: BotStatus
  /** Last message preview shown under the name. */
  preview: string
  updatedAt: number
  unread: boolean
  /** What the bot is for. Reported by the bot; absent until it first does. */
  role?: string
  /** Paused bots skip routines, check-ins, email, webhooks and bot messages. */
  paused?: boolean
  /** Absent means "act". */
  access?: AccessLevel
}

/** A bot owned by somebody else; never add these to the personal hub's bots. */
export interface SharedBotSummary {
  ownerId: string
  botId: string
  summary: BotSummary
}

/**
 * What a caller may do through the shared operations (`src/control/`):
 * read, act (message, delegate, answer), or manage bots and settings.
 */
export type AccessLevel = "read" | "act" | "manage"

/**
 * A user-level MCP connection (Executor or any MCP server). The UserHub holds
 * the one live connection and its credentials; every bot uses it.
 */
export interface Connection {
  id: string
  name: string
  url: string
  /** Header values stay on the server; the client only learns the names. */
  headerNames: string[]
  /** MCP client state: "ready", "authenticating", "connecting", "failed", … */
  status: string
  tools: number
  /** Present while the server is waiting for the user to sign in. */
  authUrl?: string
  error?: string
  /** The last tool call through this connection that failed, if the latest did. */
  lastFailure?: {
    at: number
    message: string
    kind: "auth" | "unreachable" | "tool"
  }
}

/** A connection's tool, as its detail page lists it. */
export interface ConnectionTool {
  name: string
  description: string
  readOnly: boolean
}

/** A tool from a connection, as the UserHub describes it to bots. */
export interface AppTool {
  connectionId: string
  connectionName: string
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>
  /** From the server's `readOnlyHint`, or guessed from the tool name. */
  readOnly: boolean
}

export interface AppCatalog {
  apps: Pick<Connection, "id" | "name" | "status" | "tools" | "error">[]
  tools: AppTool[]
}

export interface HubState {
  bots: BotSummary[]
  connections: Connection[]
  /** Account-wide model choice. Absent on hubs created before models were configurable. */
  models?: ModelSettings
  /** Absent on hubs created before pipelines existed. */
  pipelines?: Pipeline[]
  /** Recent runs of every pipeline, newest first. Outputs are clipped. */
  pipelineRuns?: PipelineRun[]
  /** The deployment's own models and gateway, refreshed on every start. */
  deployment?: DeploymentModels
  /**
   * Model spend per bot, from AI Gateway logs. Null when the deployment has
   * no AI_GATEWAY_API_TOKEN, so there is nothing to read it with.
   */
  spend?: SpendSummary | null
  /** Open cards on the Desk, newest first. Absent on hubs created before it. */
  desk?: DeskCard[]
  /** Last time the user looked at the Desk, for "while you were away". */
  deskSeenAt?: number
  /** Skills the user installed. Absent on hubs created before them. */
  installedSkills?: InstalledSkill[]
}

/**
 * The Desk's three lanes: things waiting on the user, things a bot found on
 * its own, and work that finished while they were away.
 */
export type DeskLane = "needs_you" | "fyi" | "done"

/** What started the work behind a card, for its icon and "why" line. */
export type DeskOrigin = MessageOrigin["kind"] | "chat"

export interface DeskAction {
  id: string
  label: string
  kind: "approve" | "approve_all" | "reject" | "open_chat"
}

/** A card as a bot sends it. The hub adds the status. */
export interface DeskCardInput {
  /** Stable per bot, e.g. `approval:<id>`, so a card is never posted twice. */
  key: string
  lane: DeskLane
  origin: DeskOrigin
  /** One line: what this is. */
  title: string
  /** Why it is here now: what the bot was doing, or what started it. */
  why: string
  /** What the bot found or did, as short Markdown. */
  found: string
  /** Arguments of a call waiting for approval, as pretty-printed JSON. */
  detail?: string
  /** The tool that call is for, so its arguments can be shown plainly. */
  tool?: string
  sources: { label: string; url: string }[]
  /** The first is the primary button. */
  actions: DeskAction[]
  refs: {
    messageId?: string
    approvalId?: string
    script?: { runId: string; callId: string }
  }
  createdAt: number
}

export interface DeskCard extends DeskCardInput {
  /** `<botId>:<key>`. */
  id: string
  botId: string
  status: "open" | "acted" | "dismissed" | "snoozed"
  snoozeUntil?: number
}

export interface SpendTotals {
  /** US dollars, as AI Gateway priced the calls. */
  cost: number
  tokensIn: number
  tokensOut: number
  requests: number
}

/** Days are UTC: AI Gateway logs carry UTC times. */
export interface SpendSummary {
  /** Unix ms of the last successful read of the logs. */
  syncedAt: number | null
  /** Why the last read failed, if it did. */
  error?: string
  /** "YYYY-MM", UTC. */
  month: string
  total: { today: number; month: number }
  /** This month, most expensive first. */
  bots: {
    botId: string
    today: SpendTotals
    month: SpendTotals
    /** Of this month's cost, what check-ins, routines and email cost. */
    background: number
  }[]
  /** Every bot together, one entry per UTC day, the last 30. */
  days: { day: string; cost: number }[]
}

export type RulePolicy = "allow" | "ask" | "block"

/** Action classes a rule applies to. Each maps to one or more tools. */
export const ACTION_CLASSES = [
  { id: "files", label: "Edit files", hint: "Write, edit and delete files" },
  { id: "shell", label: "Run commands", hint: "Shell in the bot's computer" },
  { id: "browse", label: "Read the web", hint: "Open and read public pages" },
  {
    id: "browser",
    label: "Drive the browser",
    hint: "Click, type and submit in a real browser",
  },
  {
    id: "apps",
    label: "Use connected apps",
    hint: "Call tools on your connections",
  },
  {
    id: "bots",
    label: "Message other bots",
    hint: "Delegate to or notify another bot",
  },
  {
    id: "routines",
    label: "Schedule routines",
    hint: "Create work that runs later",
  },
  {
    id: "manage",
    label: "Manage bots",
    hint: "Create, change and pause your other bots",
  },
  {
    id: "email",
    label: "Send email",
    hint: "Reply to email and write to anyone, from the bot's own address",
  },
  {
    id: "shop",
    label: "Shop",
    hint: "Find products in online stores and set up checkouts you pay for",
  },
] as const
export type ActionClass = (typeof ACTION_CLASSES)[number]["id"]

export const DEFAULT_RULES: Record<ActionClass, RulePolicy> = {
  files: "allow",
  shell: "allow",
  browse: "allow",
  browser: "allow",
  apps: "ask",
  bots: "allow",
  routines: "allow",
  manage: "ask",
  email: "ask",
  shop: "allow",
}

export interface Routine {
  id: string
  name: string
  prompt: string
  /** Cron expression, or an ISO date for a one-off. */
  when: string
  kind: "cron" | "once"
  /** Only report what earlier runs did not, and stay quiet otherwise. */
  onlyNew?: boolean
  /** Check this first and only run when its output changed. */
  watch?: RoutineWatch
}

/**
 * A cheap check a routine runs before waking the model: a page or API, a
 * shell command, or a saved script (run_js) whose result is compared.
 */
export type RoutineWatch =
  { url: string } | { command: string } | { script: string }

/** How a bot works on its own between conversations. */
export interface ProactiveSettings {
  /** Regular check-ins: look at apps and open items, speak only if useful. */
  enabled: boolean
  everyHours: number
  /** "HH:mm" in `timezone`. No check-ins or push notifications in between. */
  quietStart: string
  quietEnd: string
  /** IANA zone, set from the user's browser. */
  timezone: string
  /** Upper bound on unprompted messages per day. */
  maxPerDay: number
  /**
   * Let background work call app tools that are not known to be read-only
   * (e.g. Executor's code-running `execute`) when the apps rule is "Ask
   * first". Off by default: nobody is there to approve.
   */
  appsInBackground: boolean
}

export const CHECK_IN_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const

export const DEFAULT_PROACTIVE: ProactiveSettings = {
  enabled: true,
  everyHours: 3,
  quietStart: "22:00",
  quietEnd: "08:00",
  timezone: "UTC",
  maxPerDay: 6,
  appsInBackground: false,
}

/** Something the bot is keeping an eye on until it is resolved. */
export interface OpenItem {
  id: string
  title: string
  /** Latest state, in the bot's words. */
  note: string
  sourceUrl?: string
  createdAt: number
  updatedAt: number
  /** When the bot wants to look again, if it said. */
  checkAfter?: number
  status: "open" | "resolved"
}

/** A workflow the bot learned, saved under /workspace/skills. */
export interface Skill {
  slug: string
  name: string
  description: string
}

/** An Agent Skill the user installed. The UserHub holds its one copy. */
export interface InstalledSkill {
  name: string
  description: string
  /** Where it came from: `owner/repo` or a site's URL. */
  source: string
  /** The commit it was read at. Empty for sites. */
  version: string
  digest: string
  /** The bots that may use it. Null means every bot. */
  bots: string[] | null
  installedAt: number
}

/** One skill found at a source, for the user to read before installing. */
export interface SkillCandidate {
  name: string
  description: string
  digest: string
  /** SKILL.md after its frontmatter: exactly what a bot will read. */
  instructions: string
  files: { path: string; size: number }[]
  /** Binary or oversized files that will be left out. */
  skipped: string[]
  /** The other source this name is installed from, which it would replace. */
  replaces?: string
}

export interface SkillPreview {
  source: string
  version: string
  /** The pasted command had -g. */
  global: boolean
  /** The pasted command named these skills, so they start selected. */
  named: boolean
  skills: SkillCandidate[]
}

export interface SkillInstallRequest {
  source: string
  version: string
  /** Each with the digest the user reviewed. One that changed is refused. */
  skills: { name: string; digest: string }[]
  /** A bot's id, or "all". */
  scope: string
}

/** The skills one bot may use. */
export interface BotSkillCatalog {
  fingerprint: string
  skills: { name: string; description: string }[]
}

/**
 * A small web app the bot built from its own data. Files live under
 * /workspace/apps/<slug>; data lives in the bot's SQLite as collections.
 */
export interface BotAppSummary {
  slug: string
  name: string
  description: string
  /** Bumped on every save, so open copies reload and caches turn over. */
  version: number
  updatedAt: number
}

/** Owner/email links require login; explicit share links are capabilities. */
export interface AppLink {
  token: string
  /** Who it is for, e.g. "Sarah". The owner's own link is "You". */
  label: string
  /**
   * edit: change anything. view: read anything. submit: a public form that
   * adds to the app's submit collections and reads only its own entries.
   */
  mode: "edit" | "view" | "submit"
  owner: boolean
  audience?: "owner" | "link" | "email" | "bot" | "session"
  email?: string
  canMessage?: boolean
  expiresAt?: number
  parentToken?: string
  viewerEmail?: string
  createdAt: number
  /** Path on this host, ending in "/". */
  path: string
}

/**
 * What a public (submit) link may do in an app. The bot sets it on
 * save_app; empty `submit` means the app has no public form.
 */
export interface AppAccess {
  /** Collections anyone with a public link can read, e.g. open slots. */
  read: string[]
  /** Collections a public link can add to but not read, e.g. responses. */
  submit: string[]
  /** Whether submissions wake the bot (a booking needs it, a survey not). */
  wake: boolean
}

/**
 * A limit on a granted tool: the value at `at` in its arguments (dots for
 * keys, [] for each item of a list) must be one of `allow`. Each allowed
 * value says whether calling with it only reads.
 */
export interface AppToolScope {
  at: string
  /** `label` is what the user reads, e.g. "Create event". */
  allow: { value: string; reads: boolean; label?: string }[]
}

/**
 * A tool on one of the user's connections that an app's server.js may
 * call live. The bot asks for it; it runs only once the user approves.
 */
export interface AppToolGrant {
  /** The bot's name for it, `tool_c<connection>_<tool>`. */
  name: string
  connectionId: string
  /** The tool's own name on the app, e.g. "create_event". */
  tool: string
  /** The connection's name, e.g. "Google Calendar". */
  app: string
  readOnly: boolean
  description: string
  /** Limits on its arguments, e.g. which Executor paths it may run. */
  only?: AppToolScope[]
}

/**
 * What the user approves: one tool, as reading or writing, with its limits.
 * Shared by the bot (to check) and the Apps tab (to show what is allowed).
 */
export function approvalKey(
  grant: Pick<AppToolGrant, "name" | "readOnly" | "only">
) {
  const base = `${grant.name}:${grant.readOnly ? "read" : "write"}`
  return grant.only?.length ? `${base}:${JSON.stringify(grant.only)}` : base
}

/** One call in an app's recent tool log, shown to the user. */
export interface AppToolCallLog {
  at: number
  name: string
  app: string
  tool: string
  readOnly: boolean
  /** The link label it came through. */
  by: string
  ok: boolean
  error?: string
  /** What the call did, in the user's words, e.g. "Create event". */
  action?: string
}

export interface BotAppDetail extends BotAppSummary {
  hasServer: boolean
  access: AppAccess
  /** Tools the app asked for. */
  tools: AppToolGrant[]
  /** Approval keys the user gave (see approvalKey in app-tools.ts). */
  approvedTools: string[]

  links: AppLink[]
  collections: { name: string; count: number }[]
}

/** URL path of an app, as served by `src/agents/apps-runtime.ts`. */
export function appPath(
  userId: string,
  botId: string,
  slug: string,
  token: string
) {
  return `/apps/${encodeURIComponent(userId)}/${botId}/${slug}/${token}/`
}

/** Synced to every client connected to a bot. */
export interface BotState {
  name: string
  avatar: BotAvatarKind
  /** What the bot is for, in the user's words. Editable in settings. */
  role: string
  status: BotStatus
  rules: Record<ActionClass, RulePolicy>
  routines: Routine[]
  proactive: ProactiveSettings
  skills: Skill[]
  apps: BotAppSummary[]
  /** This bot's own chat model. Null or absent uses the account's. */
  model?: string | null
  /** Last time the bot finished background work, for the settings panel. */
  lastCheckIn?: number
  /** App calls from the bot's scripts, paused until the user answers. */
  scriptApprovals?: ScriptApproval[]
  /** "manage" lets it run the user's other bots. Absent means "act". */
  access?: AccessLevel
  /** Routines, check-ins, email, webhooks and bot messages are skipped. */
  paused?: boolean
  /** Shared history is isolated from the owner's other bots and private context. */
  shared?: boolean
}

/**
 * A connected-app call made by one of the bot's scripts (run_js) that its
 * rules say to ask about. The script is paused, durably, until it is
 * answered.
 */
export interface ScriptApproval {
  /** The script run the call belongs to. */
  runId: string
  /** Pass with runId to answer it. */
  callId: string
  /** What the script is for, as the bot described it. */
  purpose: string
  /** App and tool, as the user knows them. */
  app: string
  tool: string
  /** The tool as the bot names it; "Approve all" trusts it for the run. */
  toolName: string
  /** The call's arguments, as pretty-printed JSON. */
  argsJson: string
  /** Unix ms when it started waiting. */
  since: number
}

/**
 * Metadata on a user-role message that did not come from the human.
 * "check-in", "email" and "webhook" turns run in the background: the
 * thread hides the trigger and shows only what the bot chose to say.
 */
export interface MessageOrigin {
  kind:
    | "bot"
    | "routine"
    | "check-in"
    | "email"
    | "webhook"
    | "app"
    | "crawl"
    | "pipeline"
    | "script"
    /** The user changed something the bot needs to know, like its access. */
    | "settings"
    /** An outside agent the user connected over MCP, like Claude Code. */
    | "agent"
  /** Bot, routine or pipeline name, email sender, webhook source, app name, crawled host, what a script was for, or what changed in settings. */
  name: string
  avatar?: BotAvatarKind
}

/** Fields this app stamps on `UIMessage.metadata`. */
export interface MessageMeta {
  origin?: MessageOrigin
  /** Unix ms. */
  at?: number
  /** Part of a turn the user did not start. */
  background?: boolean
  /** On a finished reply: how long the bot worked on it. */
  durationMs?: number
  /** Bot-to-bot messages: how many bots this chain has passed through. */
  hops?: number
  /** On the trigger of a routine run: which run of which routine it is. */
  routine?: { id: string; runId: string; attempt: number }
  /** On the trigger of a delegated task: its result goes back automatically. */
  task?: BotTask
  /** On a message carrying another bot's result for a task this bot handed out. */
  taskResult?: { taskId: string }
  /** On a "Buy" message from the product panel: exactly what was picked. */
  pick?: ShopPick
}

/** Where a task's result goes when the bot working on it finishes. */
export type TaskReplyTo =
  | { kind: "bot"; botId: string }
  | { kind: "pipeline"; runId: string; step: number }
  /** An outside agent over MCP: it reads the result with task_status. */
  | { kind: "client"; clientId: string }

/** Work handed to a bot whose final reply is sent back to whoever asked. */
export interface BotTask {
  id: string
  replyTo: TaskReplyTo
}

/** How a task ended, as the bot that did it reports it. */
export interface TaskOutcome {
  status: "done" | "failed" | "stopped"
  /** The bot's final reply. */
  result: string
  error?: string
  files?: BotAttachment[]
}

/** One run of a routine, newest first in `getRoutineRuns()`. */
export interface RoutineRun {
  id: string
  routineId: string
  name: string
  /** Unix ms. */
  startedAt: number
  finishedAt: number | null
  status:
    | "running"
    | "reported"
    | "quiet"
    | "waiting"
    | "failed"
    | "retrying"
    | "skipped"
    | "stopped"
  attempt: number
  note: string
}

/** A background turn ends with exactly this when there is nothing to say. */
export const NO_UPDATE = "NO_UPDATE"

/** A browser's Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionData {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}

/** Where a bot can be reached from outside the app. */
export interface BotInbound {
  /** Null when no email domain is configured or the bot's email is off. */
  email: string | null
  /** Whether the bot receives email. Off until the user turns it on. */
  emailEnabled: boolean
  /** Whether the deployment has an email domain at all. */
  emailAvailable: boolean
  webhookUrl: string
}

export interface ActivityEntry {
  id: number
  at: number
  tool: string
  summary: string
  ok: boolean
  durationMs: number
}

/** The page a browser_execute step ended on, for its Computer card. */
export interface BrowserFrame {
  url: string
  title: string
  at: number
  mediaType: string
  base64: string
}

export const NEW_BOT_NAME = "New bot"

/** Durable Object instance name for a bot. */
export function botInstanceName(userId: string, botId: string) {
  return `${userId}:${botId}`
}

export type SecretScheme = "bearer" | "header" | "basic"

/** A credential a bot saved with request_secret. The value never leaves the bot. */
export interface SecretMeta {
  name: string
  origin: string
  scheme: SecretScheme
  /** For "header": the header to set. "bearer" and "basic" use Authorization. */
  header: string
  purpose: string
  createdAt: number
}

/** One step of a pipeline: a bot does some work, or the user signs off. */
export type PipelineStep =
  | { kind: "bot"; botId: string; instructions: string }
  | { kind: "approval"; note: string }

/**
 * A fixed chain of bots, owned by the UserHub. Each bot step gets the
 * previous step's result (and files) as its input.
 */
export interface Pipeline {
  id: string
  name: string
  steps: PipelineStep[]
  /** 5-field UTC cron, or null to run only by hand. */
  cron: string | null
  createdAt: number
  updatedAt: number
}

/** What the editor sends to save a pipeline. */
export type PipelineDraft = Pick<Pipeline, "name" | "steps" | "cron">

export type PipelineRunStatus =
  "running" | "waiting" | "done" | "failed" | "stopped"

export interface PipelineRunStep {
  status: "pending" | "running" | "waiting" | "done" | "failed" | "skipped"
  /** Bot steps: who did it, as named when the step started. */
  botName?: string
  /** Bot steps: the final reply, clipped. The full text is in `pipelineOutput`. */
  output?: string
  /** Names of the files the step passed on. */
  files?: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface PipelineRun {
  id: string
  pipelineId: string
  name: string
  status: PipelineRunStatus
  trigger: "manual" | "schedule"
  /** What the user gave the first step, if anything. */
  input: string
  /** The steps as they were when the run started. */
  plan: PipelineStep[]
  steps: PipelineRunStep[]
  startedAt: number
  finishedAt: number | null
}

/** A file one bot sends another with message_bot. */
export interface BotAttachment {
  name: string
  bytes: Uint8Array
}
