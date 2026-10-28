import { useEffect, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { EmptyRow, FIELD, Group, Row, RowAction } from "@/components/group"
import {
  EyeIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons"
import { connectionStatus } from "@/lib/connection-status"
import { useHub } from "@/lib/hub-context"
import type { Connection } from "@/lib/types"

interface HeaderRow {
  key: number
  name: string
  value: string
}

// Executor on Cloudflare sits behind Access; bots sign in with a service token.
const EXECUTOR_HEADERS = ["CF-Access-Client-Id", "CF-Access-Client-Secret"]

const PARALLEL_MCP_URL =
  "https://mcp.parallel.ai/mcp?tools=web_search,web_fetch"

function isParallelConnection(value: string) {
  try {
    const url = new URL(value)
    return (
      [
        "https://mcp.parallel.ai",
        "https://search.parallel.ai",
        "https://search-mcp.parallel.ai",
      ].includes(url.origin) &&
      ["/mcp", "/mcp-oauth"].includes(url.pathname.replace(/\/+$/, ""))
    )
  } catch {
    return false
  }
}

/** Official marks from https://assets.parallel.ai/llms.txt, served locally. */
function ParallelMark() {
  return (
    <>
      <img
        src="/parallel-symbol.svg"
        alt=""
        width={20}
        height={20}
        className="size-5 dark:hidden"
      />
      <img
        src="/parallel-symbol-white.svg"
        alt=""
        width={20}
        height={20}
        className="hidden size-5 dark:block"
      />
    </>
  )
}

/** The hub owns the connection; all of this user's bots get its tools. */
function ParallelQuickConnect() {
  const hub = useHub()
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    if (!hub.live || saving || added) return
    setError(null)
    setSaving(true)
    try {
      await hub.addConnection({ name: "Parallel", url: PARALLEL_MCP_URL })
      // Keep it disabled until live state moves it to Your connections.
      setAdded(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not connect to Parallel."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Group
        title="Quick connect"
        hint="No API key needed. Free access has lower rate limits."
      >
        <Row
          icon={<ParallelMark />}
          label="Parallel"
          detail="Search the web and read pages."
        >
          <Button
            type="button"
            aria-label={added ? "Parallel added" : "Connect Parallel"}
            size="sm"
            variant="primary"
            className="btn-ink min-h-10 shrink-0 rounded-full"
            loading={saving}
            disabled={!hub.live || saving || added}
            onClick={() => void connect()}
          >
            {added ? "Added" : "Connect"}
          </Button>
        </Row>
      </Group>
      {error ? (
        <p role="alert" className="px-1.5 text-xs text-pretty text-kumo-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

let nextKey = 0
function emptyRow(name = ""): HeaderRow {
  return { key: nextKey++, name, value: "" }
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A secret header value; hidden until you choose to look. */
function SecretField({
  value,
  label,
  onChange,
}: {
  value: string
  label: string
  onChange: (value: string) => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type={shown ? "text" : "password"}
        aria-label={label}
        placeholder="Value"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} h-8 min-w-0 font-mono text-[13px]`}
      />
      <RowAction
        label={shown ? "Hide value" : "Show value"}
        onClick={() => setShown((v) => !v)}
      >
        <EyeIcon size={16} />
      </RowAction>
    </span>
  )
}

function AddConnection() {
  const hub = useHub()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: number, patch: Partial<HeaderRow>) {
    setHeaders((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row))
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      new URL(url)
    } catch {
      setError("Enter the full URL of the MCP endpoint, starting with https://")
      return
    }
    const missing = headers.find((h) => h.name.trim() && !h.value)
    if (missing) {
      setError(`Add a value for ${missing.name}, or remove that header.`)
      return
    }
    setSaving(true)
    try {
      await hub.addConnection({
        name,
        url,
        headers: Object.fromEntries(
          headers
            .filter((h) => h.name.trim())
            .map((h) => [h.name.trim(), h.value])
        ),
      })
      setName("")
      setUrl("")
      setHeaders([])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add that connection."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <Group
        title="Add a connection"
        action={
          <button
            type="button"
            onClick={() => {
              setName((n) => n || "Executor")
              setHeaders(EXECUTOR_HEADERS.map((h) => emptyRow(h)))
            }}
            className="pressable h-7 rounded-full px-2.5 text-xs text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
          >
            Use Executor preset
          </button>
        }
        hint="Headers are sent with every request, e.g. a Cloudflare Access service token. Values stay on the server and are never shown to a model."
      >
        <Row label="Name">
          <input
            aria-label="Name"
            placeholder="Executor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${FIELD} h-8 max-w-[60%] text-right`}
          />
        </Row>
        <Row label="MCP endpoint">
          <input
            aria-label="MCP endpoint"
            placeholder="https://executor.example.com/mcp"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={`${FIELD} h-8 max-w-[70%] text-right`}
          />
        </Row>
        {headers.map((row) => (
          <li
            key={row.key}
            className="flex min-h-14 items-center gap-3 border-t border-kumo-line py-3 pr-3 pl-4"
          >
            <input
              aria-label="Header name"
              placeholder="Header"
              spellCheck={false}
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value })}
              className={`${FIELD} h-8 w-48! shrink-0 font-mono text-[13px]`}
            />
            <SecretField
              label={`Value for ${row.name || "header"}`}
              value={row.value}
              onChange={(value) => update(row.key, { value })}
            />
            <RowAction
              label={`Remove ${row.name || "header"}`}
              danger
              onClick={() =>
                setHeaders((rows) => rows.filter((r) => r.key !== row.key))
              }
            >
              <TrashIcon size={16} />
            </RowAction>
          </li>
        ))}
        <li className="border-t border-kumo-line">
          <button
            type="button"
            onClick={() => setHeaders((rows) => [...rows, emptyRow()])}
            className="flex min-h-14 w-full items-center gap-3 py-3 pr-3 pl-4 text-left text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:bg-(--fill-hover)"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover)">
              <PlusIcon size={14} />
            </span>
            Add a header
          </button>
        </li>
      </Group>
      <div className="flex items-center justify-end gap-3 px-1.5">
        {error ? (
          <p
            role="alert"
            className="flex-1 text-xs text-pretty text-kumo-danger"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          size="sm"
          variant="primary"
          className="btn-ink rounded-full"
          loading={saving}
          disabled={!hub.live || !url.trim()}
        >
          Connect
        </Button>
      </div>
    </form>
  )
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const hub = useHub()
  const [removing, setRemoving] = useState(false)
  const needsSignIn = connection.status === "authenticating"

  const [retrying, setRetrying] = useState(false)
  const failed = ![
    "ready",
    "authenticating",
    "connecting",
    "discovering",
  ].includes(connection.status)

  async function retry() {
    setRetrying(true)
    try {
      await hub.reconnect(connection.id)
    } finally {
      setRetrying(false)
    }
  }

  async function remove() {
    setRemoving(true)
    try {
      await hub.removeConnection(connection.id)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Row
      icon={
        isParallelConnection(connection.url) ? (
          <ParallelMark />
        ) : (
          <PlugsConnectedIcon size={14} />
        )
      }
      label={connection.name}
      detail={
        <>
          <span
            className={
              connection.status === "ready" ? undefined : "text-kumo-warning"
            }
          >
            {connectionStatus(connection)}
          </span>
          {" · "}
          {hostOf(connection.url)}
          {connection.headerNames.length > 0
            ? ` · sends ${connection.headerNames.join(", ")}`
            : ""}
          {connection.lastFailure ? (
            <span
              className="text-kumo-warning"
              title={connection.lastFailure.message}
            >
              {" · "}
              {connection.lastFailure.kind === "auth"
                ? "Sign-in expired, reconnect it"
                : connection.lastFailure.kind === "unreachable"
                  ? "Last call could not reach it"
                  : "Last call failed"}
            </span>
          ) : null}
        </>
      }
    >
      {needsSignIn && connection.authUrl ? (
        // One sign-in for the whole account; every bot uses the result.
        <a
          href={connection.authUrl}
          className="pressable inline-flex h-8 shrink-0 items-center rounded-full bg-kumo-contrast px-3.5 text-sm font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          Sign in
        </a>
      ) : null}
      {failed ? (
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full"
          loading={retrying}
          disabled={!hub.live}
          onClick={() => void retry()}
        >
          Try again
        </Button>
      ) : null}
      <RowAction
        label={`Remove ${connection.name}`}
        danger
        disabled={!hub.live || removing}
        onClick={() => void remove()}
      >
        <TrashIcon size={16} />
      </RowAction>
    </Row>
  )
}

export function ConnectionsSettings({ error }: { error?: string }) {
  const hub = useHub()
  const { live, refreshConnections } = hub

  // Pick up a sign-in that just finished in this tab.
  useEffect(() => {
    if (live) refreshConnections()
  }, [live, refreshConnections])

  return (
    <div className="space-y-8">
      <p className="px-1.5 text-sm text-pretty text-kumo-subtle">
        Bots reach your apps through their APIs first and only open a browser
        when there is no API. Connect an{" "}
        <a
          href="https://executor.sh/docs/hosted/cloudflare"
          target="_blank"
          rel="noreferrer noopener"
          className="text-kumo-default underline decoration-kumo-line underline-offset-2 hover:decoration-current"
        >
          Executor
        </a>{" "}
        gateway for Gmail, Calendar, Sheets and the rest through one endpoint,
        or add any MCP server directly.
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-kumo-danger-tint px-4 py-3 text-sm text-pretty text-kumo-danger"
        >
          Sign-in didn't finish: {error}
        </p>
      ) : null}

      <Group
        title="Your connections"
        hint="Every bot can use every connection, and you only sign in once."
      >
        {hub.state.connections.length === 0 ? (
          <EmptyRow>No connections yet</EmptyRow>
        ) : (
          hub.state.connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} />
          ))
        )}
      </Group>

      {!hub.state.connections.some((connection) =>
        isParallelConnection(connection.url)
      ) ? (
        <ParallelQuickConnect />
      ) : null}

      <AddConnection />
    </div>
  )
}
