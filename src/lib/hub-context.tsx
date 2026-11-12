import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useAgent } from "agents/react"
import { syncBotSummaries } from "@/lib/bot-cache"
import { listSharedBots } from "@/lib/sharing-fns"
import type { ReactNode } from "react"
import type { UIMessage } from "ai"
import type {
  BotSummary,
  SharedBotSummary,
  Connection,
  ConnectionTool,
  HubState,
  InstalledSkill,
  Pipeline,
  PipelineDraft,
  PipelineRun,
  PushSubscriptionData,
  ScriptApproval,
  SkillInstallRequest,
  SkillPreview,
} from "@/lib/types"
import type { ModelSettings, ModelTestResult } from "@/lib/models"
import type {
  ShopCheckout,
  ShopProduct,
  ShopQuery,
  ShopSearchResult,
} from "@/lib/shop"
import type { Viewer } from "@/lib/server-fns"
import type { UserHub } from "@/agents/user-hub"

export interface NewConnection {
  name: string
  url: string
  headers?: Record<string, string>
}

interface HubContextValue {
  viewer: Viewer
  state: HubState
  sharedBots: SharedBotSummary[]
  sharedBotsError: string | null
  /** False during SSR and until the WebSocket has delivered state. */
  live: boolean
  createBot: () => Promise<BotSummary>
  deleteBot: (botId: string) => Promise<void>
  /** A bot that sets up and runs the others (onboarding). */
  createChiefOfStaff: () => Promise<BotSummary>
  /** Paused bots skip routines, check-ins, email, webhooks and bot messages. */
  setPaused: (botId: string, paused: boolean) => Promise<void>
  markRead: (botId: string) => void
  /** A bot's newest reply, cut to the parts that wait on the user. */
  waitingParts: (botId: string) => Promise<UIMessage | null>
  answerApproval: (
    botId: string,
    approvalId: string,
    approved: boolean
  ) => Promise<void>
  /** A bot's script app calls waiting on the user. */
  waitingScripts: (botId: string) => Promise<ScriptApproval[]>
  answerScriptApproval: (
    botId: string,
    approval: ScriptApproval,
    approved: boolean,
    all?: boolean
  ) => Promise<void>
  /** Read what a pasted command or link points at. Saves nothing. */
  previewSkill: (source: string) => Promise<SkillPreview>
  installSkills: (request: SkillInstallRequest) => Promise<InstalledSkill[]>
  removeSkill: (name: string, botId?: string) => Promise<void>
  addConnection: (input: NewConnection) => Promise<Connection>
  removeConnection: (connectionId: string) => Promise<void>
  refreshConnections: () => void
  reconnect: (connectionId: string) => Promise<void>
  /** A sign-in link made just now, or null if none is needed any more. */
  freshSignIn: (connectionId: string) => Promise<string | null>
  connectionTools: (connectionId: string) => Promise<ConnectionTool[]>
  push: PushApi | null
  /** Memory all bots read. Null until the hub WebSocket is up. */
  sharedMemory: SharedMemoryApi | null
  /** Which models bots use. Null until the hub WebSocket is up. */
  models: ModelsApi | null
  /** Chains of bots. Null until the hub WebSocket is up. */
  pipelines: PipelinesApi | null
  /** Read the newest AI Gateway logs now. Null until the hub WebSocket is up. */
  refreshSpend: (() => Promise<void>) | null
  /** The Desk's cards. Null until the hub WebSocket is up. */
  desk: DeskApi | null
  /**
   * Shop, for cards that fetch on their own. Null until the hub WebSocket
   * is up; stable while it stays up, so effects can depend on it.
   */
  shop: ShopApi | null
}

export interface ShopApi {
  /** The next page of a search, with the same query. */
  more: (query: ShopQuery, cursor: string) => Promise<ShopSearchResult>
  /** A product, with the variant for the chosen options. */
  product: (
    productId: string,
    selected: { name: string; label: string }[],
    country?: string
  ) => Promise<ShopProduct>
  /** A checkout as Shop has it now, to see whether it was paid. */
  checkout: (shop: string, id: string, store: string) => Promise<ShopCheckout>
}

export interface DeskApi {
  /** Press a card's button (approve, reject). */
  act: (cardId: string, actionId: string) => Promise<void>
  dismiss: (cardIds: string[]) => Promise<void>
  restore: (cardIds: string[]) => Promise<void>
  markSeen: () => void
}

export interface PipelinesApi {
  save: (input: PipelineDraft & { id?: string }) => Promise<Pipeline>
  remove: (pipelineId: string) => Promise<void>
  run: (pipelineId: string, input?: string) => Promise<PipelineRun>
  answer: (runId: string, approved: boolean) => Promise<void>
  stop: (runId: string) => Promise<void>
  /** A step's full result; state only carries the start of it. */
  output: (runId: string, step: number) => Promise<string | null>
}

export interface ModelsApi {
  set: (patch: Partial<ModelSettings>) => Promise<void>
  test: (modelId: string) => Promise<ModelTestResult>
}

export interface MemoryRevision {
  id: number
  at: number
  source: string
}

export interface SharedMemoryApi {
  get: () => Promise<{ content: string; revisions: MemoryRevision[] }>
  set: (content: string) => Promise<void>
  restore: (revisionId: number) => Promise<void>
}

/** Web Push via the UserHub. Null until the hub WebSocket is up. */
export interface PushApi {
  publicKey: () => Promise<string | null>
  subscribe: (subscription: PushSubscriptionData) => Promise<void>
  unsubscribe: (endpoint: string) => Promise<void>
  isSubscribed: (endpoint: string) => Promise<boolean>
  test: () => Promise<{ sent: number }>
}

const HubContext = createContext<HubContextValue | null>(null)

export function useHub() {
  const value = useContext(HubContext)
  if (!value) throw new Error("useHub must be used inside a HubProvider")
  return value
}

/** The hub where there may be none, for components used outside the app shell. */
export function useOptionalHub() {
  return useContext(HubContext)
}

interface ProviderProps {
  viewer: Viewer
  initial: HubState
  initialShared?: SharedBotSummary[]
  children: ReactNode
}

function notConnected(): never {
  throw new Error("Not connected yet")
}

/** Server render and pre-hydration: loader data, no socket. */
export function StaticHubProvider({
  viewer,
  initial,
  initialShared = [],
  children,
}: ProviderProps) {
  const value = useMemo<HubContextValue>(
    () => ({
      viewer,
      state: initial,
      sharedBots: initialShared,
      sharedBotsError: null,
      live: false,
      createBot: notConnected,
      deleteBot: notConnected,
      createChiefOfStaff: notConnected,
      setPaused: notConnected,
      markRead: () => {},
      waitingParts: notConnected,
      answerApproval: notConnected,
      waitingScripts: notConnected,
      previewSkill: notConnected,
      installSkills: notConnected,
      removeSkill: notConnected,
      answerScriptApproval: notConnected,
      addConnection: notConnected,
      removeConnection: notConnected,
      refreshConnections: () => {},
      reconnect: notConnected,
      freshSignIn: notConnected,
      connectionTools: notConnected,
      push: null,
      sharedMemory: null,
      models: null,
      pipelines: null,
      refreshSpend: null,
      desk: null,
      shop: null,
    }),
    [viewer, initial, initialShared]
  )
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}

/** Browser only: a WebSocket to the user's UserHub keeps the sidebar live. */
export function LiveHubProvider({
  viewer,
  initial,
  initialShared = [],
  children,
}: ProviderProps) {
  const agent = useAgent<UserHub, HubState>({
    agent: "user-hub",
    name: viewer.id,
  })
  const state = agent.state ?? initial
  const [sharedBots, setSharedBots] = useState(initialShared)
  const [sharedBotsError, setSharedBotsError] = useState<string | null>(null)

  // Incoming shares belong to other hubs. Refresh their authorized summaries,
  // without joining another owner's socket or polluting our personal bot state.
  useEffect(() => {
    if (!viewer.email) return
    let cancelled = false
    let running = false
    async function refresh() {
      if (running || document.visibilityState === "hidden") return
      running = true
      try {
        const bots = await listSharedBots()
        if (!cancelled) {
          setSharedBots(bots)
          setSharedBotsError(null)
        }
      } catch {
        if (!cancelled) {
          setSharedBots([])
          setSharedBotsError(
            "Shared bots are temporarily unavailable. Retrying…"
          )
        }
      } finally {
        running = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [viewer.id, viewer.email])

  useEffect(() => {
    syncBotSummaries(state.bots)
  }, [state.bots])

  const live = agent.state !== undefined
  const shop = useMemo<ShopApi | null>(
    () =>
      live
        ? {
            more: (query, cursor) => agent.stub.moreShopResults(query, cursor),
            product: (productId, selected, country) =>
              agent.stub.viewProduct(productId, selected, country),
            checkout: (shopDomain, id, store) =>
              agent.stub.refreshCheckout(shopDomain, id, store),
          }
        : null,
    [agent, live]
  )

  const value = useMemo<HubContextValue>(
    () => ({
      viewer,
      state,
      sharedBots,
      sharedBotsError,
      live: agent.state !== undefined,
      createBot: () => agent.stub.createBot(),
      deleteBot: (botId) => agent.stub.deleteBot(botId),
      createChiefOfStaff: () => agent.stub.createChiefOfStaff(),
      setPaused: (botId, paused) =>
        paused ? agent.stub.pauseBot(botId) : agent.stub.resumeBot(botId),
      markRead: (botId) => void agent.stub.markRead(botId),
      waitingParts: (botId) => agent.stub.waitingParts(botId),
      answerApproval: (botId, approvalId, approved) =>
        agent.stub.answerApproval(botId, approvalId, approved),
      waitingScripts: (botId) => agent.stub.waitingScripts(botId),
      answerScriptApproval: (botId, approval, approved, all) =>
        agent.stub.answerScriptApproval(
          botId,
          approval.runId,
          approval.callId,
          approved,
          all
        ),
      previewSkill: (source) => agent.stub.previewSkill(source),
      installSkills: (request) => agent.stub.installSkills(request),
      removeSkill: (name, botId) => agent.stub.removeSkill(name, botId),
      addConnection: (input) => agent.stub.addConnection(input),
      removeConnection: (id) => agent.stub.removeConnection(id),
      refreshConnections: () => void agent.stub.refreshConnections(),
      reconnect: (id) => agent.stub.reconnect(id),
      freshSignIn: (id) => agent.stub.freshSignIn(id),
      connectionTools: (id) => agent.stub.connectionTools(id),
      push:
        agent.state !== undefined
          ? {
              publicKey: () => agent.stub.pushPublicKey(),
              subscribe: (subscription) =>
                agent.stub.subscribePush(subscription),
              unsubscribe: (endpoint) => agent.stub.unsubscribePush(endpoint),
              isSubscribed: (endpoint) => agent.stub.isPushSubscribed(endpoint),
              test: () => agent.stub.testPush(),
            }
          : null,
      sharedMemory:
        agent.state !== undefined
          ? {
              get: () => agent.stub.getSharedMemory(),
              set: (content) => agent.stub.setSharedMemory(content),
              restore: (id) => agent.stub.restoreSharedMemory(id),
            }
          : null,
      models:
        agent.state !== undefined
          ? {
              set: (patch) => agent.stub.setModels(patch),
              test: (modelId) => agent.stub.testModel(modelId),
            }
          : null,
      pipelines:
        agent.state !== undefined
          ? {
              save: (input) => agent.stub.savePipeline(input),
              remove: (id) => agent.stub.deletePipeline(id),
              run: (id, input) => agent.stub.runPipeline(id, input),
              answer: (runId, approved) =>
                agent.stub.answerPipelineStep(runId, approved),
              stop: (runId) => agent.stub.stopPipelineRun(runId),
              output: (runId, step) => agent.stub.pipelineOutput(runId, step),
            }
          : null,
      refreshSpend:
        agent.state !== undefined ? () => agent.stub.refreshSpend() : null,
      desk:
        agent.state !== undefined
          ? {
              act: (cardId, actionId) => agent.stub.actOnCard(cardId, actionId),
              dismiss: (ids) => agent.stub.dismissCards(ids),
              restore: (ids) => agent.stub.restoreCards(ids),
              markSeen: () => void agent.stub.markDeskSeen(),
            }
          : null,
      shop,
    }),
    [viewer, state, agent, shop, sharedBots, sharedBotsError]
  )
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}
