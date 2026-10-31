import { useCallback, useEffect, useRef, useState } from "react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  GlobeIcon,
  ListBulletsIcon,
  PowerIcon,
  WarningIcon,
} from "@/components/icons"
import { AppsPane } from "@/components/apps-pane"
import { useFileData } from "@/components/capture-card"
import type { ReadFileData } from "@/components/capture-card"
import {
  BrowserChrome,
  LiveViewFrame,
  useLiveView,
} from "@/components/computer-card"
import type { BrowserNav } from "@/components/computer-card"
import { CodeBlock, languageForPath } from "@/components/code-block"
import { EmptyState } from "@/components/empty-state"
import { Group, RowAction } from "@/components/group"
import { SidePanel } from "@/components/side-panel"
import { SlidingTabs } from "@/components/sliding-tabs"
import { useBot } from "@/lib/bot-context"
import type { BotConnection } from "@/lib/bot-context"
import type { ActivityEntry } from "@/lib/types"

type Pane = "browser" | "terminal" | "files" | "apps" | "activity"

const PANES: { value: Pane; label: string }[] = [
  { value: "browser", label: "Browser" },
  { value: "terminal", label: "Terminal" },
  { value: "files", label: "Files" },
  { value: "apps", label: "Apps" },
  { value: "activity", label: "Activity" },
]

function BrowserPane({ agent }: { agent: BotConnection }) {
  const getLiveView = useCallback(() => agent.stub.getLiveView(), [agent])
  const { tabs, error, refresh } = useLiveView(getLiveView, true)
  const [index, setIndex] = useState(0)
  const [closing, setClosing] = useState(false)
  const tab = tabs?.[Math.min(index, tabs.length - 1)]

  async function navigate(action: BrowserNav) {
    const moved = await agent.stub.navigateBrowser(action)
    void refresh()
    return moved
  }

  async function close() {
    setClosing(true)
    try {
      await agent.stub.closeBrowser()
      await refresh()
    } finally {
      setClosing(false)
    }
  }

  if (tabs === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }
  if (!tab) {
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<GlobeIcon size={24} />}
          title="Browser is asleep"
          description={
            error ?? "It wakes up when the bot needs to visit a site."
          }
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowClockwiseIcon />}
              onClick={() => void refresh(true)}
            >
              Check again
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-2 pb-4">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={t.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={t === tab}
              className={`h-8 max-w-56 truncate rounded-full px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
                t === tab
                  ? "bg-(--fill-active) text-kumo-default"
                  : "text-kumo-subtle hover:bg-(--fill-hover)"
              }`}
            >
              {t.title || t.pageUrl || "New tab"}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Refresh live view"
          onClick={() => void refresh(true)}
          className="icon-btn size-8!"
        >
          <ArrowClockwiseIcon size={16} />
        </button>
        <button
          type="button"
          aria-label="Close browser session"
          disabled={closing}
          onClick={() => void close()}
          className="icon-btn size-8!"
        >
          {closing ? <Loader size="sm" /> : <PowerIcon size={16} />}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.08]">
        <BrowserChrome pageUrl={tab.pageUrl} onNavigate={navigate} />
        <LiveViewFrame tab={tab} interactive className="min-h-0 flex-1" />
      </div>
    </div>
  )
}

interface TerminalLine {
  id: number
  command: string
  output: string
  exitCode: number | null
}

function TerminalPane({ agent }: { agent: BotConnection }) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [command, setCommand] = useState("")
  const [running, setRunning] = useState(false)
  const nextId = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  // Seed with the bot's own recent shell commands.
  useEffect(() => {
    let cancelled = false
    void agent.stub.getActivity(200).then((entries) => {
      if (cancelled) return
      const history = entries
        .filter((e) => e.tool === "exec" || e.tool === "terminal")
        .reverse()
        .map((e) => ({
          id: nextId.current++,
          command: e.summary,
          output: e.tool === "exec" ? "" : e.detail,
          exitCode: e.ok ? 0 : 1,
        }))
      setLines((current) => [...history, ...current])
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [lines])

  async function run() {
    const cmd = command.trim()
    if (!cmd || running) return
    const id = nextId.current++
    setCommand("")
    setRunning(true)
    setLines((l) => [...l, { id, command: cmd, output: "", exitCode: null }])
    let output: string
    let exitCode: number
    try {
      const result = await agent.stub.runCommand(cmd)
      output = [result.stdout, result.stderr].filter(Boolean).join("\n")
      exitCode = result.exitCode
    } catch (err) {
      output = err instanceof Error ? err.message : "Command failed"
      exitCode = 1
    }
    setLines((l) =>
      l.map((line) => (line.id === id ? { ...line, output, exitCode } : line))
    )
    setRunning(false)
  }

  return (
    <div className="mx-4 mt-2 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-kumo-contrast font-mono text-[13px] text-kumo-inverse">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <p className="opacity-60">
            A shell in the bot's computer. Files are under /workspace.
          </p>
        ) : null}
        {lines.map((line) => (
          <div key={line.id} className="mb-3">
            <p className="break-all">
              <span className="opacity-50">$ </span>
              {line.command}
            </p>
            {line.output ? (
              <pre className="mt-1 break-words whitespace-pre-wrap opacity-80">
                {line.output}
              </pre>
            ) : null}
            {line.exitCode !== null && line.exitCode !== 0 ? (
              <p className="mt-1 opacity-60">exit {line.exitCode}</p>
            ) : null}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
        className="flex items-center gap-2 border-t border-white/15 px-4 py-3"
      >
        <span className="opacity-50">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="ls /workspace"
          aria-label="Shell command"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none placeholder:opacity-40"
        />
        {running ? <Loader size="sm" /> : null}
      </form>
    </div>
  )
}

// Trees renders inside a shadow root and is themed through CSS variables.
// Kumo tokens use light-dark(); pin the scheme so the tree follows the app
// rather than the OS setting.
const TREE_STYLE = {
  colorScheme: "light",
  "--trees-bg-override": "transparent",
  "--trees-fg-override": "var(--text-color-kumo-default)",
  "--trees-fg-muted-override": "var(--text-color-kumo-subtle)",
  "--trees-bg-muted-override": "var(--color-kumo-tint)",
  "--trees-selected-bg-override": "var(--color-kumo-fill)",
  "--trees-selected-fg-override": "var(--text-color-kumo-default)",
  "--trees-border-color-override": "var(--color-kumo-line)",
  "--trees-focus-ring-color-override": "var(--color-kumo-focus)",
  "--trees-input-bg-override": "var(--color-kumo-base)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "13px",
} as React.CSSProperties

const WORKSPACE_ROOT = "/workspace"

const BINARY_PREVIEW = /\.(png|jpe?g|gif|webp|pdf)$/i

/** An image or PDF from the bot's files. */
function BinaryPreview({
  path,
  readFile,
}: {
  path: string
  readFile: ReadFileData
}) {
  const { url, error } = useFileData(readFile, path)
  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-kumo-danger">
        {error}
      </p>
    )
  }
  if (!url) {
    return (
      <div className="flex justify-center py-10">
        <Loader size="sm" />
      </div>
    )
  }
  return path.toLowerCase().endsWith(".pdf") ? (
    <iframe
      src={url}
      title={path}
      className="h-full min-h-[480px] w-full border-0"
    />
  ) : (
    <img src={url} alt={path} className="block max-w-full p-4" />
  )
}

function FilesPane({ agent }: { agent: BotConnection }) {
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    content: string
    truncated: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readFile = useCallback<ReadFileData>(
    (path) => agent.stub.readFileData(path),
    [agent]
  )

  const select = useCallback(
    async (path: string) => {
      setSelected(path)
      setPreview(null)
      setError(null)
      if (BINARY_PREVIEW.test(path)) return
      try {
        setPreview(await agent.stub.readFileText(`${WORKSPACE_ROOT}/${path}`))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read file")
      }
    },
    [agent]
  )

  // The model is created once; the latest handler is read through a ref.
  const onSelect = useRef(select)
  onSelect.current = select

  const { model } = useFileTree({
    paths: [],
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    initialExpansion: 1,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)
      // Directories end with "/": selecting one just expands it.
      if (path && !path.endsWith("/")) void onSelect.current(path)
    },
  })

  const refresh = useCallback(async () => {
    try {
      model.resetPaths(await agent.stub.listWorkspace())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list files")
    } finally {
      setLoaded(true)
    }
  }, [agent, model])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="mx-4 mt-2 mb-4 flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06] max-md:flex-col">
      <div className="flex shrink-0 flex-col border-kumo-line max-md:h-1/2 max-md:border-b md:w-60 md:border-r">
        <div className="flex h-10 items-center justify-between pr-1 pl-4">
          <span className="text-xs font-medium text-kumo-subtle">
            {WORKSPACE_ROOT}
          </span>
          <button
            type="button"
            aria-label="Refresh files"
            onClick={() => void refresh()}
            className="icon-btn size-8!"
          >
            <ArrowClockwiseIcon size={16} />
          </button>
        </div>
        {loaded ? null : (
          <div className="flex justify-center py-6">
            <Loader size="sm" />
          </div>
        )}
        <FileTree model={model} className="min-h-0 flex-1" style={TREE_STYLE} />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {selected === null ? (
          <p className="p-4 text-sm text-pretty text-kumo-subtle">
            Pick a file to preview it. Drafts, downloads and finished work all
            live here.
          </p>
        ) : error ? (
          <p role="alert" className="p-4 text-sm text-kumo-danger">
            {error}
          </p>
        ) : BINARY_PREVIEW.test(selected) ? (
          <>
            <p className="sticky top-0 flex h-10 items-center border-b border-kumo-line bg-kumo-base px-4 text-xs text-kumo-subtle">
              {WORKSPACE_ROOT}/{selected}
            </p>
            <BinaryPreview
              path={`${WORKSPACE_ROOT}/${selected}`}
              readFile={readFile}
            />
          </>
        ) : preview === null ? (
          <div className="flex justify-center py-10">
            <Loader size="sm" />
          </div>
        ) : (
          <>
            <p className="sticky top-0 flex h-10 items-center border-b border-kumo-line bg-kumo-base px-4 text-xs text-kumo-subtle">
              {WORKSPACE_ROOT}/{selected}
              {preview.truncated ? " · truncated" : ""}
            </p>
            <CodeBlock
              code={preview.content || "(empty file)"}
              lang={preview.content ? languageForPath(selected) : undefined}
              className="p-4"
            />
          </>
        )}
      </div>
    </div>
  )
}

function ActivityPane({ agent }: { agent: BotConnection }) {
  const [entries, setEntries] = useState<
    (ActivityEntry & { detail: string })[] | null
  >(null)
  const [open, setOpen] = useState<number | null>(null)
  // Rows keep their output mounted after the first open so closing can
  // animate, without highlighting every row up front.
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set())

  function toggle(id: number) {
    setOpen(open === id ? null : id)
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  const load = useCallback(async () => {
    setEntries(await agent.stub.getActivity(200))
  }, [agent])

  useEffect(() => {
    void load()
  }, [load])

  if (entries === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<ListBulletsIcon size={24} />}
          title="No activity yet"
          description="Every tool call this bot makes shows up here."
        />
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
      <Group
        title="Recent tool calls"
        action={
          <RowAction label="Refresh activity" onClick={() => void load()}>
            <ArrowClockwiseIcon size={16} />
          </RowAction>
        }
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-open={open === entry.id}
            className="t-acc border-t border-kumo-line first:border-t-0"
          >
            <button
              type="button"
              onClick={() => toggle(entry.id)}
              aria-expanded={open === entry.id}
              className="flex min-h-14 w-full items-center gap-4 py-3 pr-4 pl-4 text-left outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                  entry.ok
                    ? "bg-(--fill-hover) text-kumo-subtle"
                    : "bg-kumo-warning-tint text-kumo-warning"
                }`}
              >
                {entry.ok ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] text-kumo-default">
                  {entry.tool}
                </span>
                <span className="mt-0.5 block max-w-[75%] truncate text-xs text-kumo-subtle">
                  {entry.summary}
                </span>
              </span>
              <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
                {new Date(entry.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="t-acc-chevron shrink-0 text-kumo-subtle">
                <CaretDownIcon size={14} />
              </span>
            </button>
            <div className="t-acc-panel">
              <div className="t-acc-panel-inner">
                {seen.has(entry.id) ? (
                  <CodeBlock
                    code={entry.detail || "(no output)"}
                    className="mx-4 mb-4 max-h-80 rounded-xl bg-kumo-canvas p-3 outline outline-1 -outline-offset-1 outline-kumo-line"
                  />
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </Group>
    </div>
  )
}

/** The bot's computer: its browser, shell, files and an audit log. */
export function ComputerPanel() {
  const { agent, state } = useBot()
  const [pane, setPane] = useState<Pane>("browser")

  return (
    <SidePanel
      title={`${state.name}'s computer`}
      toolbar={
        <SlidingTabs tabs={PANES} value={pane} onValueChange={setPane} />
      }
    >
      {agent === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader />
        </div>
      ) : pane === "browser" ? (
        <BrowserPane agent={agent} />
      ) : pane === "terminal" ? (
        <TerminalPane agent={agent} />
      ) : pane === "files" ? (
        <FilesPane agent={agent} />
      ) : pane === "apps" ? (
        <AppsPane agent={agent} />
      ) : (
        <ActivityPane agent={agent} />
      )}
    </SidePanel>
  )
}
