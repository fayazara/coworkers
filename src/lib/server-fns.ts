import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { DEMO_PROFILES, DEMO_USER_ID, identify } from "@/lib/auth"
import { locationHintFor } from "@/lib/location-hint"
import { SIDEBAR_COOKIE, parseWidths } from "@/lib/layout-context"
import type { PanelWidths } from "@/lib/layout-context"
import type { BotState, HubState } from "@/lib/types"
import type { UserHub } from "@/agents/user-hub"

export interface Viewer {
  id: string
  label: string
  avatarUrl?: string
}

// TODO: temporary, hardcoded for screenshots. Replace with the signed-in
// user's profile once there is real auth.
const DEMO_VIEWER = {
  label: "Fayaz Ahmed",
  avatarUrl: "https://github.com/fayazara.png",
}

async function viewerFromRequest(request: Request): Promise<Viewer> {
  const { id, email } = await identify(request)
  if (id === DEMO_USER_ID) return { id, ...DEMO_VIEWER }
  if (id in DEMO_PROFILES) {
    return { id, label: DEMO_PROFILES[id as keyof typeof DEMO_PROFILES].label }
  }
  return { id, label: email ?? id }
}

/**
 * Sidebar state for the first paint. After hydration the browser takes over
 * with a WebSocket to the same UserHub.
 */
export const getHubSnapshot = createServerFn().handler(
  async (): Promise<{
    viewer: Viewer
    hub: HubState
    sidebarOpen: boolean
    widths: PanelWidths
  }> => {
    const request = getRequest()
    const viewer = await viewerFromRequest(request)
    const cookie = request.headers.get("Cookie") ?? ""
    const sidebarOpen = !cookie.includes(`${SIDEBAR_COOKIE}=closed`)
    // The first page load is what usually creates the hub: put it near.
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      viewer.id,
      { locationHint: locationHintFor(request) }
    )
    return {
      viewer,
      hub: await hub.snapshot(),
      sidebarOpen,
      widths: parseWidths(cookie),
    }
  }
)

export interface BotSnapshot {
  state: BotState
  /** `UIMessage[]` as JSON: message parts hold `unknown` tool payloads. */
  messagesJson: string
}

/** A bot's state and chat history for the first paint. */
export const getBotSnapshot = createServerFn()
  .validator((botId: string) => botId)
  .handler(async ({ data: botId }): Promise<BotSnapshot | null> => {
    const viewer = await viewerFromRequest(getRequest())
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      viewer.id
    )
    // The hub checks the bot is the viewer's (looking up an unknown name
    // would create an empty Durable Object) and fetches it next door: one
    // trip from the Worker instead of one per object.
    const snapshot = await hub.botSnapshot(botId)
    if (!snapshot) return null
    return snapshot
  })
