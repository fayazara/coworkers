import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Popover } from "@cloudflare/kumo/components/popover"
import { BotAvatar } from "@/components/bot-avatar"
import { EmptyState } from "@/components/empty-state"
import {
  CaretDownIcon,
  CheckIcon,
  FileIcon,
  MessageIcon,
  PipelineIcon,
  PlayIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons"
import { ShimmerText } from "@/components/shimmer-text"
import { Prose } from "@/components/thread"
import { useHub } from "@/lib/hub-context"
import {
  currentStep,
  formatSpan,
  isNoop,
  stepSpan,
  summarize,
} from "@/lib/pipeline-summary"
import type {
  BotSummary,
  Pipeline,
  PipelineRun,
  PipelineRunStep,
} from "@/lib/types"

/** Outputs longer than this start folded, even when the step is open. */
const FOLD_CHARS = 600

/** Re-renders every second while `on`, for live timers. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

/** 0:42, 12:05: a running step's clock. */
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function when(at: number) {
  return new Date(at).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  })
}

function stepBot(run: PipelineRun, index: number, bots: BotSummary[]) {
  const plan = run.plan[index]
  return plan?.kind === "bot"
    ? bots.find((b) => b.id === plan.botId)
    : undefined
}

function stepLabel(run: PipelineRun, index: number, bot?: BotSummary) {
  return run.plan[index]?.kind === "approval"
    ? "Your approval"
    : (run.steps[index]?.botName ?? bot?.name ?? "Deleted bot")
}

/** A ring that fills as steps finish. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 8
  const c = 2 * Math.PI * r
  // A sliver at the start, so a fresh run still shows where the ring begins.
  const share = Math.max(done / total, 0.06)
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 20 20"
      aria-hidden
      className="-rotate-90 text-kumo-default"
    >
      <circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        strokeWidth={2}
        className="stroke-kumo-line"
      />
      <circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className="progress-arc"
      />
    </svg>
  )
}

const NODE = 28

const BADGE =
  "step-done absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full text-on-status ring-2 ring-kumo-base"

/**
 * A step's place on the rail: the bot's face, or a plain circle for
 * approvals. Success needs no mark; a working face, a badge or a fade says
 * everything else.
 */
function StepNode({
  status,
  index,
  bot,
  approval,
}: {
  status: PipelineRunStep["status"]
  index: number
  bot?: BotSummary
  approval: boolean
}) {
  const idle = status === "pending" || status === "skipped"
  const face = bot ? (
    <BotAvatar
      avatar={bot.avatar}
      size={NODE}
      status={status === "running" ? "working" : "idle"}
    />
  ) : (
    <span
      className={`flex size-7 items-center justify-center rounded-full text-xs text-kumo-subtle tabular-nums ${
        idle
          ? "outline outline-1 -outline-offset-1 outline-kumo-line outline-dashed"
          : "bg-(--fill-hover)"
      }`}
    >
      {approval && status === "done" ? <CheckIcon size={14} /> : index + 1}
    </span>
  )

  return (
    <span
      className={`relative flex size-7 shrink-0 items-center justify-center rounded-full transition-opacity duration-(--duration-quick) ${
        idle ? "opacity-40" : ""
      }`}
    >
      {face}
      {status === "running" && !bot ? (
        <svg
          viewBox="0 0 36 36"
          aria-hidden
          className="step-spin absolute -inset-1 size-9 text-kumo-default"
        >
          <circle
            cx={18}
            cy={18}
            r={17}
            fill="none"
            strokeWidth={1.5}
            className="stroke-kumo-line"
          />
          <path
            d="M18 1a17 17 0 0 1 17 17"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      {status === "failed" ? (
        <span className={`${BADGE} bg-kumo-danger`}>
          <XIcon size={10} />
        </span>
      ) : null}
      {status === "waiting" ? (
        <span className={`${BADGE} bg-kumo-warning`}>
          <WarningIcon size={10} />
        </span>
      ) : null}
    </span>
  )
}

/** A step's result: folded when long, with the full text a click away. */
function StepOutput({
  runId,
  index,
  output,
}: {
  runId: string
  index: number
  output: string
}) {
  const hub = useHub()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const long = output.length > FOLD_CHARS
  // State carries a clipped copy; fetch the rest on first open.
  const clipped = output.endsWith("…")

  async function toggle() {
    if (!open && clipped && full === null && hub.pipelines) {
      setFull(await hub.pipelines.output(runId, index))
    }
    setOpen((o) => !o)
  }

  const text = open
    ? (full ?? output)
    : long
      ? `${output.slice(0, FOLD_CHARS)}…`
      : output
  return (
    <div className="rounded-xl bg-kumo-tint px-3.5 py-2.5 text-sm break-words">
      <div className={long && !open ? "fold-fade" : undefined}>
        <Prose text={text} />
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => void toggle()}
          className="mt-1 text-xs font-medium text-kumo-subtle hover:text-kumo-default"
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  )
}

const CHIP =
  "inline-flex h-7 items-center gap-1.5 rounded-full bg-(--fill-hover) px-2.5 text-xs text-kumo-subtle"

function FileChips({ names }: { names: string[] }) {
  return (
    <p className="flex min-w-0 flex-wrap gap-1.5">
      {names.map((name) => (
        <span key={name} className={CHIP}>
          <FileIcon size={13} />
          {name}
        </span>
      ))}
    </p>
  )
}

/** One step: a single line that opens to its output, files and chat. */
function StepRow({
  run,
  index,
  open,
  onToggle,
  now,
}: {
  run: PipelineRun
  index: number
  open: boolean
  onToggle: () => void
  now: number
}) {
  const { state } = useHub()
  const step = run.steps[index]
  const plan = run.plan[index]
  const bot = stepBot(run, index, state.bots)
  const span = stepSpan(step, now)
  const settled = step.status !== "pending" && step.status !== "skipped"
  // The rail below this step is solid once the next one has started.
  const next = run.steps[index + 1]
  const started = (s?: PipelineRunStep) =>
    s ? s.status !== "pending" && s.status !== "skipped" : false

  let summary: React.ReactNode = null
  if (step.status === "running") {
    // Block, not inline-block: an inline-block that clips sits on its
    // bottom edge and rides above the name's baseline.
    summary = <ShimmerText text="Working…" className="block truncate" />
  } else if (step.status === "waiting") {
    summary = (
      <span className="truncate text-kumo-warning">Waiting for you</span>
    )
  } else if (step.status === "skipped") {
    summary = <span className="truncate">Skipped</span>
  } else if (step.status === "failed" && step.error) {
    summary = <span className="truncate text-kumo-danger">{step.error}</span>
  } else if (step.output) {
    summary = <span className="truncate">{summarize(step.output)}</span>
  } else if (plan?.kind === "approval" && step.status === "done") {
    summary = <span className="truncate">Approved</span>
  }

  const chat =
    bot && plan?.kind === "bot" && settled ? (
      <Link
        to="/bots/$botId"
        params={{ botId: bot.id }}
        hash={`task-${run.id}:${index}`}
        className={`${CHIP} ml-auto shrink-0 transition-colors duration-(--duration-quick) hover:bg-(--fill-active) hover:text-kumo-default`}
      >
        <MessageIcon size={13} />
        {step.status === "failed" ? "See what happened" : "Open in chat"}
      </Link>
    ) : null
  const note = plan?.kind === "approval" && plan.note ? plan.note : null
  const expandable = Boolean(
    step.output || step.files?.length || step.error || note || chat
  )

  const head = (
    <>
      <StepNode
        status={step.status}
        index={index}
        bot={bot}
        approval={plan?.kind === "approval"}
      />
      <span
        className={`shrink-0 text-[15px] ${
          settled ? "font-medium text-kumo-default" : "text-kumo-subtle"
        }`}
      >
        {stepLabel(run, index, bot)}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm text-kumo-subtle transition-opacity duration-(--duration-quick) ${
          open ? "opacity-0" : ""
        }`}
      >
        {summary}
      </span>
      {span !== null && plan?.kind === "bot" ? (
        <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
          {step.status === "running" ? clock(span) : formatSpan(span)}
        </span>
      ) : null}
    </>
  )

  return (
    <li
      className="t-acc step-row"
      data-open={open}
      data-current={step.status === "running" || step.status === "waiting"}
    >
      {index > 0 ? (
        <span
          aria-hidden
          className="step-rail step-rail-in"
          data-on={started(step)}
        />
      ) : null}
      {next ? (
        <span
          aria-hidden
          className="step-rail step-rail-out"
          data-on={started(next)}
        />
      ) : null}
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="step-head flex min-h-13 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          {head}
          <span className="t-acc-chevron shrink-0 text-kumo-subtle">
            <CaretDownIcon size={16} />
          </span>
        </button>
      ) : (
        <div className="step-head flex min-h-13 items-center gap-3 py-2.5 pr-10 pl-3">
          {head}
        </div>
      )}
      {expandable ? (
        <div className="t-acc-panel">
          <div className="t-acc-panel-inner">
            <div className="space-y-2 pt-0.5 pr-3 pb-3 pl-13">
              {note ? (
                <p className="text-sm text-pretty text-kumo-default">{note}</p>
              ) : null}
              {step.output ? (
                <StepOutput runId={run.id} index={index} output={step.output} />
              ) : null}
              {step.error && step.status === "failed" ? (
                <div className="flex gap-2.5 rounded-xl bg-kumo-danger-tint/60 px-3.5 py-2.5">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-kumo-danger text-on-status">
                    <XIcon size={10} />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-kumo-danger">
                      Couldn’t finish
                    </p>
                    <p className="text-sm text-pretty break-words text-kumo-default">
                      {step.error}
                    </p>
                  </div>
                </div>
              ) : step.error ? (
                <p className="text-sm text-pretty text-kumo-subtle">
                  {step.error}
                </p>
              ) : null}
              {step.files?.length || chat ? (
                <div className="flex items-start gap-1.5">
                  {step.files?.length ? <FileChips names={step.files} /> : null}
                  {chat}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  )
}

/**
 * A run's steps as rows on one surface, joined by a rail through their
 * faces. The step being worked on sits on a highlight that slides to the
 * next row when it finishes.
 */
function StepList({ run }: { run: PipelineRun }) {
  const active = run.status === "running" || run.status === "waiting"
  const now = useNow(active)
  const current = currentStep(run)
  const list = useRef<HTMLOListElement>(null)
  const highlight = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  // Failures and approvals open themselves; everything else waits for a click.
  const [open, setOpen] = useState<Set<number>>(
    () =>
      new Set(
        run.steps.flatMap((s, i) =>
          s.status === "failed" || s.status === "waiting" ? [i] : []
        )
      )
  )
  const failed = run.steps.findIndex((s) => s.status === "failed")
  useEffect(() => {
    if (failed !== -1) setOpen((o) => new Set(o).add(failed))
  }, [failed])

  useLayoutEffect(() => {
    const listEl = list.current
    const hl = highlight.current
    if (!listEl || !hl) return

    function place(animate: boolean) {
      const row = listEl!.querySelector<HTMLElement>('[data-current="true"]')
      if (!row) {
        hl!.dataset.shown = "false"
        return
      }
      if (!animate) hl!.style.transition = "none"
      hl!.style.transform = `translateY(${row.offsetTop}px)`
      hl!.style.height = `${row.offsetHeight}px`
      hl!.dataset.shown = "true"
      if (!animate) {
        void hl!.offsetHeight
        hl!.style.transition = ""
      }
    }

    // Snap on first paint, slide when the run moves on.
    place(placed.current)
    placed.current = true
    // Rows above opening or closing move the current one: follow it.
    const observer = new ResizeObserver(() => place(false))
    observer.observe(listEl)
    return () => observer.disconnect()
  }, [current])

  function toggle(i: number) {
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <ol ref={list} className="run-steps relative flex flex-col">
      <span ref={highlight} aria-hidden className="step-highlight" />
      {run.steps.map((_, i) => (
        <StepRow
          key={i}
          run={run}
          index={i}
          open={open.has(i)}
          onToggle={() => toggle(i)}
          now={now}
        />
      ))}
    </ol>
  )
}

/** What the run as a whole is doing, in a glyph and a few words. */
function Headline({ run }: { run: PipelineRun }) {
  const total = run.steps.length
  const done = run.steps.filter((s) => s.status === "done").length
  const failedAt = run.steps.findIndex((s) => s.status === "failed")
  const glyph = "flex size-6 shrink-0 items-center justify-center rounded-full"
  switch (run.status) {
    case "running":
      return (
        <>
          <ProgressRing done={done} total={total} />
          <span className="text-[15px] font-semibold text-kumo-default tabular-nums">
            {done} of {total} done
          </span>
        </>
      )
    case "waiting":
      return (
        <>
          <span className={`${glyph} bg-kumo-warning text-on-status`}>
            <WarningIcon size={14} />
          </span>
          <span className="text-[15px] font-semibold text-kumo-default">
            Waiting for your OK
          </span>
        </>
      )
    case "done": {
      // Every bot step said it had nothing to do: say so here, once.
      const replies = run.steps.filter(
        (s, i) => run.plan[i]?.kind === "bot" && s.status === "done"
      )
      const idle =
        replies.length > 0 &&
        replies.every((s) => s.output && isNoop(summarize(s.output)))
      return (
        <>
          <span className={`${glyph} bg-kumo-success text-on-status`}>
            <CheckIcon size={14} />
          </span>
          <span className="text-[15px] font-semibold text-kumo-default tabular-nums">
            Done
            {run.finishedAt
              ? ` in ${formatSpan(run.finishedAt - run.startedAt)}`
              : ""}
            {idle ? (
              <span className="font-normal text-kumo-subtle">
                {" "}
                · Nothing new
              </span>
            ) : null}
          </span>
        </>
      )
    }
    case "failed":
      return (
        <>
          <span className={`${glyph} bg-kumo-danger text-on-status`}>
            <XIcon size={14} />
          </span>
          <span className="text-[15px] font-semibold text-kumo-default">
            {failedAt === -1 ? "Failed" : `Failed at step ${failedAt + 1}`}
          </span>
        </>
      )
    case "stopped":
      return (
        <>
          <span className={`${glyph} border border-kumo-line text-kumo-subtle`}>
            <XIcon size={14} />
          </span>
          <span className="text-[15px] font-semibold text-kumo-default">
            Stopped
          </span>
        </>
      )
  }
}

function useAct() {
  const [busy, setBusy] = useState(false)
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return { busy, act }
}

const DOT: Record<PipelineRunStep["status"], string> = {
  pending: "border border-kumo-line",
  running: "bg-kumo-contrast",
  waiting: "bg-kumo-warning",
  done: "bg-kumo-success",
  failed: "bg-kumo-danger",
  skipped: "border border-dashed border-kumo-line",
}

/**
 * One run. The header opens and closes it; closed, it is one line with a
 * dot per step.
 */
function RunCard({
  run,
  defaultOpen,
}: {
  run: PipelineRun
  defaultOpen: boolean
}) {
  const hub = useHub()
  const { busy, act } = useAct()
  const active = run.status === "running" || run.status === "waiting"
  const [open, setOpen] = useState(defaultOpen)
  // Steps mount on first open (thirty runs of them add up) and stay for
  // the close animation.
  const [seen, setSeen] = useState(defaultOpen)

  return (
    <li className="run-acc rounded-3xl bg-(--fill-hover) p-2" data-open={open}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setSeen(true)
            setOpen((o) => !o)
          }}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-2xl pr-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <Headline run={run} />
          <span className="min-w-0 flex-1" />
          <span
            aria-hidden
            className={`flex shrink-0 items-center gap-1 transition-opacity duration-(--duration-quick) ${
              open ? "opacity-0" : ""
            }`}
          >
            {run.steps.map((s, i) => (
              <span
                key={i}
                className={`size-2 rounded-full ${DOT[s.status]}`}
              />
            ))}
          </span>
          <span className="shrink truncate text-[13px] text-kumo-subtle tabular-nums">
            {when(run.startedAt)} ·{" "}
            {run.trigger === "schedule" ? "Scheduled" : "By you"}
          </span>
          <span className="run-acc-chevron shrink-0 text-kumo-subtle">
            <CaretDownIcon size={16} />
          </span>
        </button>
        {active ? (
          <Button
            size="sm"
            variant="secondary"
            shape="circle"
            // Its center mirrors the status glyph's on the left: 32px in.
            className="mr-2 shrink-0"
            aria-label="Stop run"
            title="Stop run"
            icon={<StopIcon />}
            disabled={busy || !hub.pipelines}
            onClick={() => void act(() => hub.pipelines!.stop(run.id))}
          />
        ) : null}
      </div>
      <div className="run-acc-panel">
        <div className="run-acc-inner">
          {seen ? (
            <div className="space-y-2 pt-2">
              {run.input ? (
                <p className="line-clamp-2 px-3 text-sm text-pretty text-kumo-subtle">
                  Started from: {run.input}
                </p>
              ) : null}
              <StepList run={run} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/**
 * A run stopped for the user's OK: what the previous step produced, and the
 * buttons, above everything else.
 */
function ApprovalCallout({ run }: { run: PipelineRun }) {
  const hub = useHub()
  const { busy, act } = useAct()
  const index = run.steps.findIndex((s) => s.status === "waiting")
  const plan = run.plan[index]
  if (index === -1 || plan?.kind !== "approval") return null
  const prev = index - 1
  const prevStep = run.steps[prev]
  const prevBot = stepBot(run, prev, hub.state.bots)

  return (
    <section className="space-y-3 rounded-2xl bg-kumo-warning-tint/60 p-4 outline outline-1 -outline-offset-1 outline-kumo-warning/25">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-kumo-warning-tint text-kumo-warning">
          <WarningIcon size={12} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          Step {index + 1} needs your OK
        </h3>
      </div>
      {plan.note ? (
        <p className="text-sm text-pretty text-kumo-default">{plan.note}</p>
      ) : null}
      {prevStep?.output ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-kumo-subtle">
            {prevBot ? <BotAvatar avatar={prevBot.avatar} size={16} /> : null}
            From {stepLabel(run, prev, prevBot)}
          </p>
          <StepOutput runId={run.id} index={prev} output={prevStep.output} />
          {prevStep.files?.length ? <FileChips names={prevStep.files} /> : null}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          className="btn-ink rounded-full"
          disabled={busy || !hub.pipelines}
          onClick={() => void act(() => hub.pipelines!.answer(run.id, true))}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          disabled={busy || !hub.pipelines}
          onClick={() => void act(() => hub.pipelines!.answer(run.id, false))}
        >
          Turn down
        </Button>
      </div>
    </section>
  )
}

/**
 * Run, in the page header. It opens a small form for an optional input to
 * the first step, so the common case is two clicks and the rare one is
 * still close.
 */
export function RunButton({
  pipeline,
  blocked,
}: {
  pipeline: Pipeline
  /** Why it cannot run right now, e.g. unsaved setup. */
  blocked?: string
}) {
  const hub = useHub()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!hub.pipelines || blocked || running) return
    setRunning(true)
    setError(null)
    try {
      await hub.pipelines.run(pipeline.id, input)
      setInput("")
      setOpen(false)
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : String(err)).replace(
          /^Error: /,
          ""
        )
      )
    } finally {
      setRunning(false)
    }
  }

  const hint = error ?? blocked
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button
            size="sm"
            variant="primary"
            className="btn-ink rounded-full"
            icon={<PlayIcon />}
            disabled={!hub.pipelines}
          >
            Run
          </Button>
        }
      />
      <Popover.Content
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-[340px] max-w-[calc(100vw-32px)] p-3"
      >
        <Popover.Title className="text-[15px] font-semibold text-kumo-default">
          Run {pipeline.name}
        </Popover.Title>
        <textarea
          aria-label="Input for the first step"
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void run()
            }
          }}
          placeholder="Anything the first step should start from"
          className={`mt-3 mb-3 block field-sizing-content max-h-48 min-h-20 w-full resize-none rounded-xl bg-(--fill-hover) px-3 py-2 text-sm leading-5 text-kumo-default outline-none placeholder:text-kumo-placeholder`}
        />
        <div className="flex items-center gap-3">
          <p
            className={`min-w-0 flex-1 text-xs text-pretty ${
              error ? "text-kumo-danger" : "text-kumo-subtle"
            }`}
          >
            {hint ?? "Optional. ⌘↵ to run."}
          </p>
          <Button
            size="sm"
            variant="primary"
            className="btn-ink shrink-0 rounded-full"
            icon={<PlayIcon />}
            loading={running}
            disabled={Boolean(blocked) || !hub.pipelines}
            onClick={() => void run()}
          >
            Run
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  )
}

/**
 * The runs side of a pipeline: answer what is waiting, then every run,
 * newest first and open, older ones folded. Live from the hub.
 */
export function PipelineRuns({ pipeline }: { pipeline: Pipeline }) {
  const { state } = useHub()
  const runs = (state.pipelineRuns ?? []).filter(
    (r) => r.pipelineId === pipeline.id
  )
  const waiting = runs.filter((r) => r.status === "waiting")

  // Steps that finish after this mounts get the check pop; history does not.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    root.current?.setAttribute("data-live", "")
  }, [])

  return (
    <div ref={root} className="pipeline-runs space-y-6">
      {waiting.map((run) => (
        <ApprovalCallout key={run.id} run={run} />
      ))}
      {runs.length ? (
        <ul className="space-y-3">
          {runs.map((run, i) => (
            <RunCard
              key={run.id}
              run={run}
              // The newest and anything still going start open.
              defaultOpen={
                i === 0 || run.status === "running" || run.status === "waiting"
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          className="pt-12"
          icon={<PipelineIcon size={24} />}
          title="No runs yet"
          description={
            pipeline.cron
              ? "It runs on its schedule, or press Run to start one now."
              : "Press Run at the top to start one. Each step's result shows up here as it lands."
          }
        />
      )}
    </div>
  )
}
