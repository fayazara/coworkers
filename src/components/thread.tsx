import {
  Fragment,
  useContext,
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
  CheckIcon,
  ClockIcon,
  CrawlIcon,
  EnvelopeSimpleIcon,
  PipelineIcon,
  PlugsConnectedIcon,
  TerminalIcon,
  WebhooksLogoIcon,
  XIcon,
} from "@/components/icons"
import { AppIcon } from "@/components/app-icon"
import { BotAvatar } from "@/components/bot-avatar"
import { BotMention } from "@/components/bot-mention"
import { CaptureCard } from "@/components/capture-card"
import { ArgsView, PreviewView } from "@/components/call-preview"
import { CodeBlock } from "@/components/code-block"
import { SkillInstall } from "@/components/skill-install"
import { ComputerCard } from "@/components/computer-card"
import { ShimmerText } from "@/components/shimmer-text"
import { SignInButton } from "@/components/sign-in-button"
import { ShowActions, ShowBlocks } from "@/components/show-blocks"
import { ShopCheckoutCard } from "@/components/shop-checkout"
import { ShopResults } from "@/components/shop-results"
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
import { approvalLabels, isEmptyPreview, previewOf } from "@/lib/call-preview"
import { botIdFromLink, splitMentions } from "@/lib/bot-links"
import { choiceKey, choiceOptions, sameEndpoint } from "@/lib/choices"
import { connectionStatus } from "@/lib/connection-status"
import { BotContext } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
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

/** Hands the tapped ask_user option to the bot. Scoped member RPCs also approve it. */
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
  /** Send a suggested next step through a scoped route instead of BotContext. */
  onSend?: (text: string) => void
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

export function ApprovalCard({
  call,
  onApproval,
}: {
  call: ToolCall
  onApproval?: OnApproval
}) {
  const labels = approvalLabels(call.name, call.input)
  const preview = previewOf(call.name, call.input)
  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-3">
      <div className="px-4 pt-1 pb-3">
        <p className="text-[15px] font-semibold text-kumo-default">
          Approval needed
        </p>
        {/* An email, command or file names itself in its preview. */}
        {preview.kind === "fields" ? (
          <p className="mt-0.5 text-[15px] text-pretty text-kumo-default">
            {describeCall(call)}
          </p>
        ) : null}
      </div>
      {!isEmptyPreview(preview) ? <PreviewView preview={preview} /> : null}
      {onApproval && call.approvalId ? (
        <div className="flex gap-2 pt-3 pb-0.5">
          <Button
            variant="primary"
            className="btn-ink rounded-full"
            onClick={() => onApproval(call.approvalId!, true)}
          >
            {labels.approve}
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() =>
              onApproval(call.approvalId!, false, "The user said no.")
            }
          >
            {labels.reject}
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
        <div className="mt-3">
          <ArgsView json={approval.argsJson} tool={approval.tool} />
        </div>
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

/**
 * ask_user: a question with lettered answers, each with the reason it is
 * there. Typing a reply also answers it.
 */
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
  const options = choiceOptions(call.input.options)
  const ready = Boolean(onAnswerChoice && call.approvalId)

  async function pick(option: string) {
    if (!onAnswerChoice || !call.approvalId) return
    setPicking(option)
    setError(null)
    try {
      await onAnswerChoice(call.id, option)
      onApproval?.(call.approvalId, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.")
      setPicking(null)
    }
  }

  return (
    <div className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-2">
      <div className="flex items-start gap-2 pt-1.5 pr-1 pb-1 pl-3">
        <p className="min-w-0 flex-1 py-1.5 text-[15px] font-semibold text-pretty text-kumo-default">
          {String(call.input.question ?? "")}
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          className="icon-btn"
          disabled={!onApproval || !ready || picking !== null}
          onClick={() =>
            onApproval?.(
              call.approvalId!,
              false,
              "The user dismissed the question without answering."
            )
          }
        >
          <XIcon size={16} />
        </button>
      </div>
      <ul>
        {options.map((option, index) => (
          <li key={option.label}>
            <button
              type="button"
              disabled={!ready || picking !== null}
              onClick={() => void pick(option.label)}
              className="pressable flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-none hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:pointer-events-none"
            >
              <span
                aria-hidden="true"
                className="mt-px flex size-6 shrink-0 items-center justify-center rounded-lg bg-kumo-base text-xs font-medium text-kumo-subtle ring-1 ring-kumo-line"
              >
                {picking === option.label ? (
                  <Loader size="sm" />
                ) : (
                  choiceKey(index)
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] text-pretty text-kumo-default">
                  {option.label}
                </span>
                {option.detail ? (
                  <span className="mt-0.5 block text-[13px] text-pretty text-kumo-subtle">
                    {option.detail}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="px-3 pt-1 pb-2 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * connect_app: the bot offers an app, the user connects and signs in right
 * here. The connection is made over the user's own socket to the hub; the
 * approval only tells the bot the card is done with.
 */
function ConnectCard({
  call,
  onApproval,
}: {
  call: ToolCall
  onApproval?: OnApproval
}) {
  const hub = useHub()
  const { refreshConnections } = hub
  const name = String(call.input.name ?? "App")
  const url = String(call.input.url ?? "")
  const host = linkHost(url)
  const connection = hub.state.connections.find((c) => sameEndpoint(c.url, url))
  const done = call.state === "done"
  const connected = done || connection?.status === "ready"
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once it is connected the bot carries on by itself.
  const { approvalId } = call
  const answered = useRef(false)
  useEffect(() => {
    if (done || !connected || !onApproval || !approvalId) return
    if (answered.current) return
    answered.current = true
    onApproval(approvalId, true)
  }, [done, connected, onApproval, approvalId])

  // The sign-in happens in another tab: look again when this one is back.
  const pending = !done && connection !== undefined && !connected
  useEffect(() => {
    if (!pending) return
    const check = () => {
      if (document.visibilityState === "visible") refreshConnections()
    }
    document.addEventListener("visibilitychange", check)
    window.addEventListener("focus", check)
    return () => {
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("focus", check)
    }
  }, [pending, refreshConnections])

  async function run(action: () => Promise<unknown>) {
    setAdding(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect it.")
    } finally {
      setAdding(false)
    }
  }

  const connecting =
    connection?.status === "connecting" || connection?.status === "discovering"
  const needsSignIn =
    connection?.status === "authenticating" && connection.authUrl
  const failed = pending && !connecting && !needsSignIn

  return (
    <div className="w-full max-w-[640px]">
      <div className="flex items-center gap-3 rounded-3xl bg-kumo-tint py-3 pr-3 pl-4">
        <AppIcon host={host} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-kumo-default">
            {name}
          </p>
          <p className="text-sm text-pretty text-kumo-subtle">
            {failed && connection
              ? connectionStatus(connection)
              : String(call.input.why ?? "")}
          </p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1 pr-1 text-sm font-medium text-kumo-success">
            <CheckIcon size={16} />
            Connected
          </span>
        ) : needsSignIn ? (
          <SignInButton
            connectionId={connection.id}
            newTab
            className="pressable inline-flex h-9 shrink-0 items-center rounded-full bg-kumo-contrast px-4 text-sm font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
          />
        ) : connecting ? (
          <span className="shrink-0 pr-1">
            <ShimmerText text="Connecting" className="text-sm" />
          </span>
        ) : (
          <Button
            variant="primary"
            className="btn-ink shrink-0 rounded-full"
            loading={adding}
            disabled={!hub.live || !onApproval || !approvalId}
            onClick={() =>
              void run(() =>
                connection
                  ? hub.reconnect(connection.id)
                  : hub.addConnection({ name, url })
              )
            }
          >
            {connection ? "Try again" : "Connect"}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
      {done ? null : (
        <p className="flex flex-wrap items-center gap-x-1.5 px-4 pt-2 text-xs text-kumo-subtle">
          <span>
            You sign in at {host ?? "the app"}. Your bots never see the
            password.
          </span>
          {onApproval && approvalId ? (
            <button
              type="button"
              className="rounded underline decoration-kumo-line underline-offset-2 outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
              onClick={() =>
                onApproval(
                  approvalId,
                  false,
                  "The user chose not to connect it."
                )
              }
            >
              Not now
            </button>
          ) : null}
        </p>
      )}
    </div>
  )
}

/** install_skill: the user reads the skill and installs it from here. */
function SkillCard({
  call,
  botId,
  onApproval,
}: {
  call: ToolCall
  botId?: string
  onApproval?: OnApproval
}) {
  return (
    <div className="msg-enter w-full max-w-[640px] rounded-3xl bg-kumo-tint p-4">
      {botId && onApproval && call.approvalId ? (
        <SkillInstall
          source={String(call.input.source ?? "")}
          botId={botId}
          forAllBots={call.input.for_all_bots === true}
          onInstalled={() => onApproval(call.approvalId!, true)}
          onCancel={() =>
            onApproval(call.approvalId!, false, "The user said no.")
          }
        />
      ) : null}
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
  onPick,
}: {
  blocks: Block[]
  /** This reply is still being written. */
  live: boolean
  /** Sends a shown action as the user's next message. Newest reply only. */
  onPick?: (text: string) => void
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
  const { work, shown, replyKey } = toTurn(blocks)
  // While the bot works, the status line trails the turn and steps aside
  // whenever it is writing. Once the reply is in, the steps sit above it.
  const writing = live && replyKey !== undefined
  const group =
    work.length && !writing ? (
      <WorkGroup
        calls={work}
        live={live}
        startedAt={startedAt}
        durationMs={durationMs}
      />
    ) : null
  const groupAt =
    live || !replyKey
      ? shown.length
      : shown.findIndex((b) => b.key === replyKey)
  return (
    <>
      {shown.map((block, index) => (
        <Fragment key={block.key}>
          {index === groupAt ? group : null}
          {renderBlock(block, index)}
        </Fragment>
      ))}
      {groupAt >= shown.length ? group : null}
      <ShowActions
        calls={shown.flatMap((b) => (b.kind === "show" ? [b.call] : []))}
        onPick={live ? undefined : onPick}
      />
    </>
  )

  function renderBlock(block: Block, index: number) {
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
      case "shop-results":
        return <ShopResults key={block.key} call={block.call} botId={botId} />
      case "shop-checkout":
        return <ShopCheckoutCard key={block.key} call={block.call} />
      case "connect":
        return <ConnectCard call={block.call} onApproval={onApproval} />
      case "show":
        return <ShowBlocks call={block.call} />
      case "skill":
        return (
          <SkillCard
            key={block.key}
            call={block.call}
            botId={botId}
            onApproval={onApproval}
          />
        )
    }
  }
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
  onSend,
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
  // Absent on the server render and until the chat is live.
  const contextSend = useContext(BotContext)?.send
  const pick = onSend ?? contextSend
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
  // The turn shows its own progress while the bot is writing, while its
  // status line is up (steps, and no reply yet), or while it is in the
  // browser. In the gaps between, the indicator below fills in.
  const lastPart = lastRow?.message.parts.at(-1)
  const lastTurn = toTurn(lastBlocks)
  const showsProgress =
    replying &&
    ((lastPart?.type === "text" && lastPart.state === "streaming") ||
      (lastTurn.work.length > 0 && lastTurn.replyKey === undefined) ||
      lastBlocks.at(-1)?.kind === "computer" ||
      lastBlocks.at(-1)?.kind === "show")
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
                  onPick={
                    !busy && index === rendered.length - 1 ? pick : undefined
                  }
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
