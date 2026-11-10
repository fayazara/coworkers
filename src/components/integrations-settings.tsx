import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { AppIcon } from "@/components/app-icon"
import { CopyButton } from "@/components/copy-button"
import {
  EmptyRow,
  FIELD,
  Group,
  Row,
  RowAction,
  SectionHeader,
} from "@/components/group"
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CaretRightIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons"
import { ShimmerText } from "@/components/shimmer-text"
import { SignInButton } from "@/components/sign-in-button"
import { sameEndpoint } from "@/lib/choices"
import { connectionStatus } from "@/lib/connection-status"
import { useHub } from "@/lib/hub-context"
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  integrationFor,
  integrationHeaders,
} from "@/lib/integrations"
import type { Integration, IntegrationCategory } from "@/lib/integrations"
import type { Connection, ConnectionTool } from "@/lib/types"

const LINK =
  "text-kumo-default underline decoration-kumo-line underline-offset-2 hover:decoration-current"

/** Pages under Integrations: the catalog, one app, or a custom server. */
const CUSTOM = "custom"
const customId = (connection: Connection) => `c-${connection.id}`

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function siteOf(url: string) {
  return hostOf(url).replace(/^www\./, "")
}

/** One tile in the catalog: a checked integration, or a server the user added. */
type Item =
  | { key: string; integration: Integration; connection?: Connection }
  | { key: string; integration?: undefined; connection: Connection }

function useItems(): Item[] {
  const hub = useHub()
  return useMemo(() => {
    const connections = hub.state.connections
    const items: Item[] = INTEGRATIONS.map((integration) => ({
      key: integration.id,
      integration,
      connection: connections.find((c) => sameEndpoint(c.url, integration.url)),
    }))
    for (const connection of connections) {
      if (!integrationFor(connection.url)) {
        items.push({ key: customId(connection), connection })
      }
    }
    return items
  }, [hub.state.connections])
}

const ready = (c?: Connection) => c?.status === "ready"
const busy = (c?: Connection) =>
  c?.status === "connecting" || c?.status === "discovering"
const signIn = (c?: Connection) =>
  c?.status === "authenticating" ? c.authUrl : undefined

/** What a tile or page says about a connection, in a word or two. */
function StatusText({ connection }: { connection: Connection }) {
  if (ready(connection) && !connection.lastFailure) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-kumo-success">
        <span className="size-1.5 rounded-full bg-kumo-success" />
        Connected
      </span>
    )
  }
  if (busy(connection)) {
    return <ShimmerText text="Connecting" className="text-xs" />
  }
  return (
    <span className="text-xs font-medium text-kumo-warning">
      {connection.status === "authenticating"
        ? "Needs sign-in"
        : "Needs attention"}
    </span>
  )
}

const SIGN_IN_PILL =
  "pressable inline-flex h-8 shrink-0 items-center rounded-full bg-kumo-contrast px-3.5 text-sm font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"

// ---------------------------------------------------------------------------
// The catalog

type Filter = "all" | "added" | IntegrationCategory

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`pressable h-8 shrink-0 rounded-full px-3.5 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
        active
          ? "bg-kumo-contrast text-kumo-inverse"
          : "bg-(--fill-hover) text-kumo-default hover:bg-(--fill-active)"
      }`}
    >
      {children}
    </button>
  )
}

function matches(item: Item, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  const fields = item.integration
    ? [
        item.integration.name,
        item.integration.description,
        item.integration.category,
        item.integration.site,
      ]
    : [item.connection.name, hostOf(item.connection.url)]
  return fields.some((f) => f.toLowerCase().includes(q))
}

/** A tile: the whole card opens the app; its button acts without opening it. */
function Tile({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const hub = useHub()
  const { integration, connection } = item
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = integration?.name ?? connection!.name
  const description =
    integration?.description ?? `Custom server · ${hostOf(connection!.url)}`

  async function connect() {
    if (!integration) return
    // A key is typed on the app's page, never in a tile.
    if (integration.auth === "key") return onOpen()
    setAdding(true)
    setError(null)
    try {
      await hub.addConnection({ name: integration.name, url: integration.url })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.")
    } finally {
      setAdding(false)
    }
  }

  const authUrl = signIn(connection)
  return (
    // A group row, like every other list in settings; the whole row opens the app.
    <li className="relative flex min-h-14 items-center gap-4 border-t border-kumo-line py-3 pr-3 pl-4 transition-colors first:border-t-0 hover:bg-(--fill-hover) has-[a[data-tile]:focus-visible]:bg-(--fill-hover)">
      <a
        data-tile
        href="#"
        onClick={(e) => {
          e.preventDefault()
          onOpen()
        }}
        aria-label={`${name} details`}
        className="absolute inset-0 outline-none"
      />
      {/* A size up from other rows' 28px slot: the logo is what you scan for. */}
      <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle [&>img]:size-5 [&>img]:rounded-[4px]">
        <AppIcon
          size="sm"
          host={integration?.site ?? hostOf(connection!.url)}
          src={integration?.icon}
        />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="truncate text-sm text-kumo-default">{name}</p>
        <p className="mt-0.5 max-w-[75%] text-xs text-pretty text-kumo-subtle">
          {error ? (
            <span className="text-kumo-danger">{error}</span>
          ) : (
            description
          )}
        </p>
      </div>
      <div className="relative shrink-0">
        {connection ? (
          authUrl ? (
            <SignInButton
              connectionId={connection.id}
              className={SIGN_IN_PILL}
            />
          ) : (
            <span className="pointer-events-none pr-1">
              <StatusText connection={connection} />
            </span>
          )
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            loading={adding}
            disabled={!hub.live}
            aria-label={`Connect ${name}`}
            onClick={() => void connect()}
          >
            Connect
          </Button>
        )}
      </div>
    </li>
  )
}

function Catalog({ onOpen }: { onOpen: (page: string) => void }) {
  const items = useItems()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const added = items.filter((i) => i.connection)
  const q = query.trim()

  const visible = items.filter(
    (item) =>
      matches(item, q) &&
      (filter === "all" ||
        (filter === "added"
          ? item.connection !== undefined
          : item.integration?.category === filter))
  )

  // Searching reads across every category, so the grouping drops away.
  const grouped = filter === "all" && !q
  const sections: { title?: string; items: Item[] }[] = grouped
    ? [
        ...(added.length ? [{ title: "Added", items: added }] : []),
        ...INTEGRATION_CATEGORIES.map((category) => ({
          title: category,
          items: visible.filter(
            (i) => i.integration?.category === category && !i.connection
          ),
        })),
      ].filter((s) => s.items.length > 0)
    : [{ items: visible }]

  const open = (item: Item) =>
    onOpen(item.integration ? item.integration.id : customId(item.connection!))

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description="Apps and services your bots use through their APIs. You sign in once and every bot can use them."
      />

      <div className="space-y-3">
        <div className="flex h-10 items-center gap-2 rounded-full bg-(--fill-hover) pr-1 pl-3.5 text-kumo-subtle focus-within:ring-2 focus-within:ring-kumo-focus">
          <MagnifyingGlassIcon size={16} className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations"
            aria-label="Search integrations"
            className="min-w-0 flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <RowAction label="Clear search" onClick={() => setQuery("")}>
              <XIcon size={14} />
            </RowAction>
          ) : null}
        </div>
        <div className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1 py-0.5">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          {added.length > 0 ? (
            <Chip
              active={filter === "added"}
              onClick={() => setFilter("added")}
            >
              Added
              <span className="ml-1.5 tabular-nums opacity-60">
                {added.length}
              </span>
            </Chip>
          ) : null}
          {INTEGRATION_CATEGORIES.map((category) => (
            <Chip
              key={category}
              active={filter === category}
              onClick={() => setFilter(category)}
            >
              {category}
            </Chip>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl px-6 py-10 text-center outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <p className="text-sm text-kumo-default">
            {q ? `Nothing matches “${q}”` : "Nothing here yet"}
          </p>
          <p className="mt-1 text-xs text-pretty text-kumo-subtle">
            Any MCP server works.{" "}
            <button
              type="button"
              onClick={() => onOpen(CUSTOM)}
              className={`${LINK} outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus`}
            >
              Add a custom server
            </button>
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <Group
              key={section.title ?? "results"}
              title={
                section.title ??
                `${section.items.length} ${section.items.length === 1 ? "result" : "results"}`
              }
            >
              {section.items.map((item) => (
                <Tile key={item.key} item={item} onOpen={() => open(item)} />
              ))}
            </Group>
          ))}
        </div>
      )}

      {visible.length === 0 ? null : (
        <Group
          title="Something else"
          hint={
            <>
              Missing one from the list?{" "}
              <a
                href="https://github.com/fayazara/coworkers/blob/main/src/lib/integrations.ts"
                target="_blank"
                rel="noreferrer noopener"
                className={LINK}
              >
                Suggest it for the catalog
              </a>
              .
            </>
          }
        >
          <li>
            <button
              type="button"
              onClick={() => onOpen(CUSTOM)}
              className="flex min-h-14 w-full items-center gap-4 py-3 pr-4 pl-4 text-left outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
                <PlusIcon size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-kumo-default">
                  Custom server
                </span>
                <span className="mt-0.5 block text-xs text-kumo-subtle">
                  Any remote MCP server, with your own headers
                </span>
              </span>
              <CaretRightIcon size={14} className="text-kumo-subtle" />
            </button>
          </li>
        </Group>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One app's page

/** A pasted secret: a filled field, shown in mono once there is one. */
function SecretInput({
  label,
  value,
  placeholder,
  onChange,
  autoFocus,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true })
  }, [autoFocus])
  return (
    <div className="flex h-10 min-w-0 flex-1 items-center rounded-xl bg-(--fill-hover) pr-1 pl-3.5 focus-within:ring-2 focus-within:ring-kumo-focus">
      <input
        ref={input}
        type={shown ? "text" : "password"}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} min-w-0 flex-1 ${value ? "font-mono text-[13px]" : ""}`}
      />
      <RowAction
        label={shown ? "Hide" : "Show"}
        onClick={() => setShown((v) => !v)}
      >
        <EyeIcon size={16} />
      </RowAction>
    </div>
  )
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="pressable -ml-1 inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-2 text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus max-md:hidden"
    >
      <ArrowLeftIcon size={16} />
      Integrations
    </button>
  )
}

function ToolsGroup({ connection }: { connection: Connection }) {
  const { connectionTools, live } = useHub()
  const [tools, setTools] = useState<ConnectionTool[] | null>(null)
  const [all, setAll] = useState(false)
  const isReady = ready(connection)
  const load = useRef(connectionTools)
  load.current = connectionTools

  useEffect(() => {
    if (!live || !isReady) return
    let cancelled = false
    load.current(connection.id).then(
      (found) => !cancelled && setTools(found),
      () => !cancelled && setTools([])
    )
    return () => {
      cancelled = true
    }
  }, [live, isReady, connection.id, connection.tools])

  if (!isReady) return null
  const LIMIT = 6
  const list = tools ?? []
  const shown = all ? list : list.slice(0, LIMIT)
  return (
    <Group
      title={`Tools${connection.tools ? ` · ${connection.tools}` : ""}`}
      hint="Each bot\u2019s Use connected apps rule decides when it asks you first."
    >
      {tools === null ? (
        <EmptyRow>
          <ShimmerText text="Reading its tools" />
        </EmptyRow>
      ) : list.length === 0 ? (
        <EmptyRow>No tools</EmptyRow>
      ) : (
        <>
          {shown.map((tool) => (
            <Row
              key={tool.name}
              label={<span className="font-mono text-[13px]">{tool.name}</span>}
              detail={
                tool.description ? (
                  <span className="line-clamp-2">{tool.description}</span>
                ) : undefined
              }
            >
              {tool.readOnly ? (
                <span className="shrink-0 rounded-full bg-(--fill-hover) px-2 py-0.5 text-[11px] text-kumo-subtle">
                  Read only
                </span>
              ) : null}
            </Row>
          ))}
          {list.length > LIMIT ? (
            <li className="border-t border-kumo-line">
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="flex h-11 w-full items-center px-4 text-left text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:bg-(--fill-hover)"
              >
                {all ? "Show fewer" : `Show all ${list.length}`}
              </button>
            </li>
          ) : null}
        </>
      )}
    </Group>
  )
}

function StatusGroup({ connection }: { connection: Connection }) {
  const hub = useHub()
  const [retrying, setRetrying] = useState(false)
  const authUrl = signIn(connection)
  const failed =
    !ready(connection) &&
    !busy(connection) &&
    connection.status !== "authenticating"

  async function retry() {
    setRetrying(true)
    try {
      await hub.reconnect(connection.id)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Group title="Status">
      <Row
        label={<StatusText connection={connection} />}
        detail={
          <>
            {ready(connection)
              ? `${connection.tools} ${connection.tools === 1 ? "tool" : "tools"} · ${hostOf(connection.url)}`
              : connectionStatus(connection)}
            {connection.lastFailure ? (
              <span
                className="block text-kumo-warning"
                title={connection.lastFailure.message}
              >
                {connection.lastFailure.kind === "auth"
                  ? "Its sign-in expired. Reconnect it."
                  : connection.lastFailure.kind === "unreachable"
                    ? "The last call could not reach it."
                    : "The last call failed."}
              </span>
            ) : null}
          </>
        }
      >
        {authUrl ? (
          <SignInButton connectionId={connection.id} className={SIGN_IN_PILL} />
        ) : failed || connection.lastFailure ? (
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
      </Row>
      {connection.headerNames.length > 0 ? (
        <Row label="Sends" detail="Kept on the server, never shown to a model">
          <span className="max-w-[50%] truncate font-mono text-[12px] text-kumo-subtle">
            {connection.headerNames.join(", ")}
          </span>
        </Row>
      ) : null}
    </Group>
  )
}

const SIGN_IN_LABEL: Record<Integration["auth"], string> = {
  none: "No account needed",
  oauth: "Your own account",
  key: "API key",
}

function AppPage({
  integration,
  connection,
  onBack,
  autoFocusKey,
}: {
  integration?: Integration
  connection?: Connection
  onBack: () => void
  autoFocusKey?: boolean
}) {
  const hub = useHub()
  const [key, setKey] = useState("")
  const [busyAction, setBusyAction] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = integration?.name ?? connection?.name ?? "Integration"
  const url = integration?.url ?? connection?.url ?? ""
  const needsKey = integration?.auth === "key"

  async function connect() {
    if (!integration) return
    setBusyAction(true)
    setError(null)
    try {
      await hub.addConnection({
        name: integration.name,
        url: integration.url,
        headers: integrationHeaders(integration, key),
      })
      setKey("")
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add ${name}.`)
    } finally {
      setBusyAction(false)
    }
  }

  async function remove() {
    if (!connection) return
    setBusyAction(true)
    try {
      await hub.removeConnection(connection.id)
      // A custom server has no page once it is gone.
      if (!integration) onBack()
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <div className="space-y-6">
      <BackLink onBack={onBack} />

      <div className="flex items-start gap-4 px-1.5">
        <AppIcon
          size="lg"
          host={integration?.site ?? hostOf(url)}
          src={integration?.icon}
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-xl font-semibold tracking-tight text-kumo-default">
            {name}
          </h2>
          <p className="mt-0.5 truncate text-sm text-kumo-subtle">
            {integration ? (
              <a
                href={`https://${integration.site}`}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-kumo-default"
              >
                {integration.site}
              </a>
            ) : (
              `Custom server · ${hostOf(url)}`
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {connection ? (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              loading={busyAction}
              disabled={!hub.live}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              className="btn-ink rounded-full"
              loading={busyAction}
              disabled={!hub.live || (needsKey && !key.trim())}
              onClick={() => void connect()}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      {integration ? (
        <p className="px-1.5 text-[15px] text-pretty text-kumo-default">
          {integration.description}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-kumo-danger-tint px-4 py-3 text-sm text-pretty text-kumo-danger"
        >
          {error}
        </p>
      ) : null}

      {!connection && integration?.key ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!needsKey || key.trim()) void connect()
          }}
        >
          <section className="space-y-2">
            <h3 className="px-1.5 text-sm font-medium text-kumo-default">
              {needsKey ? "API key" : "API key (optional)"}
            </h3>
            <SecretInput
              label={`${name} API key`}
              placeholder={`Paste your ${name} API key`}
              value={key}
              onChange={setKey}
              autoFocus={autoFocusKey && needsKey}
            />
            <p className="px-1.5 text-xs text-pretty text-kumo-subtle">
              {needsKey
                ? "Sent with every request from the server. Bots never see it. "
                : "Works without one at lower rate limits. Add yours to lift them. "}
              <a
                href={integration.key.getKey}
                target="_blank"
                rel="noreferrer noopener"
                className={LINK}
              >
                Get one at {siteOf(integration.key.getKey)}
              </a>
            </p>
          </section>
        </form>
      ) : null}

      {connection ? <StatusGroup connection={connection} /> : null}
      {connection ? <ToolsGroup connection={connection} /> : null}

      <Group title="About">
        {integration ? (
          <>
            <Row label="Category">
              <span className="shrink-0 text-sm text-kumo-subtle">
                {integration.category}
              </span>
            </Row>
            <Row label="Sign-in">
              <span className="shrink-0 text-sm text-kumo-subtle">
                {integration.auth === "oauth"
                  ? `Your ${integration.name} account`
                  : SIGN_IN_LABEL[integration.auth]}
              </span>
            </Row>
          </>
        ) : null}
        <Row
          label="Endpoint"
          detail={<span className="font-mono break-all">{url}</span>}
        >
          <CopyButton text={url} label="Copy endpoint" />
        </Row>
        {integration ? (
          <li className="border-t border-kumo-line">
            <a
              href={integration.docs}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-h-14 items-center justify-between gap-4 py-3 pr-4 pl-4 text-sm text-kumo-default outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
            >
              Documentation
              <ArrowSquareOutIcon size={14} className="text-kumo-subtle" />
            </a>
          </li>
        ) : null}
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A custom server

interface HeaderRow {
  key: number
  name: string
  value: string
}

// Executor on Cloudflare sits behind Access; bots sign in with a service token.
const EXECUTOR_HEADERS = ["CF-Access-Client-Id", "CF-Access-Client-Secret"]

let nextKey = 0
function emptyRow(name = ""): HeaderRow {
  return { key: nextKey++, name, value: "" }
}

function CustomServer({
  onBack,
  onAdded,
}: {
  onBack: () => void
  onAdded: (connection: Connection) => void
}) {
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
      const connection = await hub.addConnection({
        name,
        url,
        headers: Object.fromEntries(
          headers
            .filter((h) => h.name.trim())
            .map((h) => [h.name.trim(), h.value])
        ),
      })
      onAdded(connection)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add that connection."
      )
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <BackLink onBack={onBack} />
      <SectionHeader
        title="Custom server"
        description={
          <>
            Any remote MCP server, such as an{" "}
            <a
              href="https://executor.sh/docs/hosted/cloudflare"
              target="_blank"
              rel="noreferrer noopener"
              className={LINK}
            >
              Executor
            </a>{" "}
            gateway for Gmail, Calendar and the rest through one endpoint.
          </>
        }
      />

      <Group
        title="Server"
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
      </Group>

      <Group
        title="Headers"
        hint="Sent with every request, e.g. an API key or a Cloudflare Access service token. Values stay on the server and are never shown to a model."
      >
        {headers.map((row) => (
          <li
            key={row.key}
            className="flex items-center gap-2 border-t border-kumo-line p-2 first:border-t-0"
          >
            <input
              aria-label="Header name"
              placeholder="Header"
              spellCheck={false}
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value })}
              className={`${FIELD} h-10 w-44! shrink-0 rounded-xl bg-(--fill-hover) px-3.5 font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-kumo-focus`}
            />
            <SecretInput
              label={`Value for ${row.name || "header"}`}
              placeholder="Value"
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
        <li className="border-t border-kumo-line first:border-t-0">
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
          type="button"
          variant="ghost"
          className="rounded-full"
          onClick={onBack}
        >
          Cancel
        </Button>
        <Button
          type="submit"
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

// ---------------------------------------------------------------------------

export function IntegrationsSettings({
  app,
  error,
}: {
  /** Which page: an integration id, `c-<connection id>`, or "custom". */
  app?: string
  error?: string
}) {
  const hub = useHub()
  const { live, refreshConnections } = hub
  const navigate = useNavigate()

  // Pick up a sign-in that just finished in this tab or another.
  useEffect(() => {
    if (!live) return
    refreshConnections()
    const check = () => {
      if (document.visibilityState === "visible") refreshConnections()
    }
    document.addEventListener("visibilitychange", check)
    return () => document.removeEventListener("visibilitychange", check)
  }, [live, refreshConnections])

  // Each page starts at the top, like a new screen.
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    top.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 })
  }, [app])

  const go = (page?: string) =>
    void navigate({
      to: "/settings",
      search: { tab: "integrations", ...(page ? { app: page } : {}) },
    })

  const integration = INTEGRATIONS.find((i) => i.id === app)
  const connection = integration
    ? hub.state.connections.find((c) => sameEndpoint(c.url, integration.url))
    : hub.state.connections.find((c) => app === customId(c))

  return (
    <div ref={top} className="space-y-6">
      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-kumo-danger-tint px-4 py-3 text-sm text-pretty text-kumo-danger"
        >
          Sign-in didn't finish: {error}
        </p>
      ) : null}
      {app === CUSTOM ? (
        <CustomServer
          onBack={() => go()}
          onAdded={(c) => {
            const match = integrationFor(c.url)
            go(match ? match.id : customId(c))
          }}
        />
      ) : integration || connection ? (
        <AppPage
          key={app}
          integration={integration}
          connection={connection}
          onBack={() => go()}
          autoFocusKey
        />
      ) : (
        <Catalog onOpen={go} />
      )}
    </div>
  )
}
