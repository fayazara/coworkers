import { describeCron, parseCron } from "@/lib/cron"

/**
 * A tool call turned into something a person can read: an email looks like an
 * email, a command like a command, anything else like a short list of labeled
 * fields. Used wherever the app used to print the arguments as JSON.
 */
export interface PreviewRow {
  label: string
  value: string
  /** Multi-line or long: shown as a block of text under its label. */
  long?: boolean
}

export type CallPreview =
  | {
      kind: "email"
      to: string[]
      cc: string[]
      subject: string
      body: string
      /** For a reply: the email it answers, when only its file is known. */
      inReplyTo?: string
      extra?: unknown
    }
  | { kind: "command"; command: string }
  | {
      kind: "file"
      verb: "Create" | "Delete"
      path: string
      content?: string
    }
  | {
      kind: "edit"
      path: string
      /** What each change replaces, for a change not made yet. */
      edits: { oldText: string; newText: string }[]
      /** The unified patch of a change already made. */
      patch?: string
    }
  | { kind: "fields"; rows: PreviewRow[]; extra?: unknown }

type Input = Record<string, unknown>

const LONG_AT = 90
const MAX_BLOCK = 2000

const LABELS: Record<string, string> = {
  to: "To",
  cc: "Cc",
  bcc: "Bcc",
  url: "Page",
  path: "File",
  command: "Command",
  subject: "Subject",
  body: "Message",
  text: "Message",
  content: "Content",
  message: "Message",
  query: "Search for",
  prompt: "Instructions",
  name: "Name",
  when: "When",
  cron: "Repeats",
  at: "At",
}

/** `sentAt`, `sent_at` and `sent-at` all become "Sent at". */
export function humanKey(key: string) {
  if (LABELS[key]) return LABELS[key]
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `tool_ab12cd_send_email` is the tool `send_email`. */
function bareName(name: string) {
  return /^tool_[^_]+_(.+)$/.exec(name)?.[1] ?? name
}

function isObject(value: unknown): value is Input {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function clip(value: string, max = MAX_BLOCK) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Workspace paths read better without the folder every file lives in. */
function friendlyPath(path: string) {
  return path.replace(/^\/?workspace\//, "")
}

function stripHtml(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** One address or a list of them: strings, or `{ email, name }`. */
function addresses(value: unknown): string[] {
  const one = (v: unknown): string => {
    if (typeof v === "string") return v.trim()
    if (isObject(v)) {
      const email = text(v.email) || text(v.address)
      const name = text(v.name)
      return name && email ? `${name} <${email}>` : email
    }
    return ""
  }
  const list = Array.isArray(value) ? value : [value]
  return list.map(one).filter(Boolean)
}

/** The first of these keys that holds some text. */
function firstText(input: Input, keys: string[]) {
  for (const key of keys) {
    const value = text(input[key])
    if (value) return value
  }
  return ""
}

/** `/workspace/inbox/email/2026-11-02T07-22-20-this-is-a-test/message.md` */
function emailTitleFromPath(path: string) {
  const dir = /inbox\/email\/([^/]+)/.exec(path)?.[1]
  if (!dir) return undefined
  const slug = dir.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+-?/, "")
  if (!slug) return undefined
  const words = slug.replace(/-+/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function looksLikeEmail(name: string, input: Input) {
  if (/(^|_)(send|reply|draft|compose)(_|$).*(email|mail)/.test(name))
    return true
  if (/(^|_)(email|mail)(_|$)/.test(name) && ("to" in input || "path" in input))
    return true
  return "to" in input && ("subject" in input || "body" in input)
}

export function genericRows(input: Input): {
  rows: PreviewRow[]
  extra?: unknown
} {
  const rows: PreviewRow[] = []
  const extra: Input = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === "") continue
    const label = humanKey(key)
    if (typeof value === "string") {
      const isPath =
        key === "path" || key.endsWith("Path") || key.endsWith("_path")
      const shown = isPath ? friendlyPath(value) : value.trim()
      rows.push({
        label,
        value: clip(shown),
        long: shown.includes("\n") || shown.length > LONG_AT,
      })
    } else if (typeof value === "number") {
      rows.push({ label, value: String(value) })
    } else if (typeof value === "boolean") {
      rows.push({ label, value: value ? "Yes" : "No" })
    } else if (
      Array.isArray(value) &&
      value.every((v) => typeof v === "string" || typeof v === "number")
    ) {
      if (value.length) rows.push({ label, value: value.join(", ") })
    } else {
      extra[key] = value
    }
  }
  return { rows, extra: Object.keys(extra).length ? extra : undefined }
}

function whenOf(input: Input) {
  const cron = text(input.cron)
  if (cron) {
    const parsed = parseCron(cron)
    return (parsed && describeCron(parsed)) || `Repeats (${cron})`
  }
  const at = text(input.at)
  if (at) {
    const date = new Date(at)
    return Number.isNaN(date.getTime())
      ? at
      : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
  }
  return ""
}

/**
 * What to show for a call. `name` is the tool, `input` its arguments. An app
 * call (`app_tool_call`) is looked at by the app's tool and its own arguments.
 */
export function previewOf(name: string, input: Input): CallPreview {
  let tool = bareName(name)
  let args = input
  if (tool === "app_tool_call") {
    tool = bareName(text(input.tool))
    args = isObject(input.args) ? input.args : {}
  }

  if (tool === "exec" && text(args.command)) {
    return { kind: "command", command: text(args.command) }
  }

  if ((tool === "write" || tool === "delete") && text(args.path)) {
    return {
      kind: "file",
      verb: tool === "write" ? "Create" : "Delete",
      path: friendlyPath(text(args.path)),
      content:
        tool === "write" && typeof args.content === "string"
          ? clip(args.content)
          : undefined,
    }
  }

  if (tool === "edit" && text(args.path)) {
    const edits = (Array.isArray(args.edits) ? args.edits : [args])
      .filter(isObject)
      .filter(
        (e) => typeof e.oldText === "string" && typeof e.newText === "string"
      )
      .map((e) => ({
        oldText: e.oldText as string,
        newText: e.newText as string,
      }))
    if (edits.length) {
      return { kind: "edit", path: friendlyPath(text(args.path)), edits }
    }
  }

  if (looksLikeEmail(tool, args)) {
    const body =
      firstText(args, ["body", "text", "content", "message"]) ||
      stripHtml(text(args.html))
    const { extra } = genericRows(
      Object.fromEntries(
        Object.entries(args).filter(
          ([key]) =>
            ![
              "to",
              "cc",
              "bcc",
              "subject",
              "body",
              "text",
              "html",
              "content",
              "message",
              "path",
            ].includes(key)
        )
      )
    )
    return {
      kind: "email",
      to: addresses(args.to),
      cc: addresses(args.cc),
      subject: text(args.subject),
      body: clip(body),
      inReplyTo:
        tool === "reply_email"
          ? emailTitleFromPath(text(args.path))
          : undefined,
      extra,
    }
  }

  if (tool === "schedule_routine" || tool === "update_routine") {
    const when = whenOf(args)
    const rest = Object.fromEntries(
      Object.entries(args).filter(([key]) => key !== "cron" && key !== "at")
    )
    const { rows, extra } = genericRows(rest)
    return {
      kind: "fields",
      rows: when
        ? [
            ...rows.filter((r) => r.label === "Name"),
            { label: "When", value: when },
            ...rows.filter((r) => r.label !== "Name"),
          ]
        : rows,
      extra,
    }
  }

  return { kind: "fields", ...genericRows(args) }
}

/** Button words that say what will happen, not just "Approve". */
export function approvalLabels(name: string, input: Input) {
  const preview = previewOf(name, input)
  if (preview.kind === "email") return { approve: "Send", reject: "Don't send" }
  if (preview.kind === "file" && preview.verb === "Delete") {
    return { approve: "Delete", reject: "Keep" }
  }
  return { approve: "Approve", reject: "Reject" }
}

/**
 * The preview of a finished edit: its patch, from the tool's result. `output`
 * is what the edit tool returned.
 */
export function editedPreview(
  input: Input,
  output: unknown
): CallPreview | null {
  if (!isObject(output) || typeof output.patch !== "string") return null
  const path = text(output.path) || text(input.path)
  if (!path) return null
  return {
    kind: "edit",
    path: friendlyPath(path),
    edits: [],
    patch: output.patch,
  }
}

/** True when there is nothing worth showing. */
export function isEmptyPreview(preview: CallPreview) {
  return (
    preview.kind === "fields" && preview.rows.length === 0 && !preview.extra
  )
}
