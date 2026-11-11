import type { BotSummary, SharedBotSummary } from "./types"

export interface SidebarBot {
  key: string
  bot: BotSummary
  /** Present only for incoming shares, which use the member-only chat route. */
  ownerId?: string
}

export function sidebarBots(
  owned: BotSummary[],
  shared: SharedBotSummary[],
  viewerId: string,
  query = ""
): SidebarBot[] {
  const entries = new Map<string, SidebarBot>()
  for (const bot of owned) {
    const key = `${viewerId}:${bot.id}`
    entries.set(key, { key, bot })
  }
  for (const { ownerId, botId, summary } of shared) {
    if (ownerId === viewerId) continue
    const key = `${ownerId}:${botId}`
    // A recipient has no per-user unread tracking yet; don't reuse the owner's dot.
    entries.set(key, {
      key,
      ownerId,
      bot: { ...summary, id: botId, unread: false },
    })
  }
  const needle = query.trim().toLowerCase()
  return [...entries.values()]
    .filter(
      ({ bot }) =>
        !needle ||
        bot.name.toLowerCase().includes(needle) ||
        bot.preview.toLowerCase().includes(needle)
    )
    .sort(
      (a, b) => b.bot.updatedAt - a.bot.updatedAt || a.key.localeCompare(b.key)
    )
}

export function sidebarBotLink({ bot, ownerId }: SidebarBot) {
  return ownerId
    ? {
        to: "/shared/$ownerId/$botId" as const,
        params: { ownerId, botId: bot.id },
      }
    : { to: "/bots/$botId" as const, params: { botId: bot.id } }
}

export function sidebarBotActive(
  entry: SidebarBot,
  botId?: string,
  ownerId?: string
) {
  return entry.bot.id === botId && entry.ownerId === ownerId
}
