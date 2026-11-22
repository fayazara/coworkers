import type { UIMessage } from "ai"
import type { BotState, BotSummary } from "@/lib/types"

export interface CachedBot {
  state: BotState
  messages: UIMessage[]
}

// Filled only from the browser (LiveBot, LiveHubProvider). On the server both
// stay empty, so nothing is shared between users.
const bots = new Map<string, CachedBot>()
let summaries = new Map<string, BotSummary>()

/** The hub's sidebar state, which says whether a cached bot can be trusted. */
export function syncBotSummaries(list: BotSummary[]) {
  summaries = new Map(list.map((b) => [b.id, b]))
}

export function rememberBot(botId: string, bot: CachedBot) {
  bots.set(botId, bot)
}

/**
 * The bot as it was last seen, for an instant switch. The socket corrects it
 * on connect, except while a turn is running: the server then sends no
 * history, so a bot that is not idle must be fetched. So must one with unread
 * replies (the "New" divider needs them at mount) or a deleted one.
 */
export function cachedBot(botId: string): CachedBot | undefined {
  const summary = summaries.get(botId)
  if (!summary || summary.unread || summary.status !== "idle") return undefined
  return bots.get(botId)
}

type BotFetcher = (botId: string) => Promise<CachedBot | null>

let fetcher: BotFetcher | null = null

/**
 * The hub's socket, once it is open. A bot fetched over it costs one trip
 * to the hub, next to its bots; the server function costs several.
 */
export function setBotFetcher(next: BotFetcher | null) {
  fetcher = next
}

/** A bot over the hub's socket, or undefined when it is not open yet. */
export async function fetchBot(
  botId: string
): Promise<CachedBot | null | undefined> {
  if (!fetcher) return undefined
  try {
    return await fetcher(botId)
  } catch (err) {
    // A dropped socket mid-call: the caller falls back to the server.
    console.warn("Fetching bot over the hub failed", err)
    return undefined
  }
}
