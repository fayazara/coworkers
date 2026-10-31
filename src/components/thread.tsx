import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useHydrated, useLocation } from "@tanstack/react-router"
import Markdown, { defaultUrlTransform } from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  AppWindowIcon,
  ClockIcon,
  CrawlIcon,
  EnvelopeSimpleIcon,
  PipelineIcon,
  PlugsConnectedIcon,
  TerminalIcon,
  WebhooksLogoIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { BotMention } from "@/components/bot-mention"
import { CaptureCard } from "@/components/capture-card"
import { CodeBlock } from "@/components/code-block"
import { ComputerCard } from "@/components/computer-card"
import { ShimmerText } from "@/components/shimmer-text"
import { WorkGroup } from "@/components/work-group"
import { RoutineSummary } from "@/components/routine-summary"
import {
  describeCall,
  isQuietReply,
  messageText,
  metaOf,
  originOf,
  stripOriginHeader,
  toBlocks,
  toTurn,
} from "@/lib/message-parts"
import { useFollowBottom } from "@/lib/follow-bottom"
import { botIdFromLink, splitMentions } from "@/lib/bot-links"
import { NO_UPDATE } from "@/lib/types"
import type { UIMessage } from "ai"
import type { ReadFileData } from "@/components/capture-card"
import type {
  GetBrowserFrame,
  GetLiveView,
  NavigateBrowser,
} from "@/components/computer-card"
import type { Block, ToolCall } from "@/lib/message-parts"
import type { BotState, MessageMeta, ScriptApproval } from "@/lib/types"

export type OnApproval = (
  approvalId: string,
  approved: boolean,
  reason?: string
) => void

/** Hands a credential to the bot over its socket; it never enters the chat. */
export type OnProvideSecret = (
  toolCallId: string,
  value: string
) => Promise<void>

/** Hands the tapped ask_user option to the bot before the card is approved. */
export type OnAnswerChoice = (
  toolCallId: string,
  option: string
) => Promise<void>

interface ThreadProps {
  bot: Pick<BotState, "name" | "avatar" | "status">
  messages: UIMessage[]
  /** A turn is in flight (submitted or streaming). */
  busy: boolean
  /** For links into the bot's settings (routine cards). */
  botId?: string
  getLiveView?: GetLiveView
  getBrowserFrame?: GetBrowserFrame
  navigateBrowser?: NavigateBrowser
  /** Loads screenshots and PDFs the bot saved. Absent before hydration. */
  readFile?: ReadFileData
  onApproval?: OnApproval
  onProvideSecret?: OnProvideSecret
  onAnswerChoice?: OnAnswerChoice
  /** App calls from the bot's scripts, paused for the user's OK. */
  scriptApprovals?: ScriptApproval[]
  onScriptApproval?: OnScriptApproval
  /** Id of the first message that was unread when the thread opened. */
  unreadFrom?: string
}

export type OnScriptApproval = (
  approval: ScriptApproval,
  approved: boolean,
  /** Also let the rest of this run use the same tool without asking. */
  all?: boolean
) => Promise<void>

/** Hostname of an absolute http(s) link, for its favicon. */
function linkHost(href: string | undefined) {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className="mr-1 inline-block size-[1em] rounded-[3px] align-[-0.125em]"
    />
  )
}

const PROSE = [
  // Long URLs and query strings have no break points; let them wrap
  // instead of running out of the bubble.
  "bubble-prose text-[15px] leading-[1.65] text-pretty break-words",
  "[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3",
  "[&_strong]:font-semibold",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:my-1.5 [&_li]:pl-1 [&_li]:marker:text-kumo-subtle",
  "[&_hr]:my-5 [&_hr]:border-kumo-line",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle",
  "[&_code]:rounded-md [&_code]:bg-(--fill-hover) [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
  "[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
].join(" ")

/** Keep bot links, which Markdown's default sanitizer would empty. */
function urlTransform(url: string) {
  return botIdFromLink(url) ? url : defaultUrlTransform(url)
}

/**
 * Built once: a fresh object per render would give React new component
 * types on every streamed chunk, remounting links (and restarting the bot
 * faces in mention chips).
 */
const PROSE_COMPONENTS: Components = {
  a: ({ node: _node, href, children, ...props }) => {
    const botId = botIdFromLink(href)
    if (botId) {
      return (
        <BotMention
          botId={botId}
          label={String(children ?? "")}
          className="text-kumo-link"
        />
      )
    }
    const host = linkHost(href)
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-kumo-link decoration-1 underline-offset-2 hover:underline"
      >
        {host ? <Favicon host={host} /> : null}
        {children}
      </a>
    )
  },
  table: ({ node: _node, ...props }) => (
    <div className="-mx-1 my-3 overflow-x-auto">
      <table
        {...props}
        className="w-full border-collapse text-sm tabular-nums"
      />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => (
    <th
      {...props}
      style={style}
      className="border-b border-kumo-line px-3 pt-1 pb-2 text-left align-bottom text-[13px] font-medium whitespace-nowrap text-kumo-subtle"
    />
  ),
  td: ({ node: _node, style, ...props }) => (
    <td
      {...props}
      style={style}
      className="border-b border-kumo-line px-3 py-2.5 align-top [tr:last-child>&]:border-b-0"
    />
  ),
  // Fenced blocks get highlighted; inline `code` stays a small chip.
  pre: ({ children }) => <>{children}</>,
  code: ({ node: _node, className, children, ...props }) => {
    const text = String(children ?? "")
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1]
    if (!lang && !text.includes("\n")) return <code {...props}>{children}</code>
    return (
      <CodeBlock
        code={text.replace(/\n$/, "")}
        lang={lang}
        className="rounded-2xl bg-(--fill-hover) px-4 py-3"
      />
    )
  },
}

const REMARK_PLUGINS = [remarkGfm]

export function Prose({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={urlTransform}
        components={PROSE_COMPONENTS}
      >
        {text}
      </Markdown>
    </div>
  )
}

function SystemEvent({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-center text-sm text-kumo-subtle">{children}</p>
}

function ApprovalCard({
  call,
  onApproval,
}: {
  call: ToolCall
  onApproval?: OnApproval
}) {
  const details = JSON.stringify(call.input, null, 2)
  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      <p className="text-[15px] font-semibold text-kumo-default">
        Approval needed
      </p>
      <p className="mt-1 text-[15px] text-kumo-default">{describeCall(call)}</p>
      {details !== "{}" ? (
        <CodeBlock
          code={details}
          lang="json"
          className="mt-3 max-h-60 rounded-2xl bg-kumo-base p-3"
        />
      ) : null}
      {onApproval && call.approvalId ? (
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            onClick={() => onApproval(call.approvalId!, true)}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() =>
              onApproval(call.approvalId!, false, "The user said no.")
            }
          >
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A script's app call, paused until the user answers. Not a chat part: the
 * script runs on its own and can wait across turns and restarts.
 */
function ScriptApprovalCard({
  approval,
  onScriptApproval,
}: {
  approval: ScriptApproval
  onScriptApproval?: OnScriptApproval
}) {
  const [answering, setAnswering] = useState<"one" | "all" | "no" | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function answer(choice: "one" | "all" | "no") {
    if (!onScriptApproval) return
    setAnswering(choice)
    setError(null)
    try {
      await onScriptApproval(approval, choice !== "no", choice === "all")
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.")
      setAnswering(null)
    }
  }
  return (
    <div className="msg-enter w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      <p className="text-[15px] font-semibold text-kumo-default">
        Approval needed
      </p>
      <p className="mt-1 text-[15px] text-kumo-default">
        {approval.purpose ? `${approval.purpose}: ` : "A script "}
        wants to use {approval.app} ({approval.tool})
      </p>
      {approval.argsJson !== "{}" ? (
        <CodeBlock
          code={approval.argsJson}
          lang="json"
          className="mt-3 max-h-60 rounded-2xl bg-kumo-base p-3"
        />
      ) : null}
      {onScriptApproval ? (
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            disabled={answering !== null}
            loading={answering === "one"}
            onClick={() => void answer("one")}
          >
            Approve
          </Button>
          {approval.toolName ? (
            <Button
              variant="outline"
              className="rounded-full"
              disabled={answering !== null}
              loading={answering === "all"}
              onClick={() => void answer("all")}
            >
              Approve all
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="rounded-full"
            disabled={answering !== null}
            loading={answering === "no"}
            onClick={() => void answer("no")}
          >
            Reject
          </Button>
        </div>
      ) : null}
      {onScriptApproval && approval.toolName ? (
        <p className="mt-2 text-xs text-kumo-subtle">
          Approve all lets this script use {approval.tool} again without asking,
          until it finishes.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** ask_user: a question with tappable answers. Typing a reply also answers it. */
function ChoiceCard({
  call,
  onApproval,
  onAnswerChoice,
}: {
  call: ToolCall
  onApproval?: OnApproval
  onAnswerChoice?: OnAnswerChoice
}) {
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const options = Array.isArray(call.input.options)
    ? call.input.options.map(String)
    : []
  const ready = Boolean(onApproval && onAnswerChoice && call.approvalId)

  async function pick(option: string) {
    if (!onApproval || !onAnswerChoice || !call.approvalId) return
    setPicking(option)
    setError(null)
    try {
      await onAnswerChoice(call.id, option)
      onApproval(call.approvalId, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.")
      setPicking(null)
    }
  }

  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      <p className="text-[15px] text-kumo-default">
        {String(call.input.question ?? "")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            variant="outline"
            className="rounded-full"
            loading={picking === option}
            disabled={!ready || picking !== null}
            onClick={() => void pick(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-kumo-danger">{error}</p> : null}
    </div>
  )
}

/** request_secret: a masked field. The value goes to the bot, not the chat. */
function SecretCard({
  call,
  onApproval,
  onProvideSecret,
}: {
  call: ToolCall
  onApproval?: OnApproval
  onProvideSecret?: OnProvideSecret
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = Boolean(onApproval && onProvideSecret && call.approvalId)

  async function save() {
    if (!onApproval || !onProvideSecret || !call.approvalId) return
    setSaving(true)
    setError(null)
    try {
      await onProvideSecret(call.id, value)
      setValue("")
      onApproval(call.approvalId, true, "saved")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <p className="text-[15px] font-semibold text-kumo-default">
        {String(call.input.name ?? "Credential")}
      </p>
      <p className="mt-1 text-[15px] text-kumo-default">
        {String(call.input.purpose ?? "")}
      </p>
      <p className="mt-1 text-sm text-kumo-subtle">
        Only sent to {String(call.input.origin ?? "")}. The bot never sees it.
      </p>
      <input
        type="password"
        autoComplete="off"
        aria-label="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-3 h-10 w-full rounded-full bg-kumo-base px-4 text-[15px] text-kumo-default ring-1 ring-kumo-line outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
      />
      {error ? <p className="mt-2 text-sm text-kumo-danger">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          variant="primary"
          className="btn-ink rounded-full"
          loading={saving}
          disabled={!ready || !value.trim()}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          disabled={!ready}
          onClick={() =>
            onApproval?.(
              call.approvalId!,
              false,
              "The user chose not to share it."
            )
          }
        >
          Not now
        </Button>
      </div>
    </form>
  )
}

function AssistantMessage({
  blocks,
  live,
  startedAt,
  durationMs,
  botId,
  latestComputerKey,
  getLiveView,
  getBrowserFrame,
  navigateBrowser,
  readFile,
  onApproval,
  onProvideSecret,
  onAnswerChoice,
}: {
  blocks: Block[]
  /** This reply is still being written. */
  live: boolean
  startedAt?: number
  durationMs?: number
  botId?: string
  latestComputerKey: string | undefined
  getLiveView?: GetLiveView
  getBrowserFrame?: GetBrowserFrame
  navigateBrowser?: NavigateBrowser
  readFile?: ReadFileData
  onApproval?: OnApproval
  onProvideSecret?: OnProvideSecret
  onAnswerChoice?: OnAnswerChoice
}) {
  const { work, shown } = toTurn(blocks)
  return (
    <>
      {work.length ? (
        <WorkGroup
          work={work}
          live={live}
          startedAt={startedAt}
          durationMs={durationMs}
          renderNote={(text) => (
            <div className="[&_.bubble-prose_p]:my-1.5">
              <Prose text={text} />
            </div>
          )}
        />
      ) : null}
      {shown.map((block, index) => {
        switch (block.kind) {
          case "text":
            return (
              <div
                key={block.key}
                className="w-fit max-w-[85%] rounded-[22px] bg-kumo-tint px-[18px] py-3 text-kumo-default has-[table]:w-full has-[table]:max-w-full"
              >
                <Prose text={block.text} />
              </div>
            )
          case "routine":
            return (
              <RoutineSummary
                key={block.key}
                routine={block.routine}
                updated={block.updated}
                botId={botId}
              />
            )
          case "event":
            return <SystemEvent key={block.key}>{block.label}</SystemEvent>
          case "computer":
            return (
              <ComputerCard
                key={block.key}
                calls={block.calls}
                latest={block.key === latestComputerKey}
                carriedOn={index < shown.length - 1}
                getLiveView={getLiveView}
                getBrowserFrame={getBrowserFrame}
                navigateBrowser={navigateBrowser}
                onApproval={onApproval}
              />
            )
          case "steps":
            return null
          case "capture":
            return (
              <CaptureCard
                key={block.key}
                capture={block.capture}
                readFile={readFile}
              />
            )
          case "approval":
            return (
              <ApprovalCard
                key={block.key}
                call={block.call}
                onApproval={onApproval}
              />
            )
          case "choice":
            return (
              <ChoiceCard
                key={block.key}
                call={block.call}
                onApproval={onApproval}
                onAnswerChoice={onAnswerChoice}
              />
            )
          case "secret":
            return (
              <SecretCard
                key={block.key}
                call={block.call}
                onApproval={onApproval}
                onProvideSecret={onProvideSecret}
              />
            )
        }
      })}
    </>
  )
}

function UserMessage({ message }: { message: UIMessage }) {
  const origin = originOf(message)
  const text = messageText(message)

  if (origin?.kind === "bot") {
    const meta = message.metadata as MessageMeta | undefined
    const label = meta?.taskResult
      ? "Result from"
      : meta?.task
        ? "Task from"
        : "Message from"
    return (
      <>
        <SystemEvent>
          {label}{" "}
          <span className="inline-flex items-center gap-1.5 align-middle font-medium text-kumo-default">
            <BotAvatar avatar={origin.avatar ?? "blue-rectangle"} size={16} />
            {origin.name}
          </span>
        </SystemEvent>
        <div className="w-fit max-w-[85%] rounded-[20px] border border-kumo-line px-4 py-2.5 break-words text-kumo-default">
          <Prose text={stripOriginHeader(text)} />
        </div>
      </>
    )
  }
  if (origin?.kind === "agent") {
    const meta = message.metadata as MessageMeta | undefined
    return (
      <>
        <SystemEvent>
          <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
            <PlugsConnectedIcon size={14} className="shrink-0" />
            <span className="truncate">
              {meta?.task ? "Task from" : "Message from"}{" "}
              <span className="font-medium text-kumo-default">
                {origin.name}
              </span>
            </span>
          </span>
        </SystemEvent>
        <div className="w-fit max-w-[85%] rounded-[20px] border border-kumo-line px-4 py-2.5 break-words text-kumo-default">
          <Prose text={stripOriginHeader(text)} />
        </div>
      </>
    )
  }
  if (origin?.kind === "pipeline") {
    return (
      <>
        <SystemEvent>
          <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
            <PipelineIcon size={14} className="shrink-0" />
            <span className="truncate">Pipeline · {origin.name}</span>
          </span>
        </SystemEvent>
        <div className="w-fit max-w-[85%] rounded-[20px] border border-kumo-line px-4 py-2.5 break-words text-kumo-default">
          <Prose text={stripOriginHeader(text)} />
        </div>
      </>
    )
  }
  if (
    origin?.kind === "routine" ||
    origin?.kind === "email" ||
    origin?.kind === "webhook" ||
    origin?.kind === "app" ||
    origin?.kind === "crawl" ||
    origin?.kind === "script"
  ) {
    const [Icon, label] =
      origin.kind === "routine"
        ? [ClockIcon, `Routine · ${origin.name}`]
        : origin.kind === "email"
          ? [EnvelopeSimpleIcon, `Email from ${origin.name}`]
          : origin.kind === "app"
            ? [AppWindowIcon, `Changes in ${origin.name}`]
            : origin.kind === "crawl"
              ? [CrawlIcon, `Crawl finished · ${origin.name}`]
              : origin.kind === "script"
                ? [TerminalIcon, `Script finished · ${origin.name}`]
                : [WebhooksLogoIcon, `Webhook · ${origin.name}`]
    return (
      <SystemEvent>
        <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </SystemEvent>
    )
  }
  // Check-ins are invisible: only what the bot chose to say shows up.
  if (origin?.kind === "check-in") return null
  if (origin?.kind === "settings") {
    return <SystemEvent>{origin.name}</SystemEvent>
  }
  return (
    <div className="ml-auto w-fit max-w-[75%] rounded-[22px] bg-kumo-contrast px-[18px] py-3 text-[15px] leading-[1.65] text-pretty whitespace-pre-wrap text-kumo-inverse">
      {splitMentions(text).map((segment, i) =>
        segment.kind === "bot" ? (
          <BotMention key={i} botId={segment.botId} label={segment.label} />
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        )
      )}
    </div>
  )
}

interface Row {
  message: UIMessage
  blocks: Block[]
  /** When the turn started, for time dividers. Older messages have none. */
  at?: number
  durationMs?: number
}

function isQuietPrefix(message: UIMessage) {
  const text = messageText(message).trim()
  return text.length > 0 && NO_UPDATE.startsWith(text)
}

const MOMENT_GAP_MS = 30 * 60_000

function startsNewMoment(at: number, previous: number | undefined) {
  if (previous === undefined) return true
  return (
    at - previous > MOMENT_GAP_MS ||
    new Date(at).toDateString() !== new Date(previous).toDateString()
  )
}

function TimeDivider({ at }: { at: number }) {
  const date = new Date(at)
  const today = new Date().toDateString() === date.toDateString()
  const label = today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
  return (
    <p className="pt-3 text-center text-xs text-kumo-subtle tabular-nums">
      <time dateTime={date.toISOString()}>{label}</time>
    </p>
  )
}

/** The anchor a delegated task's message carries, for links into the chat. */
function taskAnchor(message: UIMessage) {
  const task = message.role === "user" ? metaOf(message).task : undefined
  return task ? `task-${task.id}` : undefined
}

export function Thread({
  bot,
  messages,
  busy,
  botId,
  getLiveView,
  getBrowserFrame,
  navigateBrowser,
  readFile,
  onApproval,
  onProvideSecret,
  onAnswerChoice,
  scriptApprovals,
  onScriptApproval,
  unreadFrom,
}: ThreadProps) {
  // A link to one task's message (from a pipeline run) opens the thread there.
  const hash = useLocation({ select: (l) => l.hash })
  const anchorId = hash.startsWith("task-") ? hash : undefined
  const { scroller, content, onScroll, pin, release } =
    useFollowBottom(anchorId)
  // Messages already present on first render are history: only messages
  // that arrive afterwards get the entrance animation.
  const history = useRef<Set<string> | null>(null)
  history.current ??= new Set(messages.map((m) => m.id))
  const isNew = (id: string) => !history.current?.has(id)

  const hydrated = useHydrated()
  const rendered = useMemo(() => {
    const rows: Row[] = []
    let background = false
    let turnAt: number | undefined
    for (const message of messages) {
      const meta = metaOf(message)
      if (message.role === "user") {
        background = meta.background === true
        turnAt = meta.at
        if (meta.origin?.kind === "check-in") continue
        rows.push({ message, blocks: [], at: meta.at })
        continue
      }
      // A background reply of NO_UPDATE (or its first streamed characters)
      // means the bot decided to stay quiet.
      if (background && (isQuietReply(message) || isQuietPrefix(message))) {
        continue
      }
      let blocks = toBlocks(message)
      if (background) {
        // Only the bot's final message counts in background work; drop any
        // narration it wrote between tool calls.
        const last = blocks.findLast((b) => b.kind === "text")
        blocks = blocks.filter((b) => b.kind !== "text" || b === last)
      }
      rows.push({
        message,
        blocks,
        at: meta.at ?? turnAt,
        durationMs: meta.durationMs,
      })
    }
    return rows
  }, [messages])
  const latestComputerKey = useMemo(
    () =>
      rendered.flatMap((r) => r.blocks).findLast((b) => b.kind === "computer")
        ?.key,
    [rendered]
  )

  // If the linked message renders only after the history (or the link
  // changes while the thread is open), scroll to it then. Either way it
  // glows once so the eye finds it.
  const jumped = useRef<string | null>(null)
  useEffect(() => {
    if (!anchorId || jumped.current === anchorId) return
    const el = document.getElementById(anchorId)
    if (!el) return
    jumped.current = anchorId
    release()
    el.scrollIntoView({ block: "start" })
    el.dataset.flash = ""
    const timer = setTimeout(() => delete el.dataset.flash, 1600)
    return () => clearTimeout(timer)
  }, [anchorId, rendered, release])

  // Sending a message brings the thread back down, even from far up.
  const lastMessage = messages.at(-1)
  const sentId =
    lastMessage?.role === "user" && isNew(lastMessage.id)
      ? lastMessage.id
      : null
  useLayoutEffect(() => {
    if (sentId) pin()
  }, [sentId, pin])

  const lastRow = rendered.at(-1)
  const lastBlocks = lastRow?.blocks ?? []
  const replying = busy && lastRow?.message.role === "assistant"
  // Once the reply has text or work to show, it carries its own progress.
  const showsProgress =
    replying &&
    lastBlocks.some(
      (b) => b.kind === "text" || b.kind === "steps" || b.kind === "computer"
    )
  const waitingOnUser = bot.status === "action_needed"

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div
        ref={content}
        className="mx-auto flex max-w-[820px] flex-col gap-5 px-4 pt-2 pb-8 md:px-6"
      >
        {rendered.map(({ message, blocks, at, durationMs }, index) => (
          <Fragment key={message.id}>
            {message.id === unreadFrom ? (
              <div
                className="flex items-center gap-3 text-xs font-medium text-kumo-danger"
                role="separator"
                aria-label="New messages"
              >
                <span className="h-px flex-1 bg-kumo-danger/30" />
                New
                <span className="h-px flex-1 bg-kumo-danger/30" />
              </div>
            ) : null}
            <div
              // Pipeline runs link here: /bots/<id>#task-<taskId>.
              id={taskAnchor(message)}
              className={`flex scroll-mt-6 flex-col gap-3 ${isNew(message.id) ? "msg-enter" : ""}`}
              data-from={message.role === "user" ? "user" : "bot"}
            >
              {/* Time zone and locale are the viewer's, so only after hydration. */}
              {hydrated &&
              at &&
              startsNewMoment(at, rendered[index - 1]?.at) ? (
                <TimeDivider at={at} />
              ) : null}
              {message.role === "user" ? (
                <UserMessage message={message} />
              ) : (
                <AssistantMessage
                  blocks={blocks}
                  live={replying && index === rendered.length - 1}
                  startedAt={at}
                  durationMs={durationMs}
                  botId={botId}
                  latestComputerKey={latestComputerKey}
                  getLiveView={getLiveView}
                  getBrowserFrame={getBrowserFrame}
                  navigateBrowser={navigateBrowser}
                  readFile={readFile}
                  onApproval={onApproval}
                  onProvideSecret={onProvideSecret}
                  onAnswerChoice={onAnswerChoice}
                />
              )}
            </div>
          </Fragment>
        ))}
        {scriptApprovals?.map((approval) => (
          <div
            key={approval.callId}
            className="flex flex-col gap-3"
            data-from="bot"
          >
            <ScriptApprovalCard
              approval={approval}
              onScriptApproval={onScriptApproval}
            />
          </div>
        ))}
        {busy && !showsProgress && !waitingOnUser ? (
          <div
            className="msg-enter flex items-center gap-2.5 pl-1"
            data-from="bot"
            role="status"
            aria-live="polite"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-(--fill-hover) text-kumo-default">
              <Loader size="sm" />
            </span>
            <ShimmerText
              text={bot.status === "working" ? "Working" : "Thinking"}
              className="text-[15px]"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
