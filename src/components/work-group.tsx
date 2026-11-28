import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useHydrated } from "@tanstack/react-router"
import {
  BrainIcon,
  CalendarIcon,
  CaretDownIcon,
  FileEditIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  MessageIcon,
  PlugsConnectedIcon,
  ShoppingBagIcon,
  SearchListIcon,
  TerminalIcon,
  WarningIcon,
  ComputerIcon,
} from "@/components/icons"
import type { IconProps } from "@/components/icons"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Outcome, PreviewView, ResultRows } from "@/components/call-preview"
import { editedPreview, previewOf } from "@/lib/call-preview"
import { ShimmerText } from "@/components/shimmer-text"
import {
  describeActivity,
  describeCall,
  describeGroup,
  shellResult,
  stepKind,
} from "@/lib/message-parts"
import type { StepKind, ToolCall } from "@/lib/message-parts"

const KIND_ICON: Record<StepKind, (props: IconProps) => ReactNode> = {
  shell: TerminalIcon,
  files: FileEditIcon,
  search: MagnifyingGlassIcon,
  history: SearchListIcon,
  web: GlobeIcon,
  memory: BrainIcon,
  routine: CalendarIcon,
  bot: MessageIcon,
  app: PlugsConnectedIcon,
  shop: ShoppingBagIcon,
  other: ComputerIcon,
}

/** Long tool output is cut here; the full result stays with the model. */
const MAX_DETAIL_CHARS = 4000

function clip(text: string) {
  return text.length > MAX_DETAIL_CHARS
    ? `${text.slice(0, MAX_DETAIL_CHARS)}\n… truncated`
    : text
}

function formatDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
}

/** Seconds since `from`, ticking while `on`. */
function useElapsed(from: number | undefined, on: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return from ? now - from : undefined
}

type Entry =
  | { kind: "step"; key: string; call: ToolCall }
  | { kind: "group"; key: string; stepKind: StepKind; calls: ToolCall[] }

/** Runs of two or more same-kind steps fold into one "Ran 4 commands" row. */
function toEntries(calls: ToolCall[]): Entry[] {
  const entries: Entry[] = []
  let run: ToolCall[] = []
  const flush = () => {
    if (run.length === 1) {
      entries.push({ kind: "step", key: run[0].id, call: run[0] })
    } else if (run.length > 1) {
      entries.push({
        kind: "group",
        key: run[0].id,
        stepKind: stepKind(run[0]),
        calls: run,
      })
    }
    run = []
  }
  for (const call of calls) {
    if (run.length && stepKind(run[0]) !== stepKind(call)) flush()
    run.push(call)
  }
  flush()
  return entries
}

const failedState = (call: ToolCall) =>
  call.state === "error" || call.state === "denied"

function RowIcon({ kind, failed }: { kind: StepKind; failed?: boolean }) {
  if (failed) {
    return <WarningIcon size={16} className="shrink-0 text-kumo-warning" />
  }
  const Icon = KIND_ICON[kind]
  return <Icon size={16} className="shrink-0" />
}

/** A row that can open: icon, one-line label, chevron. */
function Row({
  kind,
  label,
  running,
  failed,
  open,
  onToggle,
}: {
  kind: StepKind
  label: string
  running?: boolean
  failed?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const content = (
    <>
      <RowIcon kind={kind} failed={failed} />
      {running ? (
        <ShimmerText text={label} className="min-w-0 truncate" />
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {onToggle ? (
        <CaretDownIcon
          size={14}
          className={`shrink-0 transition-[transform,opacity] duration-150 ${
            open
              ? "rotate-0 opacity-100"
              : "-rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        />
      ) : null}
    </>
  )
  const className =
    "group flex max-w-full items-center gap-2 rounded-lg py-0.5 text-left"
  if (!onToggle) return <div className={className}>{content}</div>
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`${className} outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus`}
    >
      {content}
    </button>
  )
}

function DetailBox({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="mt-1.5 mb-1 rounded-2xl bg-kumo-tint px-4 py-3 outline outline-1 -outline-offset-1 outline-kumo-line">
      <p className="text-[13px] text-kumo-subtle">{title}</p>
      <div className="mt-2 font-mono text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-kumo-default">
        {children}
      </div>
      {footer ? (
        <p className="mt-2 text-right text-[13px] text-kumo-subtle">{footer}</p>
      ) : null}
    </div>
  )
}

export function StepDetail({ call }: { call: ToolCall }) {
  const shell = shellResult(call)
  if (shell) {
    const exit =
      shell.exitCode !== null && shell.exitCode !== 0
        ? `Exit code ${shell.exitCode}`
        : undefined
    return (
      <DetailBox title="Shell" footer={exit}>
        {/* Long commands clamp so the output stays in view. */}
        <p className="line-clamp-3" title={shell.command}>
          <span className="text-kumo-subtle">$ </span>
          {shell.command}
        </p>
        <div className="mt-3 max-h-60 overflow-auto">
          {shell.error ? (
            <span className="text-kumo-warning">{clip(shell.error)}</span>
          ) : shell.output ? (
            <span className="text-kumo-subtle">{clip(shell.output)}</span>
          ) : (
            <span className="text-kumo-subtle">No output</span>
          )}
        </div>
      </DetailBox>
    )
  }

  // A finished edit shows the patch the tool made, not the request for it.
  const edited = call.errorText ? null : editedPreview(call.input, call.output)
  const preview = edited ?? previewOf(call.name, call.input)
  const result = call.errorText || edited ? null : resultOf(call.output)
  const sentFlag =
    result?.kind === "fields" && typeof result.fields.sent === "boolean"
      ? result.fields
      : null
  // The outcome sits inside the card as its last row, so a finished step is
  // one object, not a box around a box.
  const footer = call.errorText ? (
    <Outcome tone="warn" compact>
      {clip(call.errorText)}
    </Outcome>
  ) : sentFlag ? (
    sentFlag.sent ? (
      <Outcome tone="ok" compact>
        Sent
      </Outcome>
    ) : (
      <Outcome tone="warn" compact>
        {typeof sentFlag.error === "string" ? sentFlag.error : "Not sent"}
      </Outcome>
    )
  ) : result ? (
    <ResultRows
      data={result.kind === "fields" ? result.fields : clip(result.text)}
      compact
    />
  ) : null
  return (
    <div className="mt-1.5 mb-1">
      <PreviewView
        preview={preview}
        compact
        heading={preview.kind === "fields" ? describeCall(call) : undefined}
        footer={footer}
      />
    </div>
  )
}

/** A call's output as text, or as fields when it is an object. */
function resultOf(output: unknown) {
  if (output === undefined || output === null || output === "") return null
  if (typeof output === "string") return { kind: "text" as const, text: output }
  if (typeof output === "object" && !Array.isArray(output)) {
    return {
      kind: "fields" as const,
      fields: output as Record<string, unknown>,
    }
  }
  return { kind: "text" as const, text: JSON.stringify(output, null, 2) }
}

function StepRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const running = call.state === "running" || call.state === "waiting"
  return (
    <li>
      <Row
        kind={stepKind(call)}
        label={describeCall(call)}
        running={running}
        failed={failedState(call)}
        open={open}
        onToggle={running ? undefined : () => setOpen((v) => !v)}
      />
      {open ? <StepDetail call={call} /> : null}
    </li>
  )
}

function StepGroup({
  kind,
  calls,
  live,
}: {
  kind: StepKind
  calls: ToolCall[]
  live: boolean
}) {
  const running = calls.some((c) => c.state === "running")
  // A group the bot is still adding to stays open so its steps show up.
  const [open, setOpen] = useState(live && running)
  const failed = calls.filter(failedState).length
  const label = `${describeGroup(kind, calls)}${failed ? ` · ${failed} failed` : ""}`
  return (
    <li>
      <Row
        kind={kind}
        label={label}
        running={running}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open ? (
        <ul className="mt-1 space-y-1 pl-6">
          {calls.map((call) => (
            <StepRow key={call.id} call={call} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * The tool steps behind a reply, folded into one line. While the bot works
 * it is the status line: what it is doing right now, and for how long. Once
 * the reply is in it becomes "Worked for 37s". Either way it opens into the
 * steps, where runs of the same kind group into one row ("Ran 4 commands")
 * and every step shows what went in and what came back.
 */
export function WorkGroup({
  calls,
  live,
  startedAt,
  durationMs,
}: {
  calls: ToolCall[]
  live: boolean
  startedAt?: number
  durationMs?: number
}) {
  const [open, setOpen] = useState(false)
  const hydrated = useHydrated()
  const elapsed = useElapsed(startedAt, live && hydrated)
  const running = calls.findLast((c) => c.state === "running")
  const failed = calls.filter(failedState).length

  const steps = (
    <ul className="mt-2 space-y-1.5 border-t border-kumo-line pt-3 pb-1">
      {toEntries(calls).map((entry) =>
        entry.kind === "step" ? (
          <StepRow key={entry.key} call={entry.call} />
        ) : (
          <StepGroup
            key={entry.key}
            kind={entry.stepKind}
            calls={entry.calls}
            live={live}
          />
        )
      )}
    </ul>
  )

  if (live) {
    // Between steps the bot is reading what came back and deciding.
    const activity = running ? describeActivity(running) : "Thinking"
    return (
      <div className="w-full max-w-[640px] text-sm text-kumo-subtle">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex max-w-full items-center gap-2.5 rounded-lg pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-(--fill-hover) text-kumo-default">
            <Loader size="sm" />
          </span>
          <span role="status" aria-live="polite" className="min-w-0 truncate">
            <ShimmerText text={activity} className="text-[15px]" />
          </span>
          {elapsed !== undefined && elapsed >= 5000 ? (
            // The time is the whole turn's, not this step's: the count
            // keeps a long run from reading as one stuck command.
            <span className="shrink-0 text-[13px] tabular-nums">
              {calls.length > 1 ? `${calls.length} steps · ` : ""}
              {formatDuration(elapsed)}
            </span>
          ) : null}
          <CaretDownIcon
            size={14}
            className={`shrink-0 transition-[transform,opacity] duration-150 ${
              open
                ? "opacity-100"
                : "-rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
          />
        </button>
        {open ? steps : null}
      </div>
    )
  }

  const label = durationMs
    ? `Worked for ${formatDuration(durationMs)}`
    : `${calls.length} ${calls.length === 1 ? "step" : "steps"}`

  return (
    <div className="w-full max-w-[640px] text-sm text-kumo-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex max-w-full items-center gap-1 rounded-lg py-0.5 outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
      >
        <span>{label}</span>
        {failed ? (
          <span className="text-kumo-warning"> · {failed} failed</span>
        ) : null}
        <CaretDownIcon
          size={14}
          className={`shrink-0 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open ? steps : null}
    </div>
  )
}
