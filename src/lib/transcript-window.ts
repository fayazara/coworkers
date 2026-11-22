import type { UIMessage } from "ai"

/**
 * How many of a chat's newest messages the browser gets. Older ones load
 * when the user asks ("Show earlier"). Think on its own sends the whole
 * transcript on connect and after every change, which for a long chat is
 * megabytes each time.
 */
export const CLIENT_MESSAGES = 40

const CHAT_MESSAGES = "cf_agent_chat_messages"

/** A chat-messages frame cut to the newest messages; any other frame as is. */
export function windowFrame<T>(frame: T): T {
  const f = frame as { type?: unknown; messages?: unknown }
  if (
    f?.type !== CHAT_MESSAGES ||
    !Array.isArray(f.messages) ||
    f.messages.length <= CLIENT_MESSAGES
  ) {
    return frame
  }
  return { ...f, messages: f.messages.slice(-CLIENT_MESSAGES) } as T
}

/** Up to `limit` messages just before `beforeId`, oldest first. */
export function olderThan(
  messages: UIMessage[],
  beforeId: string,
  limit = CLIENT_MESSAGES
): UIMessage[] {
  const index = messages.findIndex((m) => m.id === beforeId)
  if (index <= 0) return []
  return messages.slice(Math.max(0, index - limit), index)
}

/**
 * Messages that fell off the front of the window between two updates. The
 * server sends only the newest ones, so each new message pushes the oldest
 * out; the browser keeps those to show above the window.
 */
export function droppedFromFront(
  previous: UIMessage[],
  next: UIMessage[]
): UIMessage[] {
  const first = next[0]
  if (!first) return []
  const at = previous.findIndex((m) => m.id === first.id)
  if (at <= 0) return []
  const kept = new Set(next.map((m) => m.id))
  return previous.slice(0, at).filter((m) => !kept.has(m.id))
}

/** Earlier messages, then the window, without repeats. */
export function withEarlier(
  earlier: UIMessage[],
  window: UIMessage[]
): UIMessage[] {
  if (earlier.length === 0) return window
  const inWindow = new Set(window.map((m) => m.id))
  return [...earlier.filter((m) => !inWindow.has(m.id)), ...window]
}
