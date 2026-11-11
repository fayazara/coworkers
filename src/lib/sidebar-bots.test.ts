import { describe, expect, it } from "vitest"
import { sidebarBots, sidebarBotActive, sidebarBotLink } from "./sidebar-bots"
import type { BotSummary, SharedBotSummary } from "./types"

function bot(id: string, name: string, updatedAt = 1): BotSummary {
  return {
    id,
    name,
    updatedAt,
    avatar: "blue-rectangle",
    status: "idle",
    preview: "",
    unread: false,
  }
}
function share(ownerId: string, summary: BotSummary): SharedBotSummary {
  return { ownerId, botId: summary.id, summary }
}

describe("unified bot sidebar", () => {
  it("shows incoming shares even when the recipient owns no bots", () => {
    const entries = sidebarBots(
      [],
      [share("brandon", bot("trip", "Trip planner"))],
      "wife"
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      ownerId: "brandon",
      bot: { name: "Trip planner" },
    })
  })
  it("interleaves shared and owned bots by most recent activity, not separate lists", () => {
    const entries = sidebarBots(
      [bot("mine", "Personal", 2), bot("older", "Older", 0)],
      [share("brandon", bot("trip", "Trip planner", 3))],
      "wife"
    )
    expect(entries.map((entry) => entry.bot.name)).toEqual([
      "Trip planner",
      "Personal",
      "Older",
    ])
  })
  it("routes shares to member chat and owned bots to owner chat", () => {
    const entries = sidebarBots(
      [bot("mine", "Personal")],
      [share("brandon", bot("trip", "Trip planner"))],
      "wife"
    )
    expect(sidebarBotLink(entries.find((entry) => entry.ownerId)!)).toEqual({
      to: "/shared/$ownerId/$botId",
      params: { ownerId: "brandon", botId: "trip" },
    })
    expect(sidebarBotLink(entries.find((entry) => !entry.ownerId)!)).toEqual({
      to: "/bots/$botId",
      params: { botId: "mine" },
    })
  })
  it("does not confuse equal bot IDs belonging to different owners", () => {
    const entries = sidebarBots(
      [bot("same", "Mine")],
      [share("brandon", bot("same", "Shared"))],
      "wife"
    )
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2)
    const shared = entries.find((entry) => entry.ownerId)!
    const owned = entries.find((entry) => !entry.ownerId)!
    expect(sidebarBotActive(shared, "same", "brandon")).toBe(true)
    expect(sidebarBotActive(owned, "same", "brandon")).toBe(false)
    expect(sidebarBotActive(shared, "same")).toBe(false)
    expect(sidebarBotActive(owned, "same")).toBe(true)
  })
  it("searches both kinds of bot by name and preview", () => {
    const shared = bot("trip", "Trip planner")
    shared.preview = "Booked a weekend away"
    expect(
      sidebarBots(
        [bot("mine", "Personal")],
        [share("brandon", shared)],
        "wife",
        "TRIP"
      )
    ).toHaveLength(1)
    expect(
      sidebarBots([], [share("brandon", shared)], "wife", "  weekend ")
    ).toHaveLength(1)
    expect(
      sidebarBots([], [share("brandon", shared)], "wife", "missing")
    ).toHaveLength(0)
  })
  it("keeps a bot listed once when both email and workspace grants discover it", () => {
    const shared = share("brandon", bot("trip", "Trip planner"))
    expect(sidebarBots([], [shared, shared], "wife")).toHaveLength(1)
  })
  it("does not add the owner's own workspace-shared bots a second time", () => {
    const own = bot("mine", "Mine")
    const entries = sidebarBots([own], [share("wife", own)], "wife")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.ownerId).toBeUndefined()
  })
  it("does not reuse the owner's unread state or mutate either source", () => {
    const owned = [bot("mine", "Mine")]
    const summary = { ...bot("trip", "Trip planner"), unread: true }
    const entries = sidebarBots(owned, [share("brandon", summary)], "wife")
    expect(entries.find((entry) => entry.ownerId)!.bot.unread).toBe(false)
    expect(summary.unread).toBe(true)
    expect(owned).toHaveLength(1)
    expect(owned[0]!.id).toBe("mine")
  })
  it("removes revoked shares on the next authoritative refresh", () => {
    expect(
      sidebarBots([], [share("brandon", bot("trip", "Trip planner"))], "wife")
    ).toHaveLength(1)
    expect(sidebarBots([], [], "wife")).toEqual([])
  })
})
