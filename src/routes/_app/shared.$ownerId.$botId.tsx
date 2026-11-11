import { useCallback, useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import type { UIMessage } from "ai"
import {
  getSharedBot,
  messageSharedBot,
  uploadSharedBotFile,
  downloadSharedBotFile,
  answerSharedBotChoice,
} from "@/lib/sharing-fns"
import { Thread } from "@/components/thread"
import { Composer } from "@/components/composer"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { BotHeader } from "@/components/bot-header"
import { ComputerIcon } from "@/components/icons"
import { ComputerPanel } from "@/components/computer-panel"
import { SharedAppsPane } from "@/components/apps-pane"
import { SplitView } from "@/components/split-view"
import { useLatchedWhileClosing } from "@/components/slide-shell"
import { useLayout } from "@/lib/layout-context"
import { sharedComputerConnection } from "@/lib/shared-computer"

export const Route = createFileRoute("/_app/shared/$ownerId/$botId")({
  loader: ({ params }) => getSharedBot({ data: params }),
  gcTime: 0,
  staleTime: 0,
  component: SharedBot,
})

function SharedBot() {
  const params = Route.useParams()
  const initial = Route.useLoaderData()
  return (
    <SharedBotChat
      key={`${params.ownerId}:${params.botId}`}
      params={params}
      initial={initial}
    />
  )
}

export function SharedBotChat({
  params,
  initial,
}: {
  params: { ownerId: string; botId: string }
  initial: Awaited<ReturnType<typeof getSharedBot>>
}) {
  const [snapshot, setSnapshot] = useState<typeof initial | null>(initial)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [computerOpen, setComputerOpen] = useState(false)
  const shownComputer = useLatchedWhileClosing(computerOpen, computerOpen)
  const { widths, setWidth } = useLayout()
  const computer = useMemo(
    () => sharedComputerConnection(params),
    [params.ownerId, params.botId]
  )
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getSharedBot({ data: params }))
      setError("")
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : "Access unavailable")
    }
  }, [params.ownerId, params.botId])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!stopped) await refresh()
      if (!stopped) timer = setTimeout(tick, 3000)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [refresh])

  async function send(text: string) {
    setSending(true)
    setError("")
    try {
      await messageSharedBot({
        data: { ...params, text, requestId: crypto.randomUUID() },
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message")
    } finally {
      setSending(false)
    }
  }

  async function download(path: string) {
    try {
      const { base64 } = await downloadSharedBotFile({
        data: { ...params, path: path.replace(/^\/workspace\//, "") },
      })
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" })
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = path.split("/").at(-1) ?? "file"
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download file")
    }
  }

  const messages = snapshot
    ? (JSON.parse(snapshot.messagesJson) as UIMessage[])
    : []
  const questions = messages
    .flatMap((m) => m.parts)
    .filter(
      (p) =>
        p.type === "tool-ask_user" &&
        "state" in p &&
        p.state === "approval-requested"
    ) as unknown as {
    toolCallId: string
    input: { question?: string; options?: string[] }
  }[]

  return (
    <SplitView
      id="shared-bot"
      side="right"
      label="Computer"
      open={computerOpen && !!snapshot}
      width={widths.panel ?? "44vw"}
      minWidth={360}
      maxWidth="70%"
      mainMinWidth={420}
      onWidthChange={(px) => setWidth("panel", px)}
      onClose={() => setComputerOpen(false)}
      panel={
        shownComputer && snapshot ? (
          <ComputerPanel
            agent={computer}
            name={snapshot.state.name}
            apps={<SharedAppsPane apps={snapshot.apps} />}
            onDownload={download}
            onClose={() => setComputerOpen(false)}
          />
        ) : null
      }
    >
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <BotHeader bot={snapshot?.state}>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full bg-(--fill-hover) px-2 py-1 text-xs text-kumo-subtle max-sm:sr-only">
              Shared
            </span>
            <Tooltip
              content={computerOpen ? "Close computer" : "Computer"}
              render={
                <button
                  type="button"
                  aria-label="Computer"
                  aria-pressed={computerOpen}
                  disabled={!snapshot}
                  className="icon-btn"
                  onClick={() => setComputerOpen((open) => !open)}
                >
                  <ComputerIcon size={20} />
                </button>
              }
            />
          </div>
        </BotHeader>
        {snapshot ? (
          <>
            {snapshot.memory ? (
              <details className="border-b border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
                <summary className="cursor-pointer">Bot memory</summary>
                <pre className="mt-2 max-h-48 overflow-auto text-wrap">
                  {snapshot.memory}
                </pre>
              </details>
            ) : null}
            <Thread
              bot={snapshot.state}
              messages={messages}
              busy={
                snapshot.state.status === "thinking" ||
                snapshot.state.status === "working"
              }
              getLiveView={computer.stub.getLiveView}
              getBrowserFrame={computer.stub.getBrowserFrame}
              navigateBrowser={computer.stub.navigateBrowser}
              readFile={computer.stub.readFileData}
            />
            {questions.map((question) => (
              <div
                key={question.toolCallId}
                className="mx-auto w-full max-w-[820px] px-4 py-2"
              >
                <p className="text-sm">{question.input.question}</p>
                <div className="flex flex-wrap gap-2">
                  {question.input.options?.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className="min-h-11 rounded-xl border border-kumo-line px-3 text-sm"
                      onClick={() => {
                        void answerSharedBotChoice({
                          data: {
                            ...params,
                            toolCallId: question.toolCallId,
                            option,
                          },
                        })
                          .then(refresh)
                          .catch((err: Error) => setError(err.message))
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="flex-1" />
        )}
        {error ? (
          <p role="alert" className="px-4 py-2 text-sm text-kumo-danger">
            {error}
          </p>
        ) : null}
        <Composer
          botName={snapshot?.state.name ?? "bot"}
          disabled={!snapshot || !!snapshot.state.paused || sending}
          busy={false}
          onSend={(text) => void send(text)}
          onStop={() => {}}
          onAttach={async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            let binary = ""
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return (
              await uploadSharedBotFile({
                data: { ...params, name: file.name, base64: btoa(binary) },
              })
            ).path
          }}
        />
      </section>
    </SplitView>
  )
}
