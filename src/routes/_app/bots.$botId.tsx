import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ClientOnly,
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useAgent } from "agents/react"
import { useAgentChat } from "@cloudflare/think/react"
import { Button } from "@cloudflare/kumo/components/button"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { GearSixIcon, ComputerIcon } from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { Composer } from "@/components/composer"
import { ComputerPanel } from "@/components/computer-panel"
import { SidebarToggle } from "@/components/page-header"
import { SettingsPanel } from "@/components/settings-panel"
import { SidePanel } from "@/components/side-panel"
import { useLatchedWhileClosing } from "@/components/slide-shell"
import { SplitView } from "@/components/split-view"
import { Thread } from "@/components/thread"
import { BotContext } from "@/lib/bot-context"
import { cachedBot, rememberBot } from "@/lib/bot-cache"
import { useHub } from "@/lib/hub-context"
import { useLayout } from "@/lib/layout-context"
import { getBotSnapshot } from "@/lib/server-fns"
import { botInstanceName } from "@/lib/types"
import type { UIMessage } from "ai"
import type { BotAgent } from "@/agents/bot-agent"
import type { BrowserNav } from "@/components/computer-card"
import type { OnApproval, OnScriptApproval } from "@/components/thread"
import type { BotState, BotSummary } from "@/lib/types"

interface ApprovalResponse {
  id: string
  approved: boolean
  reason?: string
}

/** The newest reply has a card answered here that the server has not run. */
function batchAnswered(messages: UIMessage[]) {
  const last = messages.at(-1)
  if (last?.role !== "assistant") return false
  return last.parts.some(
    (p) => "state" in p && p.state === "approval-responded"
  )
}

export const Route = createFileRoute("/_app/bots/$botId")({
  loader: async ({ params }) => {
    const cached = cachedBot(params.botId)
    if (cached) return cached
    const snapshot = await getBotSnapshot({ data: params.botId })
    if (!snapshot) throw redirect({ to: "/" })
    return {
      state: snapshot.state,
      messages: JSON.parse(snapshot.messagesJson) as UIMessage[],
    }
  },
  // Chat is live over a WebSocket; refetching history while a bot is open
  // would only race it.
  staleTime: Infinity,
  // Run the loader on every visit: the router's copy is from the first one,
  // and the cache behind the loader is newer.
  gcTime: 0,
  preloadGcTime: 30_000,
  // A bot that is not cached waits on the server. Show it right away.
  pendingMs: 100,
  pendingMinMs: 0,
  pendingComponent: BotPending,
  component: BotRoute,
})

function BotRoute() {
  const { botId } = Route.useParams()
  const snapshot = Route.useLoaderData()
  const fallback = (
    <BotLayout botId={botId} state={snapshot.state} agent={null}>
      <Thread bot={snapshot.state} messages={snapshot.messages} busy={false} />
      <Composer
        botName={snapshot.state.name}
        disabled
        busy={false}
        onSend={() => {}}
        onStop={() => {}}
      />
    </BotLayout>
  )
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        {/* Remount per bot so each gets its own socket and chat state. */}
        <LiveBot
          key={botId}
          botId={botId}
          initialState={snapshot.state}
          initialMessages={snapshot.messages}
        />
      </Suspense>
    </ClientOnly>
  )
}

/** A bot on its way from the server: what the sidebar already knows of it. */
function BotPending() {
  const { botId } = Route.useParams()
  const hub = useHub()
  const bot = hub.state.bots.find((b) => b.id === botId)
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <BotHeader bot={bot} />
      <div className="flex-1" />
      <Composer
        botName={bot?.name ?? ""}
        disabled
        busy={false}
        onSend={() => {}}
        onStop={() => {}}
      />
    </section>
  )
}

function BotHeader({
  bot,
  children,
}: {
  bot?: Pick<BotSummary, "name" | "avatar" | "status">
  children?: React.ReactNode
}) {
  return (
    <header className="col-header relative justify-between">
      <SidebarToggle back />
      {/* The bot's name floats in the middle, like a window title. On a
          phone it sits beside the back button instead. */}
      {bot ? (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 md:absolute md:left-1/2 md:max-w-[50%] md:flex-none md:-translate-x-1/2 md:rounded-full md:bg-kumo-base md:pr-4 md:pl-1.5 md:shadow-[0_0_0_1px_var(--color-kumo-line),0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)]">
          <BotAvatar avatar={bot.avatar} status={bot.status} size={30} />
          <h1 className="truncate text-[15px] font-medium text-kumo-default">
            {bot.name}
          </h1>
        </div>
      ) : null}
      {children}
    </header>
  )
}

function PanelLink({
  to,
  label,
  active,
  botId,
  children,
}: {
  to: "/bots/$botId/computer" | "/bots/$botId/settings"
  label: string
  active: boolean
  botId: string
  children: React.ReactNode
}) {
  return (
    <Tooltip
      content={active ? `Close ${label.toLowerCase()}` : label}
      render={
        <Link
          to={active ? "/bots/$botId" : to}
          params={{ botId }}
          aria-label={label}
          aria-pressed={active}
          className="icon-btn"
        >
          {children}
        </Link>
      }
    />
  )
}

function BotLayout({
  botId,
  state,
  agent,
  children,
}: {
  botId: string
  state: BotState
  agent: ReturnType<typeof useAgent<BotAgent, BotState>> | null
  children: React.ReactNode
}) {
  const matchRoute = useMatchRoute()
  const computerOpen = !!matchRoute({ to: "/bots/$botId/computer" })
  const settingsOpen = !!matchRoute({ to: "/bots/$botId/settings" })
  const panel = computerOpen ? "computer" : settingsOpen ? "settings" : null
  // Keep the closing panel's content on screen while it slides away.
  const shownPanel = useLatchedWhileClosing(panel, panel !== null)
  const { widths, setWidth } = useLayout()
  const navigate = useNavigate()
  const context = useMemo(
    () => ({ botId, state, agent }),
    [botId, state, agent]
  )

  return (
    <BotContext.Provider value={context}>
      <SplitView
        id="bot"
        side="right"
        label={shownPanel === "computer" ? "Computer" : "Settings"}
        open={panel !== null}
        width={widths.panel ?? "44vw"}
        minWidth={360}
        maxWidth="70%"
        mainMinWidth={420}
        onWidthChange={(px) => setWidth("panel", px)}
        onClose={() => void navigate({ to: "/bots/$botId", params: { botId } })}
        panel={
          shownPanel === "computer" ? (
            <ComputerPanel />
          ) : shownPanel === "settings" ? (
            <SidePanel title="Settings">
              <SettingsPanel />
            </SidePanel>
          ) : null
        }
      >
        <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <BotHeader bot={state}>
            <div className="flex items-center gap-1">
              <PanelLink
                to="/bots/$botId/settings"
                label="Settings"
                active={settingsOpen}
                botId={botId}
              >
                <GearSixIcon size={20} />
              </PanelLink>
              <PanelLink
                to="/bots/$botId/computer"
                label="Computer"
                active={computerOpen}
                botId={botId}
              >
                <ComputerIcon size={20} />
              </PanelLink>
            </div>
          </BotHeader>
          {children}
        </section>
      </SplitView>
      {/* Panel routes only exist for their URLs; the panels render above. */}
      <Outlet />
    </BotContext.Provider>
  )
}

function LiveBot({
  botId,
  initialState,
  initialMessages,
}: {
  botId: string
  initialState: BotState
  initialMessages: UIMessage[]
}) {
  const hub = useHub()
  const agent = useAgent<BotAgent, BotState>({
    agent: "bot-agent",
    name: botInstanceName(hub.viewer.id, botId),
  })
  const state = agent.state ?? initialState
  // The loader already has the history, and the socket sends it on connect.
  // By default the hook fetches it a third time and suspends until it lands.
  const chat = useAgentChat({
    agent,
    getInitialMessages: null,
    messages: initialMessages,
  })
  useEffect(() => {
    rememberBot(botId, { state, messages: chat.messages })
  }, [botId, state, chat.messages])
  const paused = hub.state.bots.find((b) => b.id === botId)?.paused === true
  // Every other bot, for @mentions.
  const mentionable = useMemo(
    () => hub.state.bots.filter((b) => b.id !== botId),
    [hub.state.bots, botId]
  )
  const busy = chat.status === "submitted" || chat.status === "streaming"

  // Opening a thread clears its unread dot, including for replies that land
  // while it is open.
  const unread = hub.state.bots.find((b) => b.id === botId)?.unread
  // Where the "New" divider goes: the newest reply, if it was unread when
  // the thread opened. Kept for the visit, so reading it does not move it.
  const [unreadFrom] = useState(() =>
    unread
      ? chat.messages.findLast((m) => m.role === "assistant")?.id
      : undefined
  )
  const { markRead } = hub
  useEffect(() => {
    if (unread) markRead(botId)
  }, [unread, botId, markRead])

  // Quiet hours and the bot's sense of "today" follow the user's clock.
  const timezone = state.proactive?.timezone
  const connected = agent.state !== undefined
  useEffect(() => {
    if (!connected) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone && zone !== timezone) void agent.stub.setTimezone(zone)
  }, [agent, connected, timezone])

  const getLiveView = useCallback(() => agent.stub.getLiveView(), [agent])
  const getBrowserFrame = useCallback(
    (toolCallId: string) => agent.stub.getBrowserFrame(toolCallId),
    [agent]
  )
  const navigateBrowser = useCallback(
    (action: BrowserNav) => agent.stub.navigateBrowser(action),
    [agent]
  )
  const readFile = useCallback(
    (path: string) => agent.stub.readFileData(path),
    [agent]
  )

  // The model can ask (ask_user, a hand-off, an approval) in the same step
  // as a tool that is still running. Answering then makes the server go on
  // mid-stream, and the client loses that tool's result ("No tool invocation
  // found"). Hold answers until the step is over. Once one card of a reply
  // is answered, though, the chat stays busy waiting for the server, which
  // waits for the rest of the cards, so those go straight through.
  const holding = busy && !batchAnswered(chat.messages)
  const holdingRef = useRef(holding)
  holdingRef.current = holding
  const heldAnswers = useRef(new Map<string, ApprovalResponse>())
  const onApproval = useCallback<OnApproval>(
    (id, approved, reason) => {
      if (holdingRef.current) {
        heldAnswers.current.set(id, { id, approved, reason })
      } else void chat.addToolApprovalResponse({ id, approved, reason })
    },
    [chat]
  )
  useEffect(() => {
    if (holding || heldAnswers.current.size === 0) return
    const answers = [...heldAnswers.current.values()]
    heldAnswers.current.clear()
    for (const answer of answers) void chat.addToolApprovalResponse(answer)
  }, [holding, chat])

  const onProvideSecret = useCallback(
    (toolCallId: string, value: string) =>
      agent.stub.provideSecret(toolCallId, value),
    [agent]
  )

  const onAnswerChoice = useCallback(
    (toolCallId: string, option: string) =>
      agent.stub.answerChoice(toolCallId, option),
    [agent]
  )

  const onScriptApproval = useCallback<OnScriptApproval>(
    (approval, approved, all) =>
      agent.stub.answerScriptApproval(
        approval.runId,
        approval.callId,
        approved,
        all
      ),
    [agent]
  )

  const onAttach = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ""
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const { path } = await agent.stub.uploadFile(file.name, btoa(binary))
      return path
    },
    [agent]
  )

  return (
    <BotLayout botId={botId} state={state} agent={agent}>
      <Thread
        bot={state}
        messages={chat.messages}
        busy={busy}
        botId={botId}
        getLiveView={getLiveView}
        getBrowserFrame={getBrowserFrame}
        navigateBrowser={navigateBrowser}
        readFile={readFile}
        onApproval={onApproval}
        onProvideSecret={onProvideSecret}
        onAnswerChoice={onAnswerChoice}
        scriptApprovals={state.scriptApprovals}
        onScriptApproval={onScriptApproval}
        unreadFrom={unreadFrom}
      />
      {chat.error ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-[820px] px-4 pb-2 text-sm text-kumo-danger md:px-6"
        >
          {chat.error.message ||
            "Something went wrong. Try sending that again."}
        </p>
      ) : null}
      {paused ? (
        <div className="mx-auto flex w-full max-w-[820px] items-center justify-between gap-3 px-4 pb-2 text-sm text-kumo-subtle md:px-6">
          <span className="text-pretty">
            Paused. Its routines, check-ins, email, webhooks and messages from
            other bots are skipped.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 rounded-full"
            disabled={!hub.live}
            onClick={() => void hub.setPaused(botId, false)}
          >
            Resume
          </Button>
        </div>
      ) : null}
      <Composer
        botName={state.name}
        busy={busy}
        onSend={(text) =>
          void chat.sendMessage({ text, metadata: { at: Date.now() } })
        }
        onStop={() => void chat.stop()}
        onAttach={onAttach}
        bots={mentionable}
      />
    </BotLayout>
  )
}
