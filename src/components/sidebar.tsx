import { useEffect, useMemo, useState } from "react"
import {
  Link,
  useHydrated,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  BellIcon,
  BellRingingIcon,
  BellSlashIcon,
  BotIcon,
  GearSixIcon,
  InboxIcon,
  MagnifyingGlassIcon,
  PipelineIcon,
  PlusIcon,
} from "@/components/icons"
import { ApprovalPopover } from "@/components/approval-popover"
import { BotAvatar } from "@/components/bot-avatar"
import { EmptyState } from "@/components/empty-state"
import { ShimmerText } from "@/components/shimmer-text"
import { plainMentions } from "@/lib/bot-links"
import { useHub } from "@/lib/hub-context"
import { usePushNotifications } from "@/lib/push"
import { useIsPhone } from "@/lib/use-is-phone"
import { useSwipeViews } from "@/lib/use-swipe-views"
import type { BotSummary, Pipeline, PipelineRun } from "@/lib/types"

/** Bots large enough to earn the phone home's top row. */
const FEATURED = 3

/** The sidebar's views, left to right. Swiping moves between them. */
const VIEWS = ["bots", "pipelines"] as const
type View = (typeof VIEWS)[number]

const ROW =
  "pressable flex items-center gap-3 rounded-xl px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"

const FOOTER_BUTTON = "icon-btn"

/** Lets bots reach this device when Coworkers is closed. */
function NotificationsButton() {
  const { status, busy, enable, disable, test } = usePushNotifications()
  if (status === "loading" || status === "unsupported") return null

  if (status !== "on") {
    const blocked = status === "denied"
    return (
      <Tooltip
        content={
          blocked
            ? "Notifications are blocked in your browser settings"
            : "Get notified when a bot needs you"
        }
        render={
          <button
            type="button"
            aria-label="Turn on notifications"
            disabled={blocked || busy}
            onClick={() => void enable()}
            className={FOOTER_BUTTON}
          >
            <BellSlashIcon size={18} />
          </button>
        }
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Notifications"
            className={FOOTER_BUTTON}
          >
            <BellIcon size={18} />
          </button>
        )}
      />
      <DropdownMenu.Content side="top" align="end">
        <DropdownMenu.Item
          icon={<BellRingingIcon />}
          onClick={() => void test()}
        >
          Send a test notification
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<BellSlashIcon />}
          onClick={() => void disable()}
        >
          Turn off on this device
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

function formatWhen(timestamp: number, now = new Date()) {
  const date = new Date(timestamp)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  if (timestamp >= startOfToday - 86_400_000) return "Yesterday"
  return date.toLocaleDateString([], { day: "numeric", month: "short" })
}

function previewFor(bot: BotSummary) {
  if (bot.status === "action_needed") return "Needs you to continue"
  if (bot.paused) return "Paused"
  return plainMentions(bot.preview) || "No messages yet"
}

function initials(label: string) {
  const parts = label.split(/[\s@._-]+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  )
}

function BotRow({ bot, active }: { bot: BotSummary; active: boolean }) {
  // The server does not know the viewer's time zone or locale.
  const hydrated = useHydrated()
  const { live } = useHub()
  const row = (
    <Link
      to="/bots/$botId"
      params={{ botId: bot.id }}
      className={`${ROW} ${
        active ? "bg-(--fill-active)" : "hover:bg-(--fill-hover)"
      }`}
    >
      <span className="relative">
        <BotAvatar avatar={bot.avatar} status={bot.status} size={48} />
        {bot.unread && !active ? (
          <span
            className="unread-dot absolute -top-0.5 -right-0.5 size-3 rounded-full bg-kumo-danger ring-2 ring-kumo-canvas"
            aria-label="Unread"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium text-kumo-default">
            {bot.name}
          </span>
          <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
            {hydrated ? formatWhen(bot.updatedAt) : null}
          </span>
        </span>
        {bot.status === "thinking" || bot.status === "working" ? (
          <ShimmerText
            text={bot.status === "working" ? "Working…" : "Thinking…"}
            className="block truncate text-sm"
          />
        ) : (
          <span
            className={`block truncate text-sm ${
              bot.status === "action_needed"
                ? "text-kumo-warning"
                : "text-kumo-subtle"
            }`}
          >
            {previewFor(bot)}
          </span>
        )}
      </span>
    </Link>
  )
  // The open chat shows its own cards.
  return bot.status === "action_needed" && !active && live ? (
    <ApprovalPopover bot={bot}>{row}</ApprovalPopover>
  ) : (
    row
  )
}

/** The Desk: everything the bots brought to you, above the bots themselves. */
function DeskRow() {
  const { state } = useHub()
  const phone = useIsPhone()
  // A phone's `/` is the bot list; its Desk is one step further in.
  const active = useLocation({
    select: (l) => l.pathname === "/" && (!phone || l.search.desk === true),
  })
  const desk = state.desk ?? []
  const needs = desk.filter((c) => c.lane === "needs_you").length
  const seenAt = state.deskSeenAt ?? Infinity
  const fresh = desk.filter((c) => c.createdAt > seenAt).length
  const subtitle = needs
    ? `${needs} ${needs === 1 ? "thing needs" : "things need"} you`
    : fresh
      ? `${fresh} new`
      : desk.length
        ? "Nothing urgent"
        : "All clear"
  return (
    <Link
      to="/"
      search={phone ? { desk: true } : {}}
      className={`${ROW} ${active ? "bg-(--fill-active)" : "hover:bg-(--fill-hover)"}`}
    >
      <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--fill-hover) text-kumo-default">
        <InboxIcon size={22} />
        {needs ? (
          <span
            className="unread-dot absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-kumo-warning px-1.5 text-[11px] font-semibold text-white tabular-nums ring-2 ring-kumo-canvas"
            aria-hidden="true"
          >
            {needs}
          </span>
        ) : fresh && !active ? (
          <span
            className="unread-dot absolute -top-0.5 -right-0.5 size-3 rounded-full bg-kumo-danger ring-2 ring-kumo-canvas"
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-kumo-default">
          Desk
        </span>
        <span
          className={`block truncate text-sm ${
            needs ? "text-kumo-warning" : "text-kumo-subtle"
          }`}
        >
          {subtitle}
        </span>
      </span>
    </Link>
  )
}

/** A search pill with a round action button tucked in at the end. */
function SearchPill({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  children: React.ReactNode
}) {
  return (
    // The 28px button sits 4px inside the 36px pill.
    <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-(--fill-hover) pr-1 pl-3 text-kumo-subtle focus-within:ring-2 focus-within:ring-kumo-focus">
      <MagnifyingGlassIcon size={16} className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search"
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"
      />
      {children}
    </div>
  )
}

/** The phone home's top row: the first bots, large, like a contacts strip. */
function FeaturedBots({ bots }: { bots: BotSummary[] }) {
  return (
    <ul className="grid grid-cols-3 gap-1 px-1 pt-3 pb-2">
      {bots.map((bot) => (
        <li key={bot.id}>
          <Link
            to="/bots/$botId"
            params={{ botId: bot.id }}
            className="pressable flex flex-col items-center gap-2 rounded-2xl p-2 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
          >
            <span className="relative">
              <BotAvatar avatar={bot.avatar} status={bot.status} size={72} />
              {bot.unread || bot.status === "action_needed" ? (
                <span
                  className={`unread-dot absolute top-0 right-0 size-3.5 rounded-full ring-2 ring-kumo-canvas ${
                    bot.status === "action_needed"
                      ? "bg-kumo-warning"
                      : "bg-kumo-danger"
                  }`}
                  aria-label={
                    bot.status === "action_needed" ? "Needs you" : "Unread"
                  }
                />
              ) : null}
            </span>
            <span className="max-w-full truncate text-[13px] text-kumo-subtle">
              {bot.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function BotsView({ home }: { home: boolean }) {
  const hub = useHub()
  const navigate = useNavigate()
  const { botId } = useParams({ strict: false })
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)

  const bots = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return hub.state.bots
    return hub.state.bots.filter(
      (b) =>
        b.name.toLowerCase().includes(needle) ||
        b.preview.toLowerCase().includes(needle)
    )
  }, [hub.state.bots, query])

  // Only worth a strip when the list still has rows left under it.
  const featured =
    home && !query && bots.length > FEATURED ? bots.slice(0, FEATURED) : []

  async function createBot() {
    setCreating(true)
    try {
      const bot = await hub.createBot()
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } })
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="col-header">
        <SearchPill value={query} onChange={setQuery} label="Search bots">
          <Tooltip
            content="New bot"
            render={
              <button
                type="button"
                aria-label="New bot"
                onClick={() => void createBot()}
                disabled={!hub.live || creating}
                className="icon-btn size-7! hover:bg-(--fill-active)!"
              >
                {creating ? <Loader size="sm" /> : <PlusIcon size={16} />}
              </button>
            }
          />
        </SearchPill>
      </div>

      <nav
        aria-label="Bots"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-(--inset) pt-1"
      >
        {featured.length ? <FeaturedBots bots={featured} /> : null}
        {!query && hub.state.bots.length ? (
          <>
            <DeskRow />
            <div className="mx-2.5 my-1 h-px bg-kumo-line" />
          </>
        ) : null}
        {bots.slice(featured.length).map((bot) => (
          <BotRow key={bot.id} bot={bot} active={bot.id === botId} />
        ))}
        {bots.length === 0 ? (
          <p className="px-2.5 py-6 text-sm text-kumo-subtle">
            {query ? "No bots match that search." : "No bots yet."}
          </p>
        ) : null}
      </nav>
    </>
  )
}

/** One face for a lone bot, two overlapping for a chain. */
function PipelineFaces({
  bots,
  workingId,
}: {
  bots: BotSummary[]
  workingId?: string
}) {
  const status = (b: BotSummary) => (b.id === workingId ? "working" : "idle")
  if (bots.length === 0) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--fill-hover) text-kumo-subtle">
        <PipelineIcon size={22} />
      </span>
    )
  }
  if (bots.length === 1) {
    return (
      <BotAvatar avatar={bots[0].avatar} status={status(bots[0])} size={48} />
    )
  }
  return (
    <span className="relative size-12 shrink-0">
      <span className="absolute top-0 left-0">
        <BotAvatar avatar={bots[0].avatar} status={status(bots[0])} size={32} />
      </span>
      <span className="absolute right-0 bottom-0">
        <BotAvatar avatar={bots[1].avatar} status={status(bots[1])} size={32} />
      </span>
    </span>
  )
}

function PipelineRow({
  pipeline,
  run,
  active,
}: {
  pipeline: Pipeline
  run?: PipelineRun
  active: boolean
}) {
  const hydrated = useHydrated()
  const { state } = useHub()
  const botFor = (id: string) => state.bots.find((b) => b.id === id)
  const bots = [
    ...new Set(
      pipeline.steps.flatMap((s) => (s.kind === "bot" ? s.botId : []))
    ),
  ].flatMap((id) => botFor(id) ?? [])
  const chain = pipeline.steps
    .map((s) =>
      s.kind === "approval" ? "You" : (botFor(s.botId)?.name ?? "Deleted bot")
    )
    .join(" → ")

  const runningIndex =
    run?.status === "running"
      ? run.steps.findIndex((s) => s.status === "running")
      : -1
  const runningStep = runningIndex === -1 ? undefined : run?.plan[runningIndex]
  const workingId = runningStep?.kind === "bot" ? runningStep.botId : undefined
  const workingName = run?.steps[runningIndex]?.botName

  let subtitle: React.ReactNode
  if (run?.status === "running") {
    subtitle = (
      <ShimmerText
        text={workingName ? `${workingName} is working…` : "Running…"}
        className="block truncate text-sm"
      />
    )
  } else if (run?.status === "waiting") {
    subtitle = (
      <span className="block truncate text-sm text-kumo-warning">
        Needs your OK to continue
      </span>
    )
  } else if (run?.status === "failed") {
    subtitle = (
      <span className="block truncate text-sm text-kumo-danger">
        Last run failed
      </span>
    )
  } else {
    subtitle = (
      <span className="block truncate text-sm text-kumo-subtle">
        {chain}
        {pipeline.cron ? " · Scheduled" : ""}
      </span>
    )
  }

  return (
    <Link
      to="/pipelines/$pipelineId"
      params={{ pipelineId: pipeline.id }}
      className={`${ROW} ${
        active ? "bg-(--fill-active)" : "hover:bg-(--fill-hover)"
      }`}
    >
      <PipelineFaces bots={bots} workingId={workingId} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium text-kumo-default">
            {pipeline.name}
          </span>
          <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
            {hydrated && run ? formatWhen(run.startedAt) : null}
          </span>
        </span>
        {subtitle}
      </span>
    </Link>
  )
}

function PipelinesView() {
  const { state } = useHub()
  const { pipelineId } = useParams({ strict: false })
  const [query, setQuery] = useState("")
  const runs = state.pipelineRuns ?? []

  const pipelines = useMemo(() => {
    const all = state.pipelines ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((p) => p.name.toLowerCase().includes(needle))
  }, [state.pipelines, query])

  return (
    <>
      <div className="col-header">
        <SearchPill value={query} onChange={setQuery} label="Search pipelines">
          <Tooltip
            content="New pipeline"
            render={
              <Link
                to="/pipelines/$pipelineId"
                params={{ pipelineId: "new" }}
                aria-label="New pipeline"
                className="icon-btn size-7! hover:bg-(--fill-active)!"
              >
                <PlusIcon size={16} />
              </Link>
            }
          />
        </SearchPill>
      </div>

      <nav
        aria-label="Pipelines"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-(--inset) pt-1"
      >
        {pipelines.map((p) => (
          <PipelineRow
            key={p.id}
            pipeline={p}
            run={runs.find((r) => r.pipelineId === p.id)}
            active={p.id === pipelineId}
          />
        ))}
        {pipelines.length === 0 && query ? (
          <p className="px-2.5 py-6 text-sm text-kumo-subtle">
            No pipelines match that search.
          </p>
        ) : null}
        {(state.pipelines ?? []).length === 0 ? (
          <EmptyState
            className="pt-16"
            icon={<PipelineIcon size={24} />}
            title="Chain your bots together"
            description="Each bot picks up where the last one left off, and you can sign off before anything goes out."
            action={
              <Link
                to="/pipelines/$pipelineId"
                params={{ pipelineId: "new" }}
                className="pressable btn-ink inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
              >
                <PlusIcon size={14} />
                New pipeline
              </Link>
            }
          />
        ) : null}
      </nav>
    </>
  )
}

/** `home`: filling a phone's home page, not sitting beside the content. */
export function Sidebar({ home = false }: { home?: boolean }) {
  const hub = useHub()
  const phone = useIsPhone()
  const section = useLocation({
    select: (l) => (l.pathname.startsWith("/pipelines") ? "pipelines" : "bots"),
  })
  const [view, setView] = useState<View>(section)
  // Follow the page when it moves to the other section (a link, a push
  // notification), but leave the user's own choice alone otherwise.
  useEffect(() => setView(section), [section])

  const index = VIEWS.indexOf(view)
  const onPipelines = view === "pipelines"
  const swipe = useSwipeViews({
    index,
    count: VIEWS.length,
    onChange: (i) => setView(VIEWS[i]),
  })
  const waiting = (hub.state.pipelineRuns ?? []).some(
    (r) => r.status === "waiting"
  )

  return (
    // The whole sidebar takes swipes, footer and gaps included. On a phone a
    // sideways swipe closes the drawer instead; the footer button switches.
    <aside
      ref={phone ? undefined : swipe.viewportRef}
      className="flex h-full w-full touch-pan-y flex-col"
    >
      <div className="sidebar-views">
        <div
          ref={swipe.trackRef}
          className="sidebar-track"
          style={{ "--view": index } as React.CSSProperties}
        >
          {/* The view off to the side stays out of the tab order. */}
          <div className="sidebar-view" inert={view !== "bots"}>
            <BotsView home={home} />
          </div>
          <div className="sidebar-view" inert={!onPipelines}>
            <PipelinesView />
          </div>
        </div>
      </div>

      {/* Same row as the search bar at the top: --header-h tall, --inset
          from the edges, the avatar where the search icon sits. */}
      <div className="col-header pl-4">
        <span className="flex shrink-0">
          {hub.viewer.avatarUrl ? (
            <img
              src={hub.viewer.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded-full bg-kumo-fill object-cover outline outline-1 -outline-offset-1 outline-black/10"
            />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full bg-kumo-fill text-[11px] font-medium text-kumo-subtle">
              {initials(hub.viewer.label)}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          {hub.viewer.label}
        </span>
        <div className="flex items-center gap-1">
          <NotificationsButton />
          {/* Toggles the sidebar; the icon shows where it goes next. */}
          <Tooltip
            content={onPipelines ? "Bots" : "Pipelines"}
            render={
              <button
                type="button"
                aria-label={onPipelines ? "Show bots" : "Show pipelines"}
                onClick={() => setView(onPipelines ? "bots" : "pipelines")}
                className={`${FOOTER_BUTTON} relative`}
              >
                <span
                  className="t-icon-swap"
                  data-state={onPipelines ? "b" : "a"}
                >
                  <PipelineIcon size={20} className="t-icon" data-icon="a" />
                  <BotIcon size={20} className="t-icon" data-icon="b" />
                </span>
                {waiting && !onPipelines ? (
                  <span
                    className="unread-dot absolute top-1 right-1 size-2.5 rounded-full bg-kumo-warning ring-2 ring-kumo-canvas"
                    aria-label="A pipeline needs your OK"
                  />
                ) : null}
              </button>
            }
          />
          <Tooltip
            content="Settings"
            render={
              <Link to="/settings" aria-label="Settings" className="icon-btn">
                <GearSixIcon size={20} />
              </Link>
            }
          />
        </div>
      </div>
    </aside>
  )
}
