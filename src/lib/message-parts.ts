import type { UIMessage } from "ai"
import { NO_UPDATE } from "@/lib/types"
import type { MessageMeta, MessageOrigin, Routine } from "@/lib/types"

export type ToolCallState = "running" | "waiting" | "done" | "error" | "denied"

/** A tool part, normalized across static (`tool-<name>`) and dynamic tools. */
export interface ToolCall {
  id: string
  name: string
  state: ToolCallState
  input: Record<string, unknown>
  output: unknown
  errorText?: string
  /** Present while the call is waiting for the user to approve it. */
  approvalId?: string
}

export type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "event"; key: string; label: string }
  | { kind: "computer"; key: string; calls: ToolCall[] }
  | { kind: "steps"; key: string; calls: ToolCall[] }
  | { kind: "approval"; key: string; call: ToolCall }
  | { kind: "choice"; key: string; call: ToolCall }
  | { kind: "secret"; key: string; call: ToolCall }
  | { kind: "connect"; key: string; call: ToolCall }
  | { kind: "show"; key: string; call: ToolCall }
  | { kind: "skill"; key: string; call: ToolCall }
  | { kind: "capture"; key: string; call: ToolCall; capture: Capture }
  | { kind: "routine"; key: string; routine: Routine; updated: boolean }
  | { kind: "shop-results"; key: string; call: ToolCall }
  | { kind: "shop-checkout"; key: string; call: ToolCall }

/** A reply split into the steps behind it and what the user should see. */
export interface TurnView {
  /** Tool steps, folded behind one status line. */
  work: ToolCall[]
  /** Updates, cards, events and the reply, in order. */
  shown: Block[]
  /**
   * Key of the block the reply starts at: the first text or `show` block
   * with no tool call after it. Text before it is an update the bot wrote
   * along the way.
   */
  replyKey?: string
}

/**
 * Everything the bot says is shown, in order: its updates between tool calls
 * are messages of their own. Only the plain tool steps fold away.
 */
export function toTurn(blocks: Block[]): TurnView {
  // Blocks the bot shows are part of what it says, like its text.
  const says = (b: Block) => b.kind === "text" || b.kind === "show"
  const lastTool = blocks.findLastIndex((b) => !says(b) && b.kind !== "event")
  const reply = blocks.findIndex((b, i) => i > lastTool && says(b))
  const work: ToolCall[] = []
  const shown: Block[] = []
  for (const block of blocks) {
    if (block.kind === "steps") work.push(...block.calls)
    else shown.push(block)
  }
  return {
    work,
    shown,
    replyKey: reply === -1 ? undefined : blocks[reply].key,
  }
}

function routineOf(call: ToolCall): Routine | null {
  const out = call.output as { scheduled?: Routine; updated?: Routine } | null
  const routine = out?.scheduled ?? out?.updated
  return routine && typeof routine.id === "string" ? routine : null
}

/** A screenshot or PDF a tool saved to the bot's files. */
export interface Capture {
  path: string
  mediaType: string
}

const COMPUTER_TOOLS = new Set(["browser_execute", "request_handoff"])
const CAPTURE_TOOLS = new Set(["browser_screenshot", "browser_pdf"])

function captureOf(call: ToolCall): Capture | null {
  const out = call.output as { saved?: unknown; mediaType?: unknown } | null
  if (typeof out?.saved !== "string" || typeof out.mediaType !== "string") {
    return null
  }
  return { path: out.saved, mediaType: out.mediaType }
}

type Part = UIMessage["parts"][number]

const PART_STATE: Record<string, ToolCallState> = {
  "input-streaming": "running",
  "input-available": "running",
  "approval-requested": "waiting",
  "approval-responded": "running",
  "output-available": "done",
  "output-error": "error",
  "output-denied": "denied",
}

function toToolCall(part: Part): ToolCall | null {
  const p = part as {
    type: string
    toolName?: string
    toolCallId?: string
    state?: string
    input?: unknown
    output?: unknown
    errorText?: string
    approval?: { id: string }
  }
  const name =
    p.type === "dynamic-tool"
      ? p.toolName
      : p.type.startsWith("tool-")
        ? p.type.slice("tool-".length)
        : undefined
  if (!name || !p.toolCallId) return null
  const state = PART_STATE[p.state ?? ""] ?? "running"
  return {
    id: p.toolCallId,
    name,
    state,
    input:
      p.input && typeof p.input === "object"
        ? (p.input as Record<string, unknown>)
        : {},
    output: p.output,
    errorText: p.errorText,
    approvalId: state === "waiting" ? p.approval?.id : undefined,
  }
}

/** Turn an assistant message's parts into the blocks the thread renders. */
export function toBlocks(message: UIMessage): Block[] {
  const blocks: Block[] = []
  message.parts.forEach((part, index) => {
    const key = `${message.id}:${index}`
    if (part.type === "text") {
      if (part.text.trim()) blocks.push({ kind: "text", key, text: part.text })
      return
    }
    const call = toToolCall(part)
    if (!call) return

    if (call.name === "set_name") {
      if (call.state === "done") {
        blocks.push({
          kind: "event",
          key,
          label: `Renamed to ${String(call.input.name ?? "")}`,
        })
      }
      return
    }
    if (call.name === "set_context") {
      if (call.state === "done") {
        blocks.push({ kind: "event", key, label: "Updated memory" })
      }
      return
    }
    if (call.name === "track_item" || call.name === "resolve_item") {
      if (call.state === "done") {
        const verb = call.name === "track_item" ? "Keeping an eye on" : "Closed"
        const what =
          call.name === "track_item"
            ? String(call.input.title ?? "")
            : String(call.input.outcome ?? "")
        blocks.push({ kind: "event", key, label: `${verb}: ${what}` })
      }
      return
    }
    if (call.name === "save_skill") {
      if (call.state === "done") {
        blocks.push({
          kind: "event",
          key,
          label: `Learned a skill: ${String(call.input.name ?? "")}`,
        })
      }
      return
    }
    if (call.name === "install_skill") {
      if (call.state === "waiting") blocks.push({ kind: "skill", key, call })
      else if (call.state === "done") {
        const names = (call.output as { installed?: string[] } | null)
          ?.installed
        blocks.push({
          kind: "event",
          key,
          label: names?.length
            ? `Installed ${names.join(", ")}`
            : "Skill not installed",
        })
      } else if (call.state !== "running") {
        blocks.push({ kind: "event", key, label: "Skill not installed" })
      }
      return
    }
    if (call.name === "activate_skill") {
      if (call.state === "done") {
        blocks.push({
          kind: "event",
          key,
          label: `Using the ${String(call.input.name ?? "")} skill`,
        })
      }
      return
    }
    if (call.name === "request_secret") {
      const name = String(call.input.name ?? "credential")
      if (call.state === "waiting") blocks.push({ kind: "secret", key, call })
      else if (call.state === "done") {
        const saved = (call.output as { saved?: boolean } | null)?.saved
        blocks.push({
          kind: "event",
          key,
          label: saved ? `Saved ${name}` : `${name} not provided`,
        })
      } else if (call.state !== "running") {
        blocks.push({ kind: "event", key, label: `${name} not provided` })
      }
      return
    }
    if (call.name === "connect_app") {
      const name = String(call.input.name ?? "the app")
      const connected =
        (call.output as { connected?: boolean } | null)?.connected === true
      // The card stays in the chat once connected, as the record of it.
      if (call.state === "waiting" || (call.state === "done" && connected)) {
        blocks.push({ kind: "connect", key, call })
      } else if (call.state !== "running") {
        blocks.push({ kind: "event", key, label: `${name} not connected` })
      }
      return
    }
    if (call.name === "ask_user") {
      const question = String(call.input.question ?? "")
      if (call.state === "waiting") {
        blocks.push({ kind: "choice", key, call })
      } else if (call.state === "done") {
        const answer = (call.output as { answer?: string | null } | null)
          ?.answer
        blocks.push({
          kind: "event",
          key,
          label: answer ? `${question} · ${answer}` : question,
        })
      } else if (call.state !== "running") {
        blocks.push({
          kind: "event",
          key,
          label: `${question} · answered in chat`,
        })
      }
      return
    }
    // What the bot shows instead of prose. It draws while it streams in; a
    // call that failed falls through to the steps.
    if (call.name === "show") {
      if (call.state === "running" || call.state === "done") {
        blocks.push({ kind: "show", key, call })
        return
      }
    }
    // Bookkeeping the user does not need to see.
    if (call.name === "mark_reported" || call.name === "was_reported") return

    // Search results and checkouts are what the user came for: cards, shown
    // while they load too. Failed calls fall through to the steps.
    if (
      call.name === "shop_search" &&
      (call.state === "running" || call.state === "done")
    ) {
      blocks.push({ kind: "shop-results", key, call })
      return
    }
    if (
      call.name === "shop_checkout" &&
      (call.state === "running" || call.state === "done")
    ) {
      blocks.push({ kind: "shop-checkout", key, call })
      return
    }
    if (call.name === "shop_order_status" && call.state === "done") {
      const out = call.output as {
        status?: string
        store?: string
        order?: { label?: string }
      } | null
      if (out?.status === "completed") {
        blocks.push({
          kind: "event",
          key,
          label: `Order placed${out.store ? ` at ${out.store}` : ""}${out.order?.label ? ` · ${out.order.label}` : ""}`,
        })
        return
      }
    }

    if (
      (call.name === "schedule_routine" || call.name === "update_routine") &&
      call.state === "done"
    ) {
      const routine = routineOf(call)
      if (routine) {
        blocks.push({
          kind: "routine",
          key,
          routine,
          updated: call.name === "update_routine",
        })
        return
      }
    }

    if (CAPTURE_TOOLS.has(call.name) && call.state === "done") {
      const capture = captureOf(call)
      if (capture) {
        blocks.push({ kind: "capture", key, call, capture })
        return
      }
    }

    const last = blocks.at(-1)
    if (COMPUTER_TOOLS.has(call.name)) {
      // One browser, one card: narration between calls must not split it.
      const card = blocks.find((b) => b.kind === "computer")
      if (card) card.calls.push(call)
      else blocks.push({ kind: "computer", key, calls: [call] })
      return
    }
    if (call.state === "waiting") {
      blocks.push({ kind: "approval", key, call })
      return
    }
    if (last?.kind === "steps") last.calls.push(call)
    else blocks.push({ kind: "steps", key, calls: [call] })
  })
  return blocks
}

export function messageText(message: UIMessage) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function metaOf(message: UIMessage): MessageMeta {
  return (message.metadata ?? {}) as MessageMeta
}

export function originOf(message: UIMessage): MessageOrigin | undefined {
  return metaOf(message).origin
}

/** A background reply that chose to say nothing (it is pruned soon after). */
export function isQuietReply(message: UIMessage) {
  const texts = message.parts.filter((p) => p.type === "text" && p.text.trim())
  const last = texts.at(-1)
  if (last?.type !== "text") return false
  const text = last.text.trim()
  return text.startsWith(NO_UPDATE) || text.endsWith(NO_UPDATE)
}

/** Bot and routine messages carry a bracketed first line meant for the model. */
export function stripOriginHeader(text: string) {
  return text.replace(/^\[[^\]]+\]\n/, "")
}

function mcpLabel(name: string) {
  // MCP tools are named `tool_<serverId>_<tool>`.
  const match = /^tool_[^_]+_(.+)$/.exec(name)
  return (match ? match[1] : name).replace(/_/g, " ")
}

/** One-line description of a tool call for the step list. */
export function describeCall(call: ToolCall): string {
  const { input } = call
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : ""
  switch (call.name) {
    case "read":
      return `Read ${str("path")}`
    case "ls":
      return `Listed ${str("path") || "/workspace"}`
    case "find":
      return `Searched files for ${str("pattern")}`
    case "grep":
      return `Searched for "${str("pattern")}"`
    case "write":
      return `Wrote ${str("path")}`
    case "edit":
      return `Edited ${str("path")}`
    case "delete":
      return `Deleted ${str("path")}`
    case "exec":
      return `Ran ${str("command").replace(/\s+/g, " ").trim()}`
    case "browser_markdown":
      return `Read ${str("url")}`
    case "browser_extract":
      return `Extracted data from ${str("url")}`
    case "browser_links":
      return `Listed links on ${str("url")}`
    case "browser_scrape":
      return `Scraped ${str("url") || "a page"}`
    case "browser_screenshot":
      return `Took a screenshot of ${str("url") || "a page"}`
    case "browser_pdf":
      return `Saved ${str("url") || "a page"} as PDF`
    case "browser_crawl":
      return `Started crawling ${str("url")}`
    case "message_bot":
      return `Messaged ${str("to")}`
    case "send_email":
      return `Emailed ${str("to")}`
    case "reply_email":
      return "Replied to an email"
    case "app_tool_call": {
      const label = mcpLabel(str("tool"))
      return label.charAt(0).toUpperCase() + label.slice(1)
    }
    case "delegate_task":
      return `Gave ${str("to")} a task`
    case "attach_result_files":
      return "Attached files to the result"
    case "read_skill_resource":
      return `Read ${str("path") || "a skill's file"}`
    case "schedule_routine":
      return `Scheduled "${str("name")}"`
    case "update_routine":
      return "Updated a routine"
    case "list_routines":
      return "Checked routines"
    case "cancel_routine":
      return "Cancelled a routine"
    case "search_context":
      return "Searched memory"
    case "search_history":
      return `Searched history for "${str("query")}"`
    case "read_history":
      return "Read earlier messages"
    case "update_item":
      return "Updated an open item"
    case "start_teaching":
      return "Started watching"
    case "finish_teaching":
      return "Stopped watching"
    case "save_app":
      return `Published app "${str("name")}"`
    case "list_apps":
      return "Checked apps"
    case "delete_app":
      return `Deleted app ${str("slug")}`
    case "app_data_list":
      return `Read ${str("slug")}/${str("collection")}`
    case "app_data_put":
      return `Updated ${str("slug")}/${str("collection")}`
    case "app_data_delete":
      return `Removed from ${str("slug")}/${str("collection")}`
    case "shop_search":
      return str("query")
        ? `Searched stores for "${str("query")}"`
        : "Searched stores for similar items"
    case "shop_product": {
      const title = (call.output as { title?: unknown } | null)?.title
      return typeof title === "string" && title
        ? `Checked ${title}`
        : "Looked up a product"
    }
    case "shop_checkout":
      return `Set up a checkout${str("store") ? ` at ${str("store")}` : ""}`
    case "shop_order_status":
      return "Checked an order"
    default:
      return mcpLabel(call.name)
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function baseName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? ""
}

/** What the bot is doing right now, for the live status line. */
export function describeActivity(call: ToolCall): string {
  const { input } = call
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : ""
  const on = (verb: string, fallback: string) => {
    const host = hostOf(str("url"))
    return host ? `${verb} ${host}` : fallback
  }
  switch (call.name) {
    case "read":
      return baseName(str("path"))
        ? `Reading ${baseName(str("path"))}`
        : "Reading a file"
    case "ls":
    case "find":
    case "grep":
      return "Looking through files"
    case "write":
    case "edit":
      return baseName(str("path"))
        ? `Writing ${baseName(str("path"))}`
        : "Writing a file"
    case "delete":
      return "Tidying up files"
    case "exec":
      return "Running a command"
    case "shell_job":
      return "Waiting on a command"
    case "run_js":
      return str("purpose") || "Running a script"
    case "script_wait":
      return "Waiting on a script"
    case "browser_markdown":
      return on("Reading", "Reading a page")
    case "browser_extract":
    case "browser_scrape":
      return on("Pulling data from", "Pulling data from a page")
    case "browser_links":
      return on("Scanning", "Scanning a page")
    case "browser_screenshot":
      return on("Capturing", "Taking a screenshot")
    case "browser_pdf":
      return "Saving a PDF"
    case "browser_crawl":
      return on("Crawling", "Starting a crawl")
    case "message_bot":
      return "Messaging another bot"
    case "delegate_task":
      return "Handing off a task"
    case "send_email":
    case "reply_email":
      return "Writing an email"
    case "search_history":
    case "read_history":
      return "Looking back through our chat"
    case "search_context":
    case "remember":
    case "remember_for_all_bots":
      return "Checking memory"
    case "schedule_routine":
    case "update_routine":
      return "Setting up a routine"
    case "list_routines":
    case "cancel_routine":
      return "Checking routines"
    case "save_app":
      return str("name") ? `Building ${str("name")}` : "Building an app"
    case "app_data_list":
    case "app_data_put":
    case "app_data_delete":
    case "list_apps":
      return "Updating an app"
    case "shop_search":
      return "Searching stores"
    case "shop_product":
      return "Checking a product"
    case "shop_checkout":
      return "Setting up a checkout"
    case "shop_order_status":
      return "Checking an order"
    case "app_tools_search":
      return "Finding the right tool"
    case "secret_request":
      return on("Calling", "Calling an API")
    case "track_item":
    case "update_item":
    case "resolve_item":
      return "Updating open items"
  }
  if (call.name === "app_tool_call" || call.name.startsWith("tool_")) {
    const label = describeCall(call)
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return "Working"
}

/** What a step touched, for its icon and for grouping runs of steps. */
export type StepKind =
  | "shell"
  | "files"
  | "search"
  | "history"
  | "web"
  | "memory"
  | "routine"
  | "bot"
  | "app"
  | "shop"
  | "other"

export function stepKind(call: ToolCall): StepKind {
  switch (call.name) {
    case "exec":
      return "shell"
    case "read":
    case "ls":
    case "write":
    case "edit":
    case "delete":
      return "files"
    case "find":
    case "grep":
      return "search"
    case "search_history":
    case "read_history":
      return "history"
    case "search_context":
      return "memory"
    case "schedule_routine":
    case "update_routine":
    case "list_routines":
    case "cancel_routine":
      return "routine"
    case "message_bot":
    case "delegate_task":
    case "attach_result_files":
      return "bot"
    case "save_app":
    case "list_apps":
    case "delete_app":
    case "app_data_list":
    case "app_data_put":
    case "app_data_delete":
      return "app"
  }
  if (call.name.startsWith("shop_")) return "shop"
  if (call.name.startsWith("browser_")) return "web"
  if (call.name.startsWith("tool_")) return "app"
  return "other"
}

const FILE_WRITES = new Set(["write", "edit", "delete"])

/** Header for a run of same-kind steps, e.g. "Ran 4 commands". */
export function describeGroup(kind: StepKind, calls: ToolCall[]): string {
  const n = calls.length
  switch (kind) {
    case "shell":
      return `Ran ${n} commands`
    case "files":
      return calls.some((c) => FILE_WRITES.has(c.name))
        ? `Changed ${n} files`
        : `Read ${n} files`
    case "search":
      return `Searched ${n} times`
    case "history":
      return `Looked back through history ${n} times`
    case "web":
      return `Visited ${n} pages`
    default:
      return `${n} steps`
  }
}

/** Shell output in the shape @cloudflare/computer's exec tool returns. */
export interface ShellResult {
  command: string
  output: string
  exitCode: number | null
  error?: string
}

export function shellResult(call: ToolCall): ShellResult | null {
  if (call.name !== "exec") return null
  const out = (call.output ?? {}) as {
    stdout?: unknown
    stderr?: unknown
    exitCode?: unknown
    error?: unknown
  }
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  return {
    command: text(call.input.command),
    output: [text(out.stdout), text(out.stderr)]
      .filter((t) => t.trim())
      .join("\n")
      .replace(/\s+$/, ""),
    exitCode: typeof out.exitCode === "number" ? out.exitCode : null,
    error: text(out.error) || call.errorText,
  }
}
