import { useEffect, useMemo, useRef, useState } from "react"
import {
  Link,
  createFileRoute,
  useHydrated,
  useNavigate,
} from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { InboxCheckIcon, PlusIcon } from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { DeskCardView, DoneRow } from "@/components/desk-card"
import { PageHeader } from "@/components/page-header"
import { Sidebar } from "@/components/sidebar"
import { useHub } from "@/lib/hub-context"
import { useIsPhone } from "@/lib/use-is-phone"
import { usePresence } from "@/lib/use-presence"
import type { BotSummary, DeskCard } from "@/lib/types"

export const Route = createFileRoute("/_app/")({
  // `desk` is how a phone reaches the Desk; its `/` is the bot list.
  validateSearch: (search: Record<string, unknown>): { desk?: true } =>
    search.desk === true ? { desk: true } : {},
  component: Home,
})

/** A phone's first screen: the sidebar, as a page of its own. */
function PhoneHome() {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-kumo-canvas pb-(--safe-bottom)">
      <Sidebar home />
    </section>
  )
}

function Home() {
  const { state } = useHub()
  const { desk } = Route.useSearch()
  const phone = useIsPhone()
  const hydrated = useHydrated()
  if (!state.bots.length) return <Onboarding />
  if (desk) return <Desk />
  // The server cannot tell a phone, so it sends both and CSS shows the right
  // one. The Desk only marks cards seen once live, so this first copy cannot.
  if (!hydrated) {
    return (
      <>
        <div className="flex min-w-0 flex-1 md:hidden">
          <PhoneHome />
        </div>
        <div className="flex min-w-0 flex-1 max-md:hidden">
          <Desk />
        </div>
      </>
    )
  }
  return phone ? <PhoneHome /> : <Desk />
}

/** How long a closing card takes to fold away (see .desk-item). */
const EXIT_MS = 360
/** A card the user just answered shows its check mark this long first. */
const ACTED_HOLD_MS = 650
/** "Done while you were away" shows this many before "Show more". */
const DONE_PREVIEW = 5
const UNDO_MS = 5_000

function useNow(enabled: boolean) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

function greeting(hour: number) {
  if (hour < 5) return "Working late"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function firstName(label: string) {
  if (label.includes("@")) return ""
  return label.trim().split(/\s+/)[0] ?? ""
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function summary(needs: number, fyi: number, done: number) {
  const parts = [
    needs ? plural(needs, "thing needs you", "things need you") : "",
    fyi ? plural(fyi, "update from your bots", "updates from your bots") : "",
    done ? `${done} done while you were away` : "",
  ].filter(Boolean)
  if (!parts.length) {
    return "All clear. Your bots will knock when something comes up."
  }
  const last = parts.pop()
  return `${parts.length ? `${parts.join(", ")} and ` : ""}${last}.`
}

function statusLabel(bot: BotSummary) {
  switch (bot.status) {
    case "thinking":
      return "Thinking…"
    case "working":
      return "Working…"
    case "action_needed":
      return "Needs you"
    case "idle":
      return "Keeping an eye on things"
  }
}

/** The bots, faces moving while they work. */
function Team({ bots }: { bots: BotSummary[] }) {
  return (
    <div className="-ml-1 flex flex-wrap items-center gap-1">
      {bots.map((bot) => (
        <Tooltip
          key={bot.id}
          content={`${bot.name} · ${statusLabel(bot)}`}
          render={
            <Link
              to="/bots/$botId"
              params={{ botId: bot.id }}
              aria-label={`${bot.name}: ${statusLabel(bot)}`}
              className="pressable rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
            >
              <BotAvatar
                avatar={bot.avatar}
                status={bot.status}
                size={36}
                interactive
              />
            </Link>
          }
        />
      ))}
    </div>
  )
}

function LaneHeader({
  title,
  count,
  urgent = false,
  onClear,
}: {
  title: string
  count: number
  urgent?: boolean
  onClear?: () => void
}) {
  return (
    <div className="mb-3 flex h-7 items-center gap-2 px-1">
      {urgent ? (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-warning opacity-40 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-kumo-warning" />
        </span>
      ) : null}
      <h2 className="text-sm font-semibold text-kumo-default">{title}</h2>
      <span className="text-sm text-kumo-subtle tabular-nums">{count}</span>
      <span className="flex-1" />
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-1 text-[13px] text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          Clear all
        </button>
      ) : null}
    </div>
  )
}

function Desk() {
  const hub = useHub()
  const hydrated = useHydrated()
  const now = useNow(hydrated)
  // Cards newer than the last visit get a dot; this visit moves the mark.
  const [seenAt] = useState(() => hub.state.deskSeenAt ?? Infinity)
  const [acted, setActed] = useState<Map<string, string>>(new Map())
  const [undo, setUndo] = useState<{
    id: number
    ids: string[]
    label: string
  } | null>(null)
  const [showAllDone, setShowAllDone] = useState(false)

  const live = hub.desk !== null
  const markSeen = useRef(hub.desk?.markSeen)
  markSeen.current = hub.desk?.markSeen
  useEffect(() => {
    if (!live) return
    markSeen.current?.()
    return () => markSeen.current?.()
  }, [live])

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  const cards = hub.state.desk ?? []
  const lanes = useMemo(
    () => ({
      needs: cards.filter((c) => c.lane === "needs_you"),
      fyi: cards.filter((c) => c.lane === "fyi"),
      done: cards.filter((c) => c.lane === "done"),
    }),
    [cards]
  )
  const bots = useMemo(
    () => new Map(hub.state.bots.map((b) => [b.id, b])),
    [hub.state.bots]
  )
  const hold = (card: DeskCard) =>
    acted.has(card.id) ? ACTED_HOLD_MS + EXIT_MS : EXIT_MS
  const needs = usePresence(lanes.needs, hold)
  const fyi = usePresence(lanes.fyi, hold)
  const done = usePresence(
    showAllDone ? lanes.done : lanes.done.slice(0, DONE_PREVIEW),
    hold
  )

  function onActing(card: DeskCard, label: string) {
    setActed((current) => new Map(current).set(card.id, label))
  }

  function onActFailed(card: DeskCard) {
    setActed((current) => {
      const next = new Map(current)
      next.delete(card.id)
      return next
    })
  }

  function dismiss(list: DeskCard[], label: string) {
    if (!hub.desk || !list.length) return
    const ids = list.map((c) => c.id)
    void hub.desk.dismiss(ids)
    setUndo({ id: Date.now(), ids, label })
  }

  function restore() {
    if (!undo || !hub.desk) return
    void hub.desk.restore(undo.ids)
    setUndo(null)
  }

  const hour = now === null ? null : new Date(now).getHours()
  const name = firstName(hub.viewer.label)
  const hello =
    hour === null
      ? "Welcome back"
      : `${greeting(hour)}${name ? `, ${name}` : ""}`
  const empty = !needs.length && !fyi.length && !done.length

  const itemStyle = (index: number, card: DeskCard) =>
    ({
      "--i": index,
      ...(acted.has(card.id) ? { "--exit-delay": `${ACTED_HOLD_MS}ms` } : {}),
    }) as React.CSSProperties

  return (
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader title="Desk" back />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[640px] px-5 pt-6 pb-24 sm:px-6 sm:pt-10">
          <div className="reveal mb-10">
            <div style={{ "--i": 0 } as React.CSSProperties}>
              <Team bots={hub.state.bots} />
            </div>
            <h1
              style={{ "--i": 1 } as React.CSSProperties}
              className="mt-5 text-[28px] leading-tight font-semibold tracking-tight text-balance text-kumo-default"
            >
              {hello}
            </h1>
            <p
              style={{ "--i": 2 } as React.CSSProperties}
              className="mt-1.5 text-[15px] text-pretty text-kumo-subtle"
            >
              {summary(lanes.needs.length, lanes.fyi.length, lanes.done.length)}
            </p>
          </div>

          {needs.length ? (
            <section className="msg-enter mb-10" aria-label="Needs you">
              <LaneHeader title="Needs you" count={lanes.needs.length} urgent />
              <ul>
                {needs.map(({ item, exiting }, index) => (
                  <li
                    key={item.id}
                    className="desk-item"
                    data-exiting={exiting}
                    style={itemStyle(index, item)}
                  >
                    <div>
                      <div className="pb-3">
                        <DeskCardView
                          card={item}
                          bot={bots.get(item.botId)}
                          now={now}
                          isNew={item.createdAt > seenAt}
                          acted={acted.get(item.id)}
                          exiting={exiting}
                          onActing={onActing}
                          onActFailed={onActFailed}
                          onDismiss={(c) => dismiss([c], "Cleared")}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {fyi.length ? (
            <section className="msg-enter mb-10" aria-label="Updates">
              <LaneHeader
                title="Updates"
                count={lanes.fyi.length}
                onClear={
                  lanes.fyi.length > 1
                    ? () =>
                        dismiss(
                          lanes.fyi,
                          `Cleared ${plural(lanes.fyi.length, "update", "updates")}`
                        )
                    : undefined
                }
              />
              <ul>
                {fyi.map(({ item, exiting }, index) => (
                  <li
                    key={item.id}
                    className="desk-item"
                    data-exiting={exiting}
                    style={itemStyle(index + needs.length, item)}
                  >
                    <div>
                      <div className="pb-3">
                        <DeskCardView
                          card={item}
                          bot={bots.get(item.botId)}
                          now={now}
                          isNew={item.createdAt > seenAt}
                          acted={acted.get(item.id)}
                          exiting={exiting}
                          onActing={onActing}
                          onActFailed={onActFailed}
                          onDismiss={(c) => dismiss([c], "Cleared")}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {done.length ? (
            <section
              className="msg-enter mb-10"
              aria-label="Done while you were away"
            >
              <LaneHeader
                title="Done while you were away"
                count={lanes.done.length}
                onClear={() =>
                  dismiss(lanes.done, `Cleared ${lanes.done.length} done`)
                }
              />
              <ul className="overflow-hidden rounded-[20px] border border-kumo-line bg-kumo-base">
                {done.map(({ item, exiting }, index) => (
                  <li
                    key={item.id}
                    className="desk-item"
                    data-exiting={exiting}
                    style={itemStyle(index + needs.length + fyi.length, item)}
                  >
                    <div className={index ? "border-t border-kumo-line" : ""}>
                      <DoneRow
                        card={item}
                        bot={bots.get(item.botId)}
                        now={now}
                        isNew={item.createdAt > seenAt}
                        onDismiss={(c) => dismiss([c], "Cleared")}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {lanes.done.length > DONE_PREVIEW ? (
                <button
                  type="button"
                  onClick={() => setShowAllDone((s) => !s)}
                  className="mt-2 rounded-full px-2 py-1 text-[13px] font-medium text-kumo-subtle outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
                >
                  {showAllDone
                    ? "Show fewer"
                    : `Show ${lanes.done.length - DONE_PREVIEW} more`}
                </button>
              ) : null}
            </section>
          ) : null}

          {empty ? (
            <div className="msg-enter flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-kumo-line px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-(--fill-hover) text-kumo-subtle">
                <InboxCheckIcon size={24} />
              </span>
              <div className="max-w-sm space-y-1.5">
                <p className="text-[15px] font-semibold text-kumo-default">
                  You're all caught up
                </p>
                <p className="text-sm text-pretty text-kumo-subtle">
                  Your bots check in on their own. When something needs your OK,
                  turns up on a check-in, or finishes while you're away, it
                  lands here.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {undo ? (
        <div
          key={undo.id}
          role="status"
          className="desk-toast absolute inset-x-0 bottom-[calc(1.5rem+var(--safe-bottom))] z-10 mx-auto flex w-fit items-center gap-3 rounded-full bg-kumo-contrast py-1.5 pr-1.5 pl-4 text-sm text-kumo-inverse shadow-lg"
        >
          <span>{undo.label}</span>
          <button
            type="button"
            onClick={restore}
            className="pressable rounded-full bg-[color-mix(in_oklch,currentColor_14%,transparent)] px-3 py-1 font-medium outline-none hover:bg-[color-mix(in_oklch,currentColor_22%,transparent)] focus-visible:ring-2 focus-visible:ring-kumo-focus"
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  )
}

function Onboarding() {
  const hub = useHub()
  const navigate = useNavigate()
  const [creating, setCreating] = useState<"blank" | "chief" | null>(null)

  async function create(kind: "blank" | "chief") {
    setCreating(kind)
    try {
      const bot =
        kind === "chief"
          ? await hub.createChiefOfStaff()
          : await hub.createBot()
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } })
    } finally {
      setCreating(null)
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* A phone has no sidebar on screen, so it needs the way to it. */}
      <div className="md:hidden">
        <PageHeader title="Coworkers" />
      </div>
      <div className="reveal flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-(--header-h) text-center">
        <div
          className="flex items-end gap-2"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <BotAvatar avatar="coral-circle" size={56} interactive />
          <BotAvatar avatar="blue-rectangle" size={80} interactive />
          <BotAvatar avatar="green-hexagon" size={56} interactive />
        </div>
        <div
          className="max-w-md space-y-2"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-kumo-default">
            Create your first bot
          </h1>
          <p className="text-[15px] text-pretty text-kumo-subtle">
            A bot is a teammate with its own computer and browser. Tell it what
            the job is and it names itself, remembers how you like things done,
            and keeps working while you're away.
          </p>
        </div>
        <div
          className="flex flex-col items-center gap-3"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <Button
            variant="primary"
            size="lg"
            className="btn-ink rounded-full"
            icon={<PlusIcon />}
            onClick={() => void create("blank")}
            loading={creating === "blank"}
            disabled={!hub.live || creating !== null}
          >
            New bot
          </Button>
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => void create("chief")}
            loading={creating === "chief"}
            disabled={!hub.live || creating !== null}
          >
            Or start with a Chief of Staff who sets up the rest
          </Button>
        </div>
      </div>
    </section>
  )
}
