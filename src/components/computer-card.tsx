import { useCallback, useEffect, useState } from "react"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ComputerIcon,
  GlobeIcon,
  LockIcon,
} from "@/components/icons"
import type { ToolCall } from "@/lib/message-parts"
import type { BrowserFrame } from "@/lib/types"

export interface LiveTab {
  targetId: string
  url: string
  pageUrl?: string
  title?: string
}

export type GetLiveView = () => Promise<LiveTab[]>
export type GetBrowserFrame = (
  toolCallId: string
) => Promise<BrowserFrame | null>
export type BrowserNav = "back" | "forward" | "reload"
export type NavigateBrowser = (action: BrowserNav) => Promise<boolean>

// Picks up new tabs and page titles. Live View URLs are valid for about
// five minutes, so a newly seen tab always gets a fresh one.
const LIVE_VIEW_REFRESH_MS = 60 * 1000
// While the bot works it may open a tab mid-step: look more often.
const LIVE_VIEW_WORKING_MS = 4 * 1000

/**
 * Fetch Live View tabs. A tab that is already open keeps its URL, so the
 * stream is not torn down and reloaded every time the bot takes a step;
 * Live View follows navigation inside the tab by itself. `force` swaps in
 * fresh URLs, for when a stream dropped.
 */
export function useLiveView(
  getLiveView: GetLiveView | undefined,
  on: boolean,
  intervalMs = LIVE_VIEW_REFRESH_MS
) {
  const [tabs, setTabs] = useState<LiveTab[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (force = false) => {
      if (!getLiveView) return
      try {
        const next = await getLiveView()
        setTabs((prev) =>
          next.map((tab) => {
            const open = prev?.find((p) => p.targetId === tab.targetId)
            return open && !force ? { ...tab, url: open.url } : tab
          })
        )
        setError(null)
      } catch (err) {
        setTabs([])
        setError(err instanceof Error ? err.message : "Could not reach browser")
      }
    },
    [getLiveView]
  )

  useEffect(() => {
    if (!on) return
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(timer)
  }, [on, refresh, intervalMs])

  return { tabs, error, refresh }
}

// Live View draws its own toolbar (back, forward, reload, address) at the
// top of the page, and has no option to hide it. The frame is pulled up by
// its height so BrowserChrome stands in for it.
const LIVE_VIEW_TOOLBAR_PX = 49

// Live View letterboxes the remote window on a grey page, so the card takes
// the window's shape (measured from Browser Run) to leave no grey edges.
const FRAME_ASPECT = "aspect-[1411/892]"

interface LiveViewFrameProps {
  tab: LiveTab
  /** Preview frames ignore input; the take-over modal passes `true`. */
  interactive?: boolean
  className?: string
}

export function LiveViewFrame({
  tab,
  interactive = false,
  className = "",
}: LiveViewFrameProps) {
  return (
    <div className={`relative overflow-hidden bg-surface-web ${className}`}>
      <iframe
        src={tab.url}
        title={tab.title || tab.pageUrl || "Bot browser"}
        allow="clipboard-read; clipboard-write"
        tabIndex={interactive ? 0 : -1}
        style={{
          top: -LIVE_VIEW_TOOLBAR_PX,
          height: `calc(100% + ${LIVE_VIEW_TOOLBAR_PX}px)`,
        }}
        className={`absolute inset-x-0 w-full border-0 bg-surface-web ${
          interactive ? "" : "pointer-events-none"
        }`}
      />
    </div>
  )
}

function splitUrl(pageUrl: string | undefined) {
  if (!pageUrl || pageUrl === "about:blank") return null
  try {
    const url = new URL(pageUrl)
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`
    return {
      secure: url.protocol === "https:",
      host: url.host.replace(/^www\./, ""),
      rest,
    }
  } catch {
    return { secure: false, host: pageUrl, rest: "" }
  }
}

function ChromeButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || !onClick}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-full text-kumo-subtle transition-colors outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  )
}

interface BrowserChromeProps {
  pageUrl?: string
  /** Back, forward and reload; left out where they would do nothing. */
  onNavigate?: NavigateBrowser
  /** The bot is driving: the buttons show but do not take input. */
  locked?: boolean
  /** Opens the page in the user's own browser. */
  openable?: boolean
  /** Extra controls at the right end of the bar. */
  children?: React.ReactNode
}

/** A quiet browser toolbar over the bot's page: buttons and an address pill. */
export function BrowserChrome({
  pageUrl,
  onNavigate,
  locked = false,
  openable = false,
  children,
}: BrowserChromeProps) {
  const [busy, setBusy] = useState<BrowserNav | null>(null)
  const parts = splitUrl(pageUrl)

  async function go(action: BrowserNav) {
    if (!onNavigate) return
    setBusy(action)
    try {
      await onNavigate(action)
    } finally {
      setBusy(null)
    }
  }

  const disabled = locked || busy !== null
  const hint = locked ? " (the bot is using the browser)" : ""
  return (
    <div className="flex h-11 items-center gap-1 border-b border-kumo-line bg-kumo-base px-2">
      {onNavigate ? (
        <>
          <ChromeButton
            label={`Back${hint}`}
            disabled={disabled}
            onClick={() => void go("back")}
          >
            <ArrowLeftIcon size={16} />
          </ChromeButton>
          <ChromeButton
            label={`Forward${hint}`}
            disabled={disabled}
            onClick={() => void go("forward")}
          >
            <ArrowRightIcon size={16} />
          </ChromeButton>
          <ChromeButton
            label={`Reload${hint}`}
            disabled={disabled}
            onClick={() => void go("reload")}
          >
            <ArrowClockwiseIcon
              size={15}
              className={busy === "reload" ? "animate-spin" : ""}
            />
          </ChromeButton>
        </>
      ) : null}
      <div
        className="ml-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-kumo-recessed px-3 text-[13px]"
        title={pageUrl}
      >
        {parts?.secure ? (
          <LockIcon size={12} className="shrink-0 text-kumo-subtle" />
        ) : (
          <GlobeIcon size={12} className="shrink-0 text-kumo-subtle" />
        )}
        <span className="min-w-0 truncate">
          {parts ? (
            <>
              <span className="text-kumo-default">{parts.host}</span>
              <span className="text-kumo-subtle">{parts.rest}</span>
            </>
          ) : (
            <span className="text-kumo-subtle">New tab</span>
          )}
        </span>
      </div>
      {openable && parts ? (
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open this page in a new tab"
          title="Open this page in a new tab"
          className="grid size-7 shrink-0 place-items-center rounded-full text-kumo-subtle transition-colors outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <ArrowSquareOutIcon size={15} />
        </a>
      ) : null}
      {children}
    </div>
  )
}

type CardStatus = "working" | "action_needed" | "done" | "skipped" | "failed"

/** `carriedOn`: the reply goes on after this card, so a failure was not the end. */
function cardStatus(calls: ToolCall[], carriedOn: boolean): CardStatus {
  if (calls.some((c) => c.state === "waiting")) return "action_needed"
  if (calls.some((c) => c.state === "running")) return "working"
  const last = calls.at(-1)
  if (last?.state === "error" || last?.state === "denied") {
    return carriedOn ? "skipped" : "failed"
  }
  return "done"
}

function hostOf(pageUrl: string | undefined) {
  if (!pageUrl || pageUrl === "about:blank") return ""
  try {
    return new URL(pageUrl).host.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function pageLabel(page: { title?: string; pageUrl?: string } | undefined) {
  if (!page?.pageUrl || page.pageUrl === "about:blank") return ""
  if (page.title && page.title !== page.pageUrl) return page.title
  try {
    const url = new URL(page.pageUrl)
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`
  } catch {
    return page.pageUrl
  }
}

/** Sites in visiting order, without repeats in a row. */
function trailOf(urls: (string | undefined)[]) {
  return urls.map(hostOf).filter((host, i, all) => host && host !== all[i - 1])
}

/**
 * One short line for the card header: where the bot is and how far it got.
 * Site names, not page titles, so it stays one line as the bot moves on.
 */
function describe(status: CardStatus, steps: number, sites: string[]) {
  const count = `${steps} ${steps === 1 ? "step" : "steps"}`
  const trail =
    sites.length > 3 ? `${sites[0]} → … → ${sites.at(-1)}` : sites.join(" → ")
  switch (status) {
    case "working":
    case "action_needed":
      return sites.length ? `On ${sites.at(-1)}` : "Opening the browser…"
    case "skipped":
      return `A step failed, so the bot tried another way · ${count}`
    case "failed":
      return `The last step failed · ${count}`
    case "done":
      return trail ? `${trail} · ${count}` : count
  }
}

function StatusChip({ status }: { status: CardStatus }) {
  switch (status) {
    case "working":
      return (
        <Badge variant="neutral" icon={<Loader size="sm" />}>
          Working
        </Badge>
      )
    case "action_needed":
      return <Badge variant="orange">Action needed</Badge>
    case "skipped":
      return <Badge variant="neutral">Skipped</Badge>
    case "failed":
      return <Badge variant="red">Stopped</Badge>
    case "done":
      return (
        <Badge variant="success" appearance="dot">
          Done
        </Badge>
      )
  }
}

interface Frame {
  url: string
  title: string
  src: string
}

/**
 * The page each finished browser_execute step ended on, in call order. A
 * step's frame is saved before its result comes back, so one fetch each.
 */
function useFrames(
  calls: ToolCall[],
  getBrowserFrame: GetBrowserFrame | undefined
) {
  const [frames, setFrames] = useState<Record<string, Frame | null>>({})
  const ready = calls.filter(
    (c) => c.name === "browser_execute" && c.state === "done"
  )
  const missing = ready
    .map((c) => c.id)
    .filter((id) => !(id in frames))
    .join(",")

  useEffect(() => {
    if (!getBrowserFrame || !missing) return
    let cancelled = false
    for (const id of missing.split(",")) {
      getBrowserFrame(id)
        .catch(() => null)
        .then((frame) => {
          if (cancelled) return
          setFrames((prev) => ({
            ...prev,
            [id]: frame
              ? {
                  url: frame.url,
                  title: frame.title,
                  src: `data:${frame.mediaType};base64,${frame.base64}`,
                }
              : null,
          }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [getBrowserFrame, missing])

  return ready.flatMap((c) => (frames[c.id] ? [frames[c.id]!] : []))
}

function FrameImage({
  frame,
  className = "",
}: {
  frame: Frame
  className?: string
}) {
  return (
    <img
      src={frame.src}
      alt={`The bot's browser on ${pageLabel({ title: frame.title, pageUrl: frame.url })}`}
      className={`block w-full bg-surface-web object-cover object-top ${className}`}
    />
  )
}

interface ComputerCardProps {
  calls: ToolCall[]
  /** Only the most recent card in a thread shows the live browser. */
  latest: boolean
  /** More of the reply follows this card. */
  carriedOn?: boolean
  getLiveView?: GetLiveView
  getBrowserFrame?: GetBrowserFrame
  navigateBrowser?: NavigateBrowser
  onApproval?: (approvalId: string, approved: boolean, reason?: string) => void
}

/**
 * Inline card for browser work. While the bot works it streams Live View of
 * the bot's tab; once a step is over it shows the frame that step ended on,
 * which stays put even after the tab or the session is gone.
 */
export function ComputerCard({
  calls,
  latest,
  carriedOn = false,
  getLiveView,
  getBrowserFrame,
  navigateBrowser,
  onApproval,
}: ComputerCardProps) {
  const status = cardStatus(calls, carriedOn)
  const handoff = calls.findLast((c) => c.name === "request_handoff")
  const waiting = calls.find((c) => c.state === "waiting")
  const active = status === "working" || status === "action_needed"
  const live = latest && active
  const { tabs, refresh } = useLiveView(
    getLiveView,
    live,
    status === "working" ? LIVE_VIEW_WORKING_MS : undefined
  )
  const frames = useFrames(calls, getBrowserFrame)
  const frame = frames.at(-1)
  const [takingOver, setTakingOver] = useState(false)
  // The server lists the bot's own tab first.
  const tab = live ? tabs?.[0] : undefined
  const page = tab ?? (frame && { title: frame.title, pageUrl: frame.url })
  const sites = trailOf([...frames.map((f) => f.url), tab?.pageUrl])
  const summary = describe(status, calls.length, sites)
  // A hand-off asks the user to do something: that sentence is shown whole.
  const handoffText =
    typeof handoff?.input.instructions === "string" &&
    (status === "action_needed" || calls.at(-1) === handoff)
      ? handoff.input.instructions
      : null
  const instructions = handoffText ?? summary

  // Pick up the page the bot just navigated to.
  useEffect(() => {
    if (live) void refresh()
  }, [calls.length, status, live, refresh])

  function respond(approved: boolean) {
    if (waiting?.approvalId) {
      onApproval?.(
        waiting.approvalId,
        approved,
        approved ? undefined : "The user could not complete this step."
      )
    }
    setTakingOver(false)
  }

  // The buttons drive the live tab. While the bot works they show but stay
  // locked; a finished card has a picture, so it only offers to open the page.
  const navigate =
    tab && navigateBrowser
      ? async (action: BrowserNav) => {
          const moved = await navigateBrowser(action)
          void refresh()
          return moved
        }
      : undefined
  const chrome = (
    <BrowserChrome
      pageUrl={page?.pageUrl}
      onNavigate={navigate}
      locked={status === "working"}
      openable={!tab}
    />
  )

  // Live while working; the last frame once done. A finished card with no
  // frame (nothing but blank tabs, or a capture failed) is just its header.
  const preview = tab ? (
    <LiveViewFrame tab={tab} className={FRAME_ASPECT} />
  ) : frame ? (
    <FrameImage frame={frame} className={FRAME_ASPECT} />
  ) : null
  const showPlaceholder = live && !preview

  return (
    <div className="w-full max-w-[640px] rounded-bubble bg-kumo-tint p-1.5">
      <div className="flex h-9 items-center gap-2 pr-1 pl-3">
        <span className="shrink-0 text-[14px] font-semibold text-kumo-default">
          Computer
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] text-kumo-subtle"
          title={summary}
        >
          {summary}
        </span>
        <StatusChip status={status} />
      </div>
      {handoffText ? (
        <p className="px-3 pt-0.5 pb-2.5 text-[15px] text-kumo-default">
          {handoffText}
        </p>
      ) : null}

      {preview || showPlaceholder ? (
        <div className="relative overflow-hidden rounded-2xl bg-kumo-base shadow-frame after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-2xl after:outline after:outline-1 after:-outline-offset-1 after:outline-kumo-line">
          {/* The edge is an overlay: the frame below is positioned and would
              paint over a plain outline, leaving it around the toolbar only. */}
          {chrome}
          {preview ? (
            <button
              type="button"
              aria-label={tab ? "Watch the browser" : "View the last page"}
              onClick={() => setTakingOver(true)}
              className="block w-full cursor-zoom-in"
            >
              {preview}
            </button>
          ) : (
            <div
              className={`flex ${FRAME_ASPECT} flex-col items-center justify-center gap-2 bg-kumo-recessed text-sm text-kumo-subtle`}
            >
              {tabs === null ? (
                <Loader />
              ) : (
                <>
                  <ComputerIcon size={28} />
                  <span>Waiting for the browser…</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowClockwiseIcon />}
                    onClick={() => void refresh(true)}
                  >
                    Refresh
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {status === "action_needed" && onApproval ? (
        <div className="flex flex-wrap gap-2 px-1.5 pt-2.5 pb-1">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            onClick={() => setTakingOver(true)}
          >
            Take over
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => respond(true)}
          >
            I'm done
          </Button>
        </div>
      ) : null}

      <Dialog.Root open={takingOver} onOpenChange={setTakingOver}>
        <Dialog
          size="xl"
          className="flex h-[90vh] w-[94vw]! max-w-[1500px]! min-w-0! flex-col gap-3 p-3"
        >
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-kumo-warning-tint px-4 py-2.5">
            <Dialog.Title className="min-w-0 flex-1 text-[15px] font-medium text-kumo-default">
              {instructions}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-2">
              {status === "action_needed" ? (
                <>
                  <Button variant="ghost" onClick={() => respond(false)}>
                    I couldn't
                  </Button>
                  <Button
                    variant="primary"
                    className="btn-ink rounded-full"
                    onClick={() => respond(true)}
                  >
                    I'm done, continue
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setTakingOver(false)}
                >
                  Close
                </Button>
              )}
            </div>
          </div>
          <Dialog.Description className="sr-only">
            {status === "action_needed"
              ? "You are controlling the bot's browser. Anything you type goes straight to the page and is not shown to the bot."
              : tab
                ? "A live view of the bot's browser. It is view only while the bot works."
                : "The page the bot's browser was on when it finished."}
          </Dialog.Description>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-kumo-base after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-2xl after:outline after:outline-1 after:-outline-offset-1 after:outline-kumo-line">
            {chrome}
            {tab ? (
              <LiveViewFrame
                tab={tab}
                interactive={status === "action_needed"}
                className="min-h-0 flex-1"
              />
            ) : frame && !active ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <FrameImage frame={frame} />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-kumo-recessed text-sm text-kumo-subtle">
                <span>The browser isn't reachable right now.</span>
                <Button
                  size="sm"
                  icon={<ArrowClockwiseIcon />}
                  onClick={() => void refresh(true)}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
