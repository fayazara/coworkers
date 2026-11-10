import type { ModelMessage, ToolResultPart } from "ai"

/**
 * Guards that keep a turn from going off the rails. Pure helpers, so they can
 * be tested without a Durable Object.
 */

/** Identical consecutive calls allowed before the guard blocks the next one. */
export const MAX_IDENTICAL_CALLS = 5

/** JSON with sorted keys, so `{a, b}` and `{b, a}` are the same call. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`
}

/**
 * Stops a model that keeps making the exact same tool call. A call that
 * differs in any argument resets the count, so polling with a changing
 * cursor or retrying with a fix is never blocked.
 */
export class LoopGuard {
  #last = ""
  #count = 0

  reset() {
    this.#last = ""
    this.#count = 0
  }

  /** Returns a block reason once the same call repeats too often. */
  check(toolName: string, input: unknown): string | null {
    const key = `${toolName}:${stableJson(input)}`
    this.#count = key === this.#last ? this.#count + 1 : 1
    this.#last = key
    if (this.#count <= MAX_IDENTICAL_CALLS) return null
    return `You have made this exact ${toolName} call ${MAX_IDENTICAL_CALLS} times in a row and it will not change the result. Stop retrying. Tell the user what you were trying to do, what came back, and what you need from them.`
  }
}

// ── Time budget for a turn the user is watching ───────────────────────

/** Work this long without a word to the user and the bot is told to post one. */
export const UPDATE_AFTER_MS = 60_000
/** Past this, the bot is told to stop exploring and report what it has. */
export const WRAP_UP_AFTER_MS = 3 * 60_000
/** Past this, tools are switched off for the step: it has to answer. */
export const STOP_AFTER_MS = 5 * 60_000

export type BudgetAction =
  | { kind: "update"; note: string }
  | { kind: "wrap_up"; note: string }
  | { kind: "stop"; note: string }

/**
 * Keeps a watched turn from going quiet or grinding on. A person waiting on
 * a chat expects word within a minute and an answer within a few, even a
 * partial one; one that has tried three sites without luck should say so
 * rather than try a fourth. Each nudge is given once per turn.
 */
export class TurnBudget {
  #startedAt: number | null = null
  #lastUpdateAt = 0
  #given = new Set<BudgetAction["kind"]>()

  start(now: number) {
    this.#startedAt = now
    this.#lastUpdateAt = now
    this.#given.clear()
  }

  /** The bot wrote something the user can see. */
  spoke(now: number) {
    this.#lastUpdateAt = now
    // Another minute of silence after this deserves another nudge.
    this.#given.delete("update")
  }

  check(now: number): BudgetAction | null {
    if (this.#startedAt === null) return null
    const worked = now - this.#startedAt
    const minutes = Math.max(1, Math.round(worked / 60_000))
    if (worked >= STOP_AFTER_MS && !this.#given.has("stop")) {
      this.#given.add("stop")
      return {
        kind: "stop",
        note: `[From the app, not the user] You have worked ${minutes} minutes on this and tools are now off. Reply now with what you have: the answer so far (even partial, with its sources), what blocked you, and one line offering the next step you would take if they want you to keep going.`,
      }
    }
    if (worked >= WRAP_UP_AFTER_MS && !this.#given.has("wrap_up")) {
      this.#given.add("wrap_up")
      return {
        kind: "wrap_up",
        note: `[From the app, not the user] You have worked ${minutes} minutes and the user is waiting. Do not start on new sources or approaches. Finish with at most one or two more calls, then give the result with what you have, say plainly what blocked you, and offer to keep going.`,
      }
    }
    if (
      now - this.#lastUpdateAt >= UPDATE_AFTER_MS &&
      !this.#given.has("update")
    ) {
      this.#given.add("update")
      return {
        kind: "update",
        note: "[From the app, not the user] The user has seen nothing from you for over a minute. In this step, before any tool call, write one or two sentences: what you have found so far (or what is blocking you) and what you are trying next.",
      }
    }
    return null
  }
}

// ── Context shaping within a turn ─────────────────────────────────────

/** Longest tool result the model sees, in characters. */
export const MAX_TOOL_RESULT_CHARS = 12_000
/** Large page results kept whole; older ones are shortened. */
export const KEEP_PAGE_RESULTS = 3
/** Screenshots kept; older ones are dropped. */
export const KEEP_IMAGES = 2
const PAGE_RESULT_MIN_CHARS = 1_000
const SHORTENED_CHARS = 1_000

/** Tools whose results describe a page that goes stale as the bot moves on. */
const PAGE_TOOLS = new Set([
  "browser_execute",
  "browser_markdown",
  "browser_extract",
  "browser_scrape",
  "browser_links",
])

type ToolOutput = ToolResultPart["output"]

function outputText(output: ToolOutput): string | null {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value
    case "json":
    case "error-json":
      return JSON.stringify(output.value) ?? ""
    case "content":
      return output.value
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
    default:
      return null
  }
}

function isImage(part: { type: string; mediaType?: string }) {
  return part.type === "file" && (part.mediaType ?? "").startsWith("image")
}

function shortened(output: ToolOutput, keep: number, note: string): ToolOutput {
  const text = outputText(output)
  if (text === null) return output
  const type =
    output.type === "error-text" || output.type === "error-json"
      ? "error-text"
      : "text"
  return { type, value: `${text.slice(0, keep)}\n\n${note}` }
}

/**
 * What the model sees of tool results on the next step of a long turn:
 * - every result is capped at MAX_TOOL_RESULT_CHARS, with a marker
 * - only the newest KEEP_PAGE_RESULTS large page results stay whole
 * - only the newest KEEP_IMAGES screenshots stay; older ones become a note
 * The stored transcript and the UI keep everything. Deterministic, so the
 * same history is shaped the same way on every step and stays cacheable.
 */
export function shapeToolResults(
  messages: ModelMessage[]
): ModelMessage[] | null {
  const results: { m: number; p: number; part: ToolResultPart }[] = []
  messages.forEach((message, m) => {
    if (message.role !== "tool") return
    message.content.forEach((part, p) => {
      if (part.type === "tool-result") results.push({ m, p, part })
    })
  })
  if (results.length === 0) return null

  const replace = new Map<string, ToolOutput>()
  let pages = 0
  let images = 0
  for (let i = results.length - 1; i >= 0; i--) {
    const { m, p, part } = results[i]
    let output = part.output
    if (output.type === "content") {
      const value = output.value.map((item) => {
        if (!isImage(item)) return item
        images++
        return images > KEEP_IMAGES
          ? {
              type: "text" as const,
              text: "[Earlier screenshot removed to save context. Take a new one if you need to see the page.]",
            }
          : item
      })
      if (
        value.some(
          (item, j) => item !== (output as { value: unknown[] }).value[j]
        )
      ) {
        output = { ...output, value }
      }
    }
    const text = outputText(output)
    if (
      text !== null &&
      PAGE_TOOLS.has(part.toolName) &&
      text.length > PAGE_RESULT_MIN_CHARS
    ) {
      pages++
      if (pages > KEEP_PAGE_RESULTS) {
        output = shortened(
          output,
          SHORTENED_CHARS,
          "[Earlier page result shortened after you read it. What you concluded from it stands. Run the tool again only if you need the rest.]"
        )
      }
    }
    const capped = outputText(output)
    if (capped !== null && capped.length > MAX_TOOL_RESULT_CHARS) {
      output = shortened(
        output,
        MAX_TOOL_RESULT_CHARS,
        `[Truncated: this result had ${capped.length} characters and only the first ${MAX_TOOL_RESULT_CHARS} are shown. Narrow the request, or write the output to a file and grep it.]`
      )
    }
    if (output !== part.output) replace.set(`${m}:${p}`, output)
  }
  if (replace.size === 0) return null

  return messages.map((message, m) => {
    if (message.role !== "tool") return message
    let changed = false
    const content = message.content.map((part, p) => {
      const output = replace.get(`${m}:${p}`)
      if (!output || part.type !== "tool-result") return part
      changed = true
      return { ...part, output }
    })
    return changed ? { ...message, content } : message
  })
}
