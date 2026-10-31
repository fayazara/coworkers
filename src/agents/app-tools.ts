/**
 * Naming and permission guesses for connected app tools. Pure helpers, so
 * they can be tested without a Durable Object.
 */

const READ_VERBS =
  /(^|[_\-.])(get|list|search|read|fetch|find|query|lookup|describe|view|show|count)([_\-.]|$)/i
const WRITE_VERBS =
  /(^|[_\-.])(send|create|delete|remove|update|edit|post|write|set|move|archive|reply|forward|draft|cancel|pay|approve|invite|share|execute|run|replace|merge|mark|add|insert|upload|publish|submit|trash|purge|drop|clear|reset|close|assign|transfer|trigger|start|stop|revoke|grant|import|sync|patch|put|upsert|modify|rename|copy|restore|apply|accept|reject|schedule|subscribe|label|tag|comment|star|pin|book|order|buy|refund|charge)([_\-.]|$)/i

/**
 * Background turns may only use read-only app tools. A server's own
 * annotations win; a tool marked destructive is never read-only. Servers
 * that do not annotate their tools get a conservative guess from the name:
 * it must read and must not also write (`find_and_replace`).
 */
export function isReadOnlyTool(
  name: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
) {
  if (annotations?.destructiveHint === true) return false
  if (annotations?.readOnlyHint !== undefined) return annotations.readOnlyHint
  return READ_VERBS.test(name) && !WRITE_VERBS.test(name)
}

const MAX_TOOL_NAME = 64

/** Short, stable hash of a string (FNV-1a), in base 36. */
function shortHash(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Model-facing name for a connection's tool: `tool_<connection>_<tool>`,
 * limited to the characters and length tool names allow. When the name has
 * to be cleaned or cut, two tools could end up with the same one, so a hash
 * of the original name is added to keep them apart.
 */
export function appToolName(connectionId: string, name: string) {
  const prefix = `tool_c${connectionId}_`
  const full = prefix + name
  if (full.length <= MAX_TOOL_NAME && /^[a-zA-Z0-9_-]+$/.test(full)) {
    return full
  }
  const tag = `_${shortHash(name)}`
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_")
  return (prefix + cleaned).slice(0, MAX_TOOL_NAME - tag.length) + tag
}
