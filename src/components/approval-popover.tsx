import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Popover } from "@cloudflare/kumo/components/popover"
import { ArgsView, CallPreviewView } from "@/components/call-preview"
import { useHub } from "@/lib/hub-context"
import { approvalLabels } from "@/lib/call-preview"
import { describeCall, toBlocks } from "@/lib/message-parts"
import type { ReactElement } from "react"
import type { ToolCall } from "@/lib/message-parts"
import type { BotSummary, ScriptApproval } from "@/lib/types"

interface Waiting {
  /** Plain approval cards, which can be answered right here. */
  calls: ToolCall[]
  /** App calls from scripts, which can too. */
  scripts: ScriptApproval[]
  /** Questions, credentials and hand-offs, which need the chat. */
  others: number
}

/**
 * Hovering a bot that needs you shows what it is waiting on, so an approval
 * can be answered without leaving the current chat.
 */
export function ApprovalPopover({
  bot,
  children,
}: {
  bot: BotSummary
  children: ReactElement
}) {
  const hub = useHub()
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    setError(null)
    Promise.all([hub.waitingParts(bot.id), hub.waitingScripts(bot.id)]).then(
      ([message, scripts]) => {
        if (!current) return
        const blocks = message ? toBlocks(message) : []
        const calls = blocks.flatMap((b) =>
          b.kind === "approval" ? [b.call] : []
        )
        setWaiting({ calls, scripts, others: blocks.length - calls.length })
      },
      () => current && setError("Could not load what it is waiting on.")
    )
    return () => {
      current = false
    }
  }, [open, bot.id, hub])

  async function answer(call: ToolCall, approved: boolean) {
    if (!call.approvalId) return
    setAnswering(call.approvalId)
    setError(null)
    try {
      await hub.answerApproval(bot.id, call.approvalId, approved)
      const rest = waiting?.calls.filter((c) => c.id !== call.id) ?? []
      setWaiting((w) => (w ? { ...w, calls: rest } : w))
      if (rest.length === 0 && !waiting?.scripts.length && !waiting?.others)
        setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.")
    } finally {
      setAnswering(null)
    }
  }

  async function answerScript(
    approval: ScriptApproval,
    approved: boolean,
    all = false
  ) {
    setAnswering(approval.callId)
    setError(null)
    try {
      await hub.answerScriptApproval(bot.id, approval, approved, all)
      const rest =
        waiting?.scripts.filter((s) => s.callId !== approval.callId) ?? []
      setWaiting((w) => (w ? { ...w, scripts: rest } : w))
      if (rest.length === 0 && !waiting?.calls.length && !waiting?.others)
        setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.")
    } finally {
      setAnswering(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={250}
        closeDelay={150}
        render={children}
      />
      <Popover.Content
        side="right"
        align="start"
        sideOffset={12}
        className="w-[360px] max-w-[calc(100vw-32px)] p-3"
      >
        <Popover.Title className="text-[15px] font-semibold text-kumo-default">
          {bot.name} needs you
        </Popover.Title>
        {!waiting && !error ? (
          <div className="flex justify-center py-4">
            <Loader size="sm" />
          </div>
        ) : null}
        {/* Padding keeps the buttons' rings inside the scroller; the
            negative margin keeps the content aligned with the title. */}
        <div className="-mx-1 flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-1 pb-2">
          {waiting?.calls.map((call) => (
            <div key={call.id} className="flex flex-col gap-2 pt-2">
              <p className="text-sm text-kumo-default">{describeCall(call)}</p>
              <CallPreviewView name={call.name} input={call.input} compact />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  className="btn-ink rounded-full"
                  disabled={answering !== null}
                  loading={answering === call.approvalId}
                  onClick={() => void answer(call, true)}
                >
                  {approvalLabels(call.name, call.input).approve}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={answering !== null}
                  onClick={() => void answer(call, false)}
                >
                  {approvalLabels(call.name, call.input).reject}
                </Button>
              </div>
            </div>
          ))}
          {waiting?.scripts.map((approval) => (
            <div key={approval.callId} className="flex flex-col gap-2 pt-2">
              <p className="text-sm text-kumo-default">
                {approval.purpose ? `${approval.purpose}: ` : "A script "}
                wants to use {approval.app} ({approval.tool})
              </p>
              {approval.argsJson !== "{}" ? (
                <ArgsView
                  json={approval.argsJson}
                  tool={approval.tool}
                  compact
                />
              ) : null}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  className="btn-ink rounded-full"
                  disabled={answering !== null}
                  loading={answering === approval.callId}
                  onClick={() => void answerScript(approval, true)}
                >
                  Approve
                </Button>
                {approval.toolName ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={answering !== null}
                    title={`Let this script use ${approval.tool} again without asking, until it finishes`}
                    onClick={() => void answerScript(approval, true, true)}
                  >
                    Approve all
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={answering !== null}
                  onClick={() => void answerScript(approval, false)}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
        {waiting &&
        waiting.calls.length === 0 &&
        waiting.scripts.length === 0 &&
        waiting.others === 0 ? (
          <p className="pt-2 text-sm text-kumo-subtle">
            Nothing is waiting anymore.
          </p>
        ) : null}
        {waiting && waiting.others > 0 ? (
          <Link
            to="/bots/$botId"
            params={{ botId: bot.id }}
            onClick={() => setOpen(false)}
            className="mt-3 block text-sm text-kumo-link hover:underline"
          >
            {waiting.calls.length > 0
              ? "It also asked something. Open the chat"
              : "It asked something. Open the chat to answer"}
          </Link>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-kumo-danger">
            {error}
          </p>
        ) : null}
      </Popover.Content>
    </Popover>
  )
}
