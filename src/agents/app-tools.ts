import type { AppTool, AppToolCallLog, AppToolGrant } from "@/lib/types"

/**
 * Live access from an app's server.js to tools on the user's connections.
 *
 * The bot names the tools an app needs on save_app (a grant). Nothing runs
 * until the user approves them in the Apps tab. An approval is for a tool
 * as it was approved: if a tool that read now says it writes, it needs a
 * new approval. Only server.js can call them, never the page, so the bot's
 * code decides what of a result anyone sees (free times, not event titles).
 */

export const MAX_APP_TOOLS = 10
export const MAX_TOOL_ARGS_BYTES = 16 * 1024

/** What the user approves: one tool, as reading or as writing. */
export function approvalKey(grant: Pick<AppToolGrant, "name" | "readOnly">) {
  return `${grant.name}:${grant.readOnly ? "read" : "write"}`
}

/**
 * The grants for the tool names the bot asked for, from the user's current
 * apps. Throws with a message the bot can act on.
 */
export function resolveGrants(
  requested: string[],
  catalog: AppTool[],
  nameOf: (tool: AppTool) => string
): AppToolGrant[] {
  const names = [...new Set(requested.map((n) => n.trim()).filter(Boolean))]
  if (names.length > MAX_APP_TOOLS) {
    throw new Error(`An app can use at most ${MAX_APP_TOOLS} app tools`)
  }
  return names.map((name) => {
    const tool = catalog.find((t) => nameOf(t) === name)
    if (!tool) {
      throw new Error(
        `No connected app has a tool named ${name}. Use the exact name from your tools or app_tools_search.`
      )
    }
    return {
      name,
      connectionId: tool.connectionId,
      tool: tool.name,
      app: tool.connectionName,
      readOnly: tool.readOnly,
      description: tool.description.slice(0, 200),
    }
  })
}

/** Grants the user approved, as the tools are now. */
export function approvedGrants(grants: AppToolGrant[], approved: string[]) {
  const keys = new Set(approved)
  return grants.filter((g) => keys.has(approvalKey(g)))
}

export type ToolDecision =
  | { ok: true; grant: AppToolGrant; tool: AppTool }
  | { ok: false; error: string; status: number }

/** Whether server.js may call this tool now. */
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
  const now = { name: grant.name, readOnly: tool.readOnly }
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
  return { ok: true, grant, tool }
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

export const MAX_TOOL_LOG = 20

export function pushToolLog(log: AppToolCallLog[], entry: AppToolCallLog) {
  return [entry, ...log].slice(0, MAX_TOOL_LOG)
}
