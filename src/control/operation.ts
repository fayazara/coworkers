import type { z } from "zod"
import type {
  AccessLevel,
  ActionClass,
  BotAttachment,
  BotSummary,
  RulePolicy,
} from "@/lib/types"

/**
 * One thing a bot, an outside agent or the UI can do, defined once.
 * Transports (bot tools, browser callables, later `/mcp`) only build the
 * caller and the ports, then hand the call to `runOperation` in
 * `./access.ts`, which checks it before `run` sees it.
 */
export interface Operation<I = unknown, O = unknown> {
  name: string
  /** What the model reads. Short and instructive: what to keep, what not to do. */
  description: string
  input: z.ZodType<I>
  /** The access level a caller needs. */
  level: AccessLevel
  /** Destructive operations always ask, unless the user does them in the browser. */
  effect: "read" | "write" | "destructive"
  /** Who may call it at all. Absent: anyone with the level. */
  callers?: Caller["kind"][]
  /** The rule that governs it when a bot calls it. Absent: always allowed. */
  actionClass?: ActionClass
  /** Refuses input that would give more than the caller has. */
  ceiling?: (caller: Caller, input: I) => Failure | null
  run: (ctx: OperationContext, input: I) => Promise<O | Failure>
}

export function defineOperation<I, O>(op: Operation<I, O>) {
  return op
}

/** Any operation, for the registry and transports, which only pass input through. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperation = Operation<any, unknown>

// ── Callers ─────────────────────────────────────────────────────────

export type { AccessLevel }

export const LEVEL_RANK: Record<AccessLevel, number> = {
  read: 0,
  act: 1,
  manage: 2,
}

export type Caller =
  /** The browser, signed in through Access. */
  | { kind: "user" }
  | {
      kind: "bot"
      botId: string
      level: AccessLevel
      /** Its own rules: nothing it creates or configures may be looser. */
      rules: Record<ActionClass, RulePolicy>
      /** Bots this conversation has passed through, this call included. */
      hops: number
      /** A background turn: nobody is there to approve. */
      background: boolean
    }
  | { kind: "client"; clientId: string; label: string; level: AccessLevel }

export function levelOf(caller: Caller): AccessLevel {
  return caller.kind === "user" ? "manage" : caller.level
}

// ── Context ─────────────────────────────────────────────────────────

export interface OperationContext {
  caller: Caller
  /**
   * Stable across retries of one call: a bot's tool call id, later an MCP
   * client's `clientRequestId`. Null when the caller has none.
   */
  requestId: string | null
  /** The user already approved this call (a tool approval card). */
  approved: boolean
  hub: HubPort
  /** The calling bot's own records and files. Present for bot callers. */
  self?: BotPort
}

/** What operations need from the UserHub, local or over Durable Object RPC. */
export interface HubPort {
  hasBot(botId: string): Promise<boolean>
  listBots(): Promise<BotSummary[]>
  /** A bot's latest messages, oldest first. Null when there is no such bot. */
  readBot(botId: string, limit: number): Promise<BotTranscript | null>
  addBot(): Promise<BotSummary>
  /** False when there is no such bot. */
  setPaused(botId: string, paused: boolean): Promise<boolean>
  removeBot(botId: string): Promise<void>
  /** False when there is no such bot. */
  configureBot(botId: string, input: BotSettingsPatch): Promise<boolean>
  relayMessage(
    fromBotId: string,
    to: string,
    text: string,
    delivery: { key?: string; hops?: number; files?: BotAttachment[] }
  ): Promise<Delivery & { files?: string[] }>
  delegateTask(
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
  ): Promise<Delivery>
  /** An outside agent's message to a bot. `key` dedupes retries. */
  messageFromClient(
    client: ClientRef,
    to: string,
    text: string,
    key: string
  ): Promise<Delivery>
  /** An outside agent hands a bot a task; its result waits for task_status. */
  delegateFromClient(
    client: ClientRef,
    to: string,
    task: string,
    taskId: string
  ): Promise<Delivery>
  /** A task an outside agent handed out. Null when it is not that agent's. */
  clientTask(clientId: string, taskId: string): Promise<ClientTask | null>
  /** Skills from this source that this bot may use. */
  installedFrom(botId: string, source: string): Promise<string[]>
}

export interface ClientRef {
  clientId: string
  label: string
}

export interface ClientTask {
  id: string
  botId: string
  botName: string
  status: "open" | "done" | "failed" | "stopped"
  result: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export type Delivery =
  | { delivered: true; to: string; botId: string }
  | { delivered: false; code: FailureCode; error: string }

/** The calling bot's side of bot-to-bot work. */
export interface BotPort {
  readAttachments(
    paths: string[]
  ): Promise<{ files: BotAttachment[] } | { error: string }>
  openDelegation(d: {
    taskId: string
    to: string
    task: string
    hops: number
    background: boolean
  }): void
  confirmDelegation(taskId: string, to: string): void
  dropDelegation(taskId: string): void
}

export interface BotTranscript {
  name: string
  messages: { role: "user" | "assistant"; at?: string; text: string }[]
}

export interface BotSettingsPatch {
  name?: string
  role?: string
  access?: AccessLevel
  rules?: Partial<Record<ActionClass, RulePolicy>>
  /** Null goes back to the account's model. */
  model?: string | null
}

// ── Failures ────────────────────────────────────────────────────────

export type FailureCode =
  | "denied"
  | "needs_approval"
  | "not_found"
  | "paused"
  | "ceiling"
  | "invalid"
  | "hop_limit"
  | "unavailable"

/** Expected refusals come back as results the model can read, not as throws. */
export interface Failure {
  ok: false
  code: FailureCode
  error: string
}

export function fail(code: FailureCode, error: string): Failure {
  return { ok: false, code, error }
}

export function isFailure(value: unknown): value is Failure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { code?: unknown }).code === "string"
  )
}
