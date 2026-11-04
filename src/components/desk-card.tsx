import { useLayoutEffect, useRef, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import {
  AppWindowIcon,
  ArrowRightIcon,
  BotIcon,
  CaretDownIcon,
  CheckIcon,
  ClockIcon,
  CrawlIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  GearSixIcon,
  MessageIcon,
  PipelineIcon,
  PlugsConnectedIcon,
  TerminalIcon,
  WebhooksLogoIcon,
} from "@/components/icons"
import type { IconProps } from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { ArgsView } from "@/components/call-preview"
import { Prose } from "@/components/thread"
import { useHub } from "@/lib/hub-context"
import type { BotSummary, DeskAction, DeskCard, DeskOrigin } from "@/lib/types"

const ORIGIN_ICONS: Record<DeskOrigin, React.ComponentType<IconProps>> = {
  "check-in": EyeIcon,
  routine: ClockIcon,
  email: EnvelopeSimpleIcon,
  webhook: WebhooksLogoIcon,
  app: AppWindowIcon,
  crawl: CrawlIcon,
  script: TerminalIcon,
  bot: BotIcon,
  pipeline: PipelineIcon,
  chat: MessageIcon,
  settings: GearSixIcon,
  agent: PlugsConnectedIcon,
}

/** "just now", "12m", "3h", "Yesterday", "3 Oct". */
export function ago(ms: number, now: number) {
  const minutes = Math.floor((now - ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  if (hours < 48) return "Yesterday"
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" })
}

/** "Just asked", "Waiting 12m", "Waiting since yesterday". */
function waitingFor(ms: number, now: number) {
  const since = ago(ms, now)
  if (since === "just now") return "Just asked"
  if (/^\d+[mh]$/.test(since)) return `Waiting ${since}`
  return `Waiting since ${since === "Yesterday" ? "yesterday" : since}`
}

/** What the card's check mark says once a button worked. */
export function actedLabel(action: DeskAction) {
  switch (action.kind) {
    case "approve":
      return "Approved"
    case "approve_all":
      return "Approved for this run"
    case "reject":
      return "Skipped"
    case "open_chat":
      return ""
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function SourceChip({ label, url }: { label: string; url: string }) {
  const host = hostOf(url)
  const [iconFailed, setIconFailed] = useState(false)
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className="pressable inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-(--fill-hover) px-2.5 text-[13px] text-kumo-default outline-none hover:bg-(--fill-active) focus-visible:ring-2 focus-visible:ring-kumo-focus"
    >
      {iconFailed ? null : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setIconFailed(true)}
          className="size-3.5 shrink-0 rounded-[3px]"
        />
      )}
      <span className="truncate">{label === url ? host : label}</span>
    </a>
  )
}

/** A long finding shows its start, then opens to its full height. */
function Found({ text }: { text: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<number | null>(null)
  const COLLAPSED = 132

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setFull(el.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  const long = full !== null && full > COLLAPSED + 24
  return (
    <div className="mt-3 [&_.bubble-prose]:text-[14px] [&_.bubble-prose]:leading-[1.6] [&_.bubble-prose]:text-kumo-strong">
      <div
        className="desk-clamp"
        data-open={!long || open}
        style={{
          maxHeight: long
            ? open
              ? (full ?? undefined)
              : COLLAPSED
            : undefined,
        }}
      >
        <div ref={inner}>
          <Prose text={text} />
        </div>
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-[13px] font-medium text-kumo-subtle outline-none hover:text-kumo-default focus-visible:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  )
}

/** A finding that only repeats the title is not shown twice. */
function worthShowing(card: DeskCard) {
  const found = card.found.replace(/[`*_#>[\]()]/g, "").trim()
  return found !== "" && found !== card.title
}

interface CardProps {
  card: DeskCard
  bot: BotSummary | undefined
  now: number | null
  isNew: boolean
  /** The label of the button just pressed, for the check mark. */
  acted: string | undefined
  /** Folding away: the press went through, or it was answered elsewhere. */
  exiting: boolean
  /** Called before the request, so the card holds its check mark even
   * when the hub's update lands first. */
  onActing: (card: DeskCard, label: string) => void
  onActFailed: (card: DeskCard) => void
  onDismiss: (card: DeskCard) => void
}

/** One card: who, what, why, what was found, and what to do about it. */
export function DeskCardView({
  card,
  bot,
  now,
  isNew,
  acted,
  exiting,
  onActing,
  onActFailed,
  onDismiss,
}: CardProps) {
  const hub = useHub()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const OriginIcon = ORIGIN_ICONS[card.origin]
  const waiting = card.lane === "needs_you"
  const openChat = () =>
    void navigate({ to: "/bots/$botId", params: { botId: card.botId } })

  async function press(action: DeskAction) {
    if (action.kind === "open_chat") return openChat()
    if (!hub.desk) return
    setBusy(action.id)
    setError(null)
    onActing(card, actedLabel(action))
    try {
      await hub.desk.act(card.id, action.id)
    } catch (err) {
      onActFailed(card)
      setError(err instanceof Error ? err.message : "That did not go through.")
    } finally {
      setBusy(null)
    }
  }

  const [primary, ...rest] = card.actions
  const hasChatButton = card.actions.some((a) => a.kind === "open_chat")

  return (
    <article className="rounded-card border border-kumo-line bg-kumo-base p-4 sm:px-5">
      <header className="flex h-8 items-center gap-2">
        <Link
          to="/bots/$botId"
          params={{ botId: card.botId }}
          className="pressable -ml-1 flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 pl-1 outline-none hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          {bot ? (
            <BotAvatar avatar={bot.avatar} status={bot.status} size={26} />
          ) : null}
          <span className="truncate text-[13px] font-medium text-kumo-default">
            {bot?.name ?? "A bot"}
          </span>
        </Link>
        {now !== null ? (
          <span
            className={`shrink-0 text-[13px] tabular-nums ${
              waiting ? "text-kumo-warning" : "text-kumo-subtle"
            }`}
          >
            {waiting
              ? waitingFor(card.createdAt, now)
              : ago(card.createdAt, now)}
          </span>
        ) : null}
        {isNew ? (
          <span
            className="unread-dot size-1.5 shrink-0 rounded-full bg-kumo-brand"
            aria-label="New"
          />
        ) : null}
      </header>

      <h3 className="mt-2.5 text-[16px] leading-snug font-semibold text-pretty text-kumo-default">
        {card.title}
      </h3>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-kumo-subtle">
        <OriginIcon size={14} className="shrink-0" />
        <span className="truncate">{card.why}</span>
      </p>

      {card.found && worthShowing(card) ? <Found text={card.found} /> : null}
      {card.detail ? (
        <div className="mt-3">
          <ArgsView json={card.detail} tool={card.tool} compact />
        </div>
      ) : null}

      {card.sources.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.sources.map((s) => (
            <SourceChip key={s.url} {...s} />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex min-h-8 flex-wrap items-center gap-2">
        {acted && (exiting || busy === null) ? (
          <span className="desk-check inline-flex items-center gap-1.5 text-sm font-medium text-kumo-success">
            <CheckIcon size={16} />
            {acted}
          </span>
        ) : (
          <>
            {primary ? (
              <Button
                size="sm"
                variant={waiting ? "primary" : "outline"}
                className={`rounded-full ${waiting ? "btn-ink" : ""}`}
                disabled={
                  busy !== null || (!hub.desk && primary.kind !== "open_chat")
                }
                loading={busy === primary.id}
                onClick={() => void press(primary)}
              >
                {primary.label}
                {primary.kind === "open_chat" ? (
                  <ArrowRightIcon size={14} />
                ) : null}
              </Button>
            ) : null}
            {rest.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.kind === "reject" ? "ghost" : "outline"}
                className="rounded-full"
                disabled={busy !== null || !hub.desk}
                loading={busy === action.id}
                onClick={() => void press(action)}
              >
                {action.label}
              </Button>
            ))}
            {!waiting ? (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => onDismiss(card)}
              >
                Got it
              </Button>
            ) : null}
            {waiting && !hasChatButton ? (
              <Link
                to="/bots/$botId"
                params={{ botId: card.botId }}
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-kumo-subtle outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
              >
                Open chat
                <ArrowRightIcon size={14} />
              </Link>
            ) : null}
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-kumo-danger">
          {error}
        </p>
      ) : null}
    </article>
  )
}

/** "Done while you were away": one line each, opening to the full report. */
export function DoneRow({
  card,
  bot,
  now,
  isNew,
  onDismiss,
}: {
  card: DeskCard
  bot: BotSummary | undefined
  now: number | null
  isNew: boolean
  onDismiss: (card: DeskCard) => void
}) {
  const [open, setOpen] = useState(false)
  const OriginIcon = ORIGIN_ICONS[card.origin]
  return (
    <div className="t-acc" data-open={open}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
      >
        <span className="relative shrink-0">
          {bot ? (
            <BotAvatar avatar={bot.avatar} status={bot.status} size={28} />
          ) : null}
          {isNew ? (
            <span
              className="unread-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-kumo-brand ring-2 ring-kumo-base"
              aria-label="New"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-kumo-default">
            {card.title}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-kumo-subtle">
            <OriginIcon size={12} className="shrink-0" />
            <span className="truncate">
              {bot?.name ? `${bot.name} · ` : ""}
              {card.why}
            </span>
          </span>
        </span>
        {now !== null ? (
          <span className="shrink-0 text-[12px] text-kumo-subtle tabular-nums">
            {ago(card.createdAt, now)}
          </span>
        ) : null}
        <span className="t-acc-chevron shrink-0 text-kumo-subtle">
          <CaretDownIcon size={14} />
        </span>
      </button>
      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className="px-4 pb-4 pl-[56px] [&_.bubble-prose]:text-[14px] [&_.bubble-prose]:leading-[1.6] [&_.bubble-prose]:text-kumo-strong">
            <Prose text={card.found} />
            {card.sources.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {card.sources.map((s) => (
                  <SourceChip key={s.url} {...s} />
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <Link
                to="/bots/$botId"
                params={{ botId: card.botId }}
                className="pressable inline-flex h-8 items-center gap-1 rounded-full border border-kumo-line px-3 text-[13px] font-medium text-kumo-default outline-none hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus"
              >
                Open chat
                <ArrowRightIcon size={14} />
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => onDismiss(card)}
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
