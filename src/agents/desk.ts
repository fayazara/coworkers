import { choiceOptions } from "@/lib/choices"
import { approvalLabels } from "@/lib/call-preview"
import type {
  DeskCard,
  DeskCardInput,
  DeskLane,
  DeskOrigin,
  ScriptApproval,
} from "@/lib/types"

/** Cards kept in hub state; older ones stay in SQL until pruned. */
export const MAX_DESK_IN_STATE = 80
/** "Done while you were away" is about the last few days. */
export const DONE_KEEP_MS = 3 * 24 * 60 * 60 * 1000
/** Findings nobody dismissed drop off after two weeks. */
export const FYI_KEEP_MS = 14 * 24 * 60 * 60 * 1000
const MAX_FOUND_CHARS = 700
const MAX_TITLE_CHARS = 110
const MAX_DETAIL_CHARS = 2_000

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** Markdown down to one plain line. */
function plain(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]+/g, "")
    .replace(/(^|\s)[-•]\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** Markdown links in a reply, as the card's sources. */
export function linksIn(markdown: string, max = 3) {
  const seen = new Set<string>()
  const links: { label: string; url: string }[] = []
  for (const match of markdown.matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  )) {
    const [, label, url] = match
    if (seen.has(url)) continue
    seen.add(url)
    links.push({ label: clip(plain(label), 60), url })
    if (links.length === max) break
  }
  return links
}

/** The first sentence (or line) of a reply, as the card's title. */
export function titleOf(markdown: string) {
  const firstLine =
    markdown
      .split("\n")
      .map((l) => plain(l))
      .find(Boolean) ?? ""
  const sentence = /^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine
  return clip(sentence.replace(/[:.]$/, ""), MAX_TITLE_CHARS)
}

/**
 * The reply minus its first sentence when that sentence became the title,
 * so the card does not say it twice. Left alone when unsure.
 */
export function withoutTitle(markdown: string, title: string) {
  const lines = markdown.trim().split("\n")
  const index = lines.findIndex((l) => plain(l))
  if (index === -1) return markdown.trim()
  const line = lines[index]
  const sentence = /^(.+?[.!?])(\s+|$)/.exec(line)?.[1] ?? line
  if (plain(sentence).replace(/[:.]$/, "") !== title) return markdown.trim()
  lines[index] = line.slice(sentence.length).trim()
  return lines.join("\n").trim()
}

/** Links at the very end of a reply; the card shows them as chips instead. */
export function withoutTrailingLinks(markdown: string) {
  const trimmed = markdown
    .trim()
    .replace(/(?:\s*(?:·|\||,)?\s*\[[^\]]+\]\(https?:\/\/[^)\s]+\))+$/, "")
    .trim()
  return trimmed || markdown.trim()
}

/** The lane a finished turn's card goes in. Null: it gets no card. */
export function laneFor(origin: DeskOrigin): DeskLane | null {
  switch (origin) {
    case "check-in":
    case "email":
    case "webhook":
    case "app":
    case "crawl":
    case "bot":
      return "fyi"
    case "routine":
    case "script":
    case "chat":
    case "settings":
      return "done"
    // The pipeline's own run view reports these, and an outside agent
    // reports to whoever is using it.
    case "pipeline":
    case "agent":
      return null
  }
}

/** Why a card is here, from what started the work. */
export function whyOf(origin: DeskOrigin, name: string) {
  switch (origin) {
    case "check-in":
      return "Found on a regular check-in"
    case "routine":
      return `Routine · ${name}`
    case "email":
      return `Email from ${name}`
    case "webhook":
      return `Event from ${name}`
    case "app":
      return `From your app ${name}`
    case "crawl":
      return `Crawl of ${name}`
    case "script":
      return `Script · ${name}`
    case "bot":
      return `Message from ${name}`
    case "pipeline":
      return `Pipeline · ${name}`
    case "chat":
      return name ? `You asked: “${clip(plain(name), 90)}”` : "You asked"
    case "settings":
      return name
    case "agent":
      return `From ${name}`
  }
}

/**
 * The card for a reply the user was probably not watching: a background
 * finding, a routine report, or a long job that finished.
 */
export function replyCard(input: {
  messageId: string
  origin: DeskOrigin
  /** Origin name; for "chat", what the user asked. */
  name: string
  text: string
  at: number
}): DeskCardInput | null {
  const lane = laneFor(input.origin)
  const text = input.text.trim()
  if (!lane || !text) return null
  const title = titleOf(text)
  return {
    key: `reply:${input.messageId}`,
    lane,
    origin: input.origin,
    title,
    why: whyOf(input.origin, input.name),
    found: clip(
      withoutTrailingLinks(withoutTitle(text, title)),
      MAX_FOUND_CHARS
    ),
    sources: linksIn(text),
    actions: [{ id: "open", label: "Open chat", kind: "open_chat" }],
    refs: { messageId: input.messageId },
    createdAt: input.at,
  }
}

/** A routine that failed for good. */
export function failureCard(input: {
  runId: string
  name: string
  error: string
  messageId: string
  at: number
}): DeskCardInput {
  return {
    key: `routine-failed:${input.runId}`,
    lane: "fyi",
    origin: "routine",
    title: `${input.name} did not finish`,
    why: whyOf("routine", input.name),
    found: clip(input.error, MAX_FOUND_CHARS),
    sources: [],
    actions: [{ id: "open", label: "Open chat", kind: "open_chat" }],
    refs: { messageId: input.messageId },
    createdAt: input.at,
  }
}

/** A tool call in the chat that is waiting on the user. */
export interface WaitingCall {
  approvalId: string
  name: string
  input: Record<string, unknown>
  messageId: string
  /** What the bot said in that reply, for context. */
  said: string
  at: number
}

function toolLabel(name: string) {
  // MCP tools are named `tool_<serverId>_<tool>`.
  const match = /^tool_[^_]+_(.+)$/.exec(name)
  return (match ? match[1] : name).replace(/[_-]+/g, " ").trim()
}

/** What the bot wants to do, in the imperative, for an approval's title. */
export function askTitle(name: string, input: Record<string, unknown>) {
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : ""
  switch (name) {
    case "app_tool_call":
      return capitalize(toolLabel(str("tool")))
    case "exec":
      return `Run ${clip(str("command").replace(/\s+/g, " ").trim(), 60)}`
    case "write":
    case "edit":
      return `Change ${str("path")}`
    case "delete":
      return `Delete ${str("path")}`
    case "message_bot":
      return `Message ${str("to")}`
    case "send_email":
      return `Email ${str("to")}`
    case "reply_email":
      return "Reply to an email"
    case "delegate_task":
      return `Give ${str("to")} a task`
    case "schedule_routine":
      return `Schedule “${str("name")}”`
    case "browser_execute":
      return "Use the browser"
    default:
      return capitalize(toolLabel(name))
  }
}

function argsOf(name: string, input: Record<string, unknown>) {
  const args =
    name === "app_tool_call" && input.args && typeof input.args === "object"
      ? input.args
      : input
  const json = JSON.stringify(args, null, 2)
  return json === "{}" ? undefined : clip(json, MAX_DETAIL_CHARS)
}

/** The Needs-you card for a call waiting in the chat. */
export function waitingCard(call: WaitingCall): DeskCardInput {
  const base = {
    key: `approval:${call.approvalId}`,
    lane: "needs_you" as const,
    origin: "chat" as const,
    why: call.said ? clip(plain(call.said), 160) : "Waiting for your OK",
    sources: [],
    refs: { messageId: call.messageId, approvalId: call.approvalId },
    createdAt: call.at,
  }
  const str = (key: string) =>
    typeof call.input[key] === "string" ? (call.input[key] as string) : ""
  if (call.name === "ask_user") {
    const options = choiceOptions(call.input.options).map((o) =>
      o.detail ? `${o.label}: ${o.detail}` : o.label
    )
    return {
      ...base,
      title: clip(str("question") || "A question for you", MAX_TITLE_CHARS),
      found: options.length ? options.map((o) => `- ${o}`).join("\n") : "",
      actions: [{ id: "open", label: "Answer", kind: "open_chat" }],
    }
  }
  if (call.name === "request_secret") {
    return {
      ...base,
      title: `Needs ${str("name") || "a credential"}`,
      found: str("origin") ? `Only ever sent to ${str("origin")}.` : "",
      actions: [{ id: "open", label: "Add it", kind: "open_chat" }],
    }
  }
  if (call.name === "connect_app") {
    return {
      ...base,
      title: `Connect ${str("name") || "an app"}`,
      found: str("why"),
      actions: [{ id: "open", label: "Connect", kind: "open_chat" }],
    }
  }
  if (call.name === "install_skill") {
    return {
      ...base,
      title: "Wants to install a skill",
      found: str("source"),
      actions: [{ id: "open", label: "Review it", kind: "open_chat" }],
    }
  }
  if (call.name === "request_handoff") {
    return {
      ...base,
      title: "Needs you in the browser",
      found: str("instructions"),
      actions: [{ id: "open", label: "Take over", kind: "open_chat" }],
    }
  }
  return {
    ...base,
    title: clip(askTitle(call.name, call.input), MAX_TITLE_CHARS),
    found: "",
    detail: argsOf(call.name, call.input),
    tool: call.name === "app_tool_call" ? str("tool") || call.name : call.name,
    actions: [
      {
        id: "approve",
        label: approvalLabels(call.name, call.input).approve,
        kind: "approve",
      },
      { id: "reject", label: "Not now", kind: "reject" },
    ],
  }
}

/** The Needs-you card for a script's paused app call. */
export function scriptCard(approval: ScriptApproval): DeskCardInput {
  return {
    key: `script:${approval.callId}`,
    lane: "needs_you",
    origin: "script",
    title: clip(
      `${capitalize(toolLabel(approval.tool))} in ${approval.app}`,
      MAX_TITLE_CHARS
    ),
    why: approval.purpose
      ? whyOf("script", clip(approval.purpose, 120))
      : "A script is paused for your OK",
    found: "",
    ...(approval.argsJson !== "{}"
      ? {
          detail: clip(approval.argsJson, MAX_DETAIL_CHARS),
          tool: approval.tool,
        }
      : {}),
    sources: [],
    actions: [
      { id: "approve", label: "Approve", kind: "approve" },
      ...(approval.toolName
        ? [
            {
              id: "approve_all",
              label: "Approve for this run",
              kind: "approve_all" as const,
            },
          ]
        : []),
      { id: "reject", label: "Not now", kind: "reject" },
    ],
    refs: { script: { runId: approval.runId, callId: approval.callId } },
    createdAt: approval.since,
  }
}

/**
 * Which stored cards to show: open ones and snoozed ones that are due,
 * minus done and FYI cards past their shelf life. Newest first.
 */
export function visibleCards(cards: DeskCard[], now: number) {
  return (
    cards
      .filter((c) => {
        if (c.status === "snoozed") return (c.snoozeUntil ?? 0) <= now
        if (c.status !== "open") return false
        if (c.lane === "done") return now - c.createdAt < DONE_KEEP_MS
        if (c.lane === "fyi") return now - c.createdAt < FYI_KEEP_MS
        return true
      })
      // A snoozed card comes back at the top, as if it just arrived.
      .map((c) =>
        c.status === "snoozed"
          ? {
              ...c,
              status: "open" as const,
              createdAt: c.snoozeUntil ?? c.createdAt,
              snoozeUntil: undefined,
            }
          : c
      )
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_DESK_IN_STATE)
  )
}
