import { approvalKey } from "@/lib/types"
import type { AppTool, AppToolGrant, AppToolScope } from "@/lib/types"

export { approvalKey }

/**
 * Live access from an app's server.js to tools on the user's connections.
 *
 * The bot names the tools an app needs on save_app (a grant). Nothing runs
 * until the user approves them in the Apps tab. An approval is for a tool
 * as it was approved: if a tool that read now says it writes, or the bot
 * changes what the grant is limited to, it needs a new approval. Only
 * server.js can call them, never the page, so the bot's code decides what
 * of a result anyone sees (free times, not event titles).
 *
 * A grant can be limited to certain argument values (`only`). That is what
 * makes a general tool safe to hand to a public page: Executor's `call`
 * runs any tool on any of the user's accounts, but limited to
 * `calls[].path` in [free/busy, insert event] it runs only those two. Each
 * allowed value says whether it reads or writes, which decides the rate
 * limit and the log.
 */

export const MAX_APP_TOOLS = 10
export const MAX_TOOL_ARGS_BYTES = 16 * 1024
export const MAX_SCOPES = 4
export const MAX_SCOPE_VALUES = 20

/** What the bot asks for: a tool name, or a tool limited to some values. */
export type AppToolRequest = string | { name: string; only?: AppToolScope[] }

const AT_RE = /^[A-Za-z0-9_$-]+(\[\])?(\.[A-Za-z0-9_$-]+(\[\])?)*$/

/** Checked, tidy scopes from what the bot sent. Throws a message for the bot. */
export function cleanScopes(name: string, only: AppToolScope[] | undefined) {
  if (!only || only.length === 0) return undefined
  if (only.length > MAX_SCOPES) {
    throw new Error(`${name}: at most ${MAX_SCOPES} limits per tool`)
  }
  return only.map((scope) => {
    const at = scope.at.trim()
    if (!AT_RE.test(at)) {
      throw new Error(
        `${name}: "${scope.at}" is not an argument path. Use dots and [] for lists, e.g. calls[].path`
      )
    }
    const seen = new Set<string>()
    const allow = scope.allow
      .map((a) => {
        const label =
          typeof a.label === "string" ? a.label.trim().slice(0, 40) : ""
        return {
          value: String(a.value),
          reads: a.reads === true,
          ...(label ? { label } : {}),
        }
      })
      .filter((a) => a.value && !seen.has(a.value) && seen.add(a.value))
    if (allow.length === 0 || allow.length > MAX_SCOPE_VALUES) {
      throw new Error(
        `${name}: each limit needs 1 to ${MAX_SCOPE_VALUES} allowed values`
      )
    }
    if (allow.some((a) => a.value.length > 300)) {
      throw new Error(`${name}: allowed values are at most 300 characters`)
    }
    return { at, allow }
  })
}

/**
 * The values at a path in the arguments. `a.b` reads keys; `a[]` reads
 * every item when `a` is a list, or `a` itself when it is not, since tools
 * like Executor's call take one call or a list of them.
 */
export function valuesAt(args: unknown, at: string): unknown[] {
  let nodes: unknown[] = [args]
  for (const part of at.split(".")) {
    const each = part.endsWith("[]")
    const key = each ? part.slice(0, -2) : part
    const next: unknown[] = []
    for (const node of nodes) {
      const value =
        node && typeof node === "object" && !Array.isArray(node)
          ? (node as Record<string, unknown>)[key]
          : undefined
      if (each && Array.isArray(value)) next.push(...value)
      else next.push(value)
    }
    nodes = next
  }
  return nodes
}

/**
 * Whether the arguments stay inside the grant's limits, and if so whether
 * this call reads. Every value at each path must be one of its allowed
 * values; a missing value fails, so a limit cannot be stepped around by
 * leaving it out.
 */
export function checkScopes(
  only: AppToolScope[],
  args: unknown
): { ok: true; reads: boolean } | { ok: false; error: string } {
  let reads = true
  for (const scope of only) {
    const values = valuesAt(args, scope.at)
    if (values.length === 0) {
      return { ok: false, error: `${scope.at} is missing` }
    }
    for (const value of values) {
      const match =
        typeof value === "string"
          ? scope.allow.find((a) => a.value === value)
          : undefined
      if (!match) {
        const shown =
          typeof value === "string" ? `"${value.slice(0, 80)}"` : "missing"
        return {
          ok: false,
          error: `${scope.at} ${shown} is not one the user allowed for this app`,
        }
      }
      if (!match.reads) reads = false
    }
  }
  return { ok: true, reads }
}

/**
 * What a call does, in the user's words: the labels (or values) of the
 * first limit it matches, e.g. "Check free/busy". Falls back to the tool.
 */
export function describeCall(
  grant: Pick<AppToolGrant, "tool" | "only">,
  args: unknown
): string {
  const scope = grant.only?.[0]
  if (scope) {
    const names = valuesAt(args, scope.at).map((v) => {
      const match =
        typeof v === "string"
          ? scope.allow.find((a) => a.value === v)
          : undefined
      if (match) return match.label ?? match.value
      return typeof v === "string" ? v.slice(0, 60) : "unknown"
    })
    const unique = [...new Set(names)]
    if (unique.length > 0) return unique.join(" + ")
  }
  return grant.tool
}

/**
 * The grants for the tools the bot asked for, from the user's current
 * apps. Throws with a message the bot can act on.
 */
export function resolveGrants(
  requested: AppToolRequest[],
  catalog: AppTool[],
  nameOf: (tool: AppTool) => string
): AppToolGrant[] {
  const byName = new Map<string, AppToolScope[] | undefined>()
  for (const r of requested) {
    const name = (typeof r === "string" ? r : r.name).trim()
    if (!name) continue
    byName.set(name, typeof r === "string" ? undefined : r.only)
  }
  if (byName.size > MAX_APP_TOOLS) {
    throw new Error(`An app can use at most ${MAX_APP_TOOLS} app tools`)
  }
  return [...byName].map(([name, only]) => {
    const tool = catalog.find((t) => nameOf(t) === name)
    if (!tool) {
      throw new Error(
        `No connected app has a tool named ${name}. Use the exact name from your tools or app_tools_search.`
      )
    }
    const scopes = cleanScopes(name, only)
    return {
      name,
      connectionId: tool.connectionId,
      tool: tool.name,
      app: tool.connectionName,
      readOnly: tool.readOnly,
      description: tool.description.slice(0, 200),
      ...(scopes ? { only: scopes } : {}),
    }
  })
}

/** Grants the user approved, as the tools are now. */
export function approvedGrants(grants: AppToolGrant[], approved: string[]) {
  const keys = new Set(approved)
  return grants.filter((g) => keys.has(approvalKey(g)))
}

export type ToolDecision =
  | { ok: true; grant: AppToolGrant; tool: AppTool; reads: boolean }
  | { ok: false; error: string; status: number }

/** Whether server.js may call this tool now, and whether the call reads. */
export function decideToolCall(input: {
  name: string
  args: unknown
  grants: AppToolGrant[]
  approved: string[]
  catalog: AppTool[]
  nameOf: (tool: AppTool) => string
}): ToolDecision {
  const grant = input.grants.find((g) => g.name === input.name)
  if (!grant) {
    return {
      ok: false,
      status: 403,
      error: `This app has no access to ${input.name}. Add it to appTools on save_app.`,
    }
  }
  const tool = input.catalog.find((t) => input.nameOf(t) === input.name)
  if (!tool) {
    return {
      ok: false,
      status: 503,
      error: `${grant.app} is not connected right now`,
    }
  }
  // The tool as it is now must match what the user approved.
  const now = { name: grant.name, readOnly: tool.readOnly, only: grant.only }
  if (!input.approved.includes(approvalKey(now))) {
    return {
      ok: false,
      status: 403,
      error: `The user has not allowed this app to use ${grant.app} (${tool.name}) yet. They allow it in the Apps tab.`,
    }
  }
  const args = input.args
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, status: 400, error: "Tool arguments must be an object" }
  }
  if (JSON.stringify(args).length > MAX_TOOL_ARGS_BYTES) {
    return { ok: false, status: 413, error: "Tool arguments are too large" }
  }
  if (grant.only?.length) {
    const scoped = checkScopes(grant.only, args)
    if (!scoped.ok) return { ok: false, status: 403, error: scoped.error }
    // A tool that only reads cannot be made to write by a label.
    return { ok: true, grant, tool, reads: tool.readOnly || scoped.reads }
  }
  return { ok: true, grant, tool, reads: tool.readOnly }
}

export const TOOL_LIMITS = {
  /** Reads happen on every page view, so they get more room. */
  read: {
    perVisitor: { limit: 60, windowMs: 10 * 60_000 },
    perLink: { limit: 1000, windowMs: 60 * 60_000 },
  },
  /** Writes reach the user's accounts: as tight as submissions. */
  write: {
    perVisitor: { limit: 5, windowMs: 10 * 60_000 },
    perLink: { limit: 100, windowMs: 60 * 60_000 },
  },
}

/**
 * An MCP result that reports a failure (`isError`) as a message, else null.
 * Apps often fail this way instead of throwing, and an app's code would
 * otherwise read the failure as a result and lose the reason.
 */
export function toolResultError(result: unknown): string | null {
  const r = result as {
    isError?: boolean
    content?: { type?: string; text?: string }[]
  } | null
  if (!r || typeof r !== "object" || r.isError !== true) return null
  const text = Array.isArray(r.content)
    ? r.content
        .map((c) => (typeof c?.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim()
    : ""
  return text || "The app returned an error without a message"
}
