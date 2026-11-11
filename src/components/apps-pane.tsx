import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  AppWindowIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons"
import { CopyButton } from "@/components/copy-button"
import { EmptyState } from "@/components/empty-state"
import { Group, Row } from "@/components/group"
import { useBot } from "@/lib/bot-context"
import type { BotConnection } from "@/lib/bot-context"
import { approvalKey } from "@/lib/types"
import type {
  AppLink,
  AppToolGrant,
  BotAppDetail,
  BotAppSummary,
} from "@/lib/types"

const MODE_LABELS: Record<AppLink["mode"], string> = {
  edit: "Can edit",
  view: "View only",
  submit: "Can submit",
}

/** Under the link's name in the list. */
const MODE_DETAILS: Record<AppLink["mode"], string> = {
  edit: MODE_LABELS.edit,
  view: MODE_LABELS.view,
  submit: "Public form · sees only their own entry",
}

function absolute(path: string) {
  return typeof window === "undefined"
    ? path
    : `${window.location.origin}${path}`
}

function formatAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" })
}

/** Apps the bot built: preview, open, share by link, revoke, delete. */
export function AppsPane({ agent }: { agent: BotConnection }) {
  const { state } = useBot()
  const [apps, setApps] = useState<BotAppDetail[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setApps(await agent.stub.getApps())
  }, [agent])

  // state.apps changes whenever the bot publishes, so this stays current.
  useEffect(() => {
    void load()
  }, [load, state.apps])

  if (apps === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    )
  }

  const app = apps.find((a) => a.slug === selected)
  if (app) {
    return (
      <AppDetail
        agent={agent}
        app={app}
        onBack={() => setSelected(null)}
        onChanged={load}
      />
    )
  }

  if (apps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<AppWindowIcon size={24} />}
          title="No apps yet"
          description={`Ask ${state.name} to build one, like a page for your next trip.`}
        />
      </div>
    )
  }

  return (
    <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5 overflow-y-auto px-4 pt-2 pb-4">
      {apps.map((a) => {
        const owner = a.links.find((l) => l.owner)
        const shared = a.links.length - 1
        return (
          <li key={a.slug}>
            <button
              type="button"
              onClick={() => setSelected(a.slug)}
              className="group pressable flex w-full flex-col gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-offset-4 focus-visible:ring-offset-kumo-canvas"
            >
              <AppThumbnail app={a} path={owner?.path} />
              <span className="min-w-0 px-0.5">
                <span className="block truncate text-sm font-medium text-kumo-default">
                  {a.name}
                </span>
                <span className="block truncate text-xs text-kumo-subtle tabular-nums">
                  {formatAgo(a.updatedAt)}
                  {shared > 0 ? ` · shared with ${shared}` : ""}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Apps are laid out at a small-laptop width, then scaled down to fit the
// card. Most apps are a centred column, so wider makes the content tiny.
const THUMB_WIDTH = 880
const THUMB_HEIGHT = 550

/** A live, non-interactive render of the app, scaled to the card. */
function AppThumbnail({
  app,
  path,
}: {
  app: BotAppSummary & { approvedTools?: string[] }
  path?: string
}) {
  const [scale, setScale] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = frame.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / THUMB_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={frame}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-kumo-recessed shadow-[0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)] outline outline-1 -outline-offset-1 outline-kumo-line transition-shadow duration-150 ease-out group-hover:shadow-[0_1px_2px_oklch(0_0_0/0.06),0_6px_16px_oklch(0_0_0/0.08)]"
    >
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center text-kumo-inactive transition-opacity duration-150 ease-out ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      >
        <AppWindowIcon size={24} />
      </span>
      {path && scale > 0 ? (
        <iframe
          key={`${app.version}:${app.approvedTools?.join(",") ?? ""}`}
          src={path}
          title=""
          aria-hidden
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-scripts"
          onLoad={() => setLoaded(true)}
          style={{
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            transform: `scale(${scale})`,
          }}
          className={`pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity duration-150 ease-out ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </div>
  )
}

/** Bot members use the same apps, without managing external sharing links. */
export function SharedAppsPane({
  apps,
}: {
  apps: (BotAppSummary & { path: string })[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const app = apps.find((item) => item.slug === selected)
  if (app)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-1 pt-1 pr-4 pb-2 pl-2">
          <button
            type="button"
            aria-label="All apps"
            className="icon-btn"
            onClick={() => setSelected(null)}
          >
            <ArrowLeftIcon size={16} />
          </button>
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
            {app.name}
          </h3>
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowSquareOutIcon />}
            className="rounded-full"
            onClick={() => window.open(app.path, "_blank", "noopener")}
          >
            Open
          </Button>
        </div>
        <div className="mx-4 min-h-[480px] flex-1 overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-kumo-line">
          <iframe
            key={app.version}
            title={`${app.name} preview`}
            src={app.path}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="size-full min-h-[480px]"
          />
        </div>
        <p className="px-5 py-3 text-xs text-kumo-subtle">
          You can edit app data and message the bot. External sharing is managed
          by the owner.
        </p>
      </div>
    )
  if (!apps.length)
    return (
      <div className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<AppWindowIcon size={24} />}
          title="No apps yet"
          description="Ask the bot to build one, like a page for your next trip."
        />
      </div>
    )
  return (
    <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5 overflow-y-auto px-4 pt-2 pb-4">
      {apps.map((item) => (
        <li key={item.slug}>
          <button
            type="button"
            onClick={() => setSelected(item.slug)}
            className="group pressable flex w-full flex-col gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-offset-4 focus-visible:ring-offset-kumo-canvas"
          >
            <AppThumbnail app={item} path={item.path} />
            <span className="min-w-0 px-0.5">
              <span className="block truncate text-sm font-medium">
                {item.name}
              </span>
              <span className="block text-xs text-kumo-subtle">
                Can edit · {formatAgo(item.updatedAt)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function AppDetail({
  agent,
  app,
  onBack,
  onChanged,
}: {
  agent: BotConnection
  app: BotAppDetail
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const owner = app.links.find((l) => l.owner)
  const shared = app.links.filter((l) => !l.owner)
  const [label, setLabel] = useState("")
  const [mode, setMode] = useState<AppLink["mode"]>("view")
  const [audience, setAudience] = useState<"link" | "email">("link")
  const [email, setEmail] = useState("")
  const [canMessage, setCanMessage] = useState(false)
  const [error, setError] = useState("")
  const hasForm = app.access.submit.length > 0
  const modes = hasForm
    ? MODE_LABELS
    : { edit: MODE_LABELS.edit, view: MODE_LABELS.view }
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function share() {
    setCreating(true)
    setError("")
    try {
      await agent.stub.createAppLink(app.slug, label, mode, {
        audience,
        email: audience === "email" ? email : undefined,
        canMessage,
      })
      setLabel("")
      setEmail("")
      setMode("view")
      setCanMessage(false)
      await onChanged()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create sharing link"
      )
    } finally {
      setCreating(false)
    }
  }

  async function revoke(token: string) {
    try {
      await agent.stub.revokeAppLink(token)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke access")
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await agent.stub.deleteApp(app.slug)
      onBack()
      await onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-1 pt-1 pr-4 pb-2 pl-2">
        <button
          type="button"
          aria-label="All apps"
          onClick={onBack}
          className="icon-btn size-8!"
        >
          <ArrowLeftIcon size={16} />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-kumo-default">
          {app.name}
        </h3>
        {owner ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowSquareOutIcon />}
            className="rounded-full"
            onClick={() => window.open(owner.path, "_blank", "noopener")}
          >
            Open
          </Button>
        ) : null}
      </div>

      {owner ? (
        <div className="mx-4 aspect-[16/10] shrink-0 overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-kumo-line">
          <iframe
            key={`${app.version}:${app.approvedTools.join(",")}`}
            title={`${app.name} preview`}
            src={owner.path}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="size-full"
          />
        </div>
      ) : null}

      <p className="px-5 pt-2 text-xs text-kumo-subtle tabular-nums">
        Updated {formatAgo(app.updatedAt)}
        {app.collections.map((c) => ` · ${c.count} ${c.name}`).join("")}
      </p>

      {app.tools.length > 0 ? (
        <AppToolsSection agent={agent} app={app} onChanged={onChanged} />
      ) : null}

      <div className="space-y-2 px-4 pt-6 pb-4">
        <h4 className="px-1.5 text-sm font-medium text-kumo-default">
          Access and sharing
        </h4>
        <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-kumo-line">
          {owner ? (
            <PersonRow
              name="You"
              detail="Private · sign-in required"
              path={owner.path}
            />
          ) : null}
          {shared.map((link) => (
            <PersonRow
              key={link.token}
              name={link.label}
              detail={`${MODE_DETAILS[link.mode]} · ${link.audience === "email" ? link.email : "Anyone with this secret link"}${link.canMessage ? " · Can message bot" : ""}`}
              path={link.path}
              onRevoke={() => void revoke(link.token)}
            />
          ))}
          <li className="border-t border-kumo-line first:border-t-0">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (label.trim()) void share()
              }}
              className="flex min-h-14 flex-wrap items-center gap-2 py-3 pr-3 pl-4"
            >
              <label className="flex w-full flex-col gap-1 text-xs text-kumo-subtle">
                Who can open this app?
                <select
                  aria-label="Sharing audience"
                  value={audience}
                  onChange={(e) =>
                    setAudience(e.target.value as "link" | "email")
                  }
                  className="h-10 rounded-lg border border-kumo-line bg-kumo-base px-2 text-sm text-kumo-default"
                >
                  <option value="link">Anyone with a secret link</option>
                  <option value="email">
                    Only this email (sign-in required)
                  </option>
                </select>
              </label>
              {audience === "email" ? (
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="recipient@example.com"
                  aria-label="Recipient email"
                  className="h-10 w-full rounded-lg border border-kumo-line bg-kumo-base px-3 text-sm"
                />
              ) : null}
              <div className="flex min-h-11 w-full items-center justify-between gap-3 text-sm">
                <span>Allow bot messages</span>
                <Switch
                  aria-label="Allow messaging the bot"
                  checked={canMessage}
                  onCheckedChange={setCanMessage}
                />
              </div>
              {canMessage ? (
                <p className="w-full text-xs text-pretty text-kumo-subtle">
                  Allows messages and automatic error reports. Private account
                  context stays isolated; connected-account changes need your
                  approval.
                </p>
              ) : null}
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
                <PlusIcon size={14} />
              </span>
              <input
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label for this link"
                aria-label="Label for this sharing link"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"
              />
              <Select
                aria-label="Access"
                size="sm"
                className="w-28 shrink-0"
                value={mode}
                items={modes}
                onValueChange={(value) =>
                  value && setMode(value as AppLink["mode"])
                }
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                className="btn-ink rounded-full"
                loading={creating}
                disabled={!label.trim()}
              >
                Share
              </Button>
            </form>
          </li>
        </ul>
        <p className="px-1.5 text-xs text-pretty text-kumo-subtle">
          Apps are private until you explicitly create a sharing link. Sharing
          an app never shares its bot’s chat or settings. Revoke and create a
          new link to change permissions. Email recipients must be allowed to
          sign in through Cloudflare Access.
        </p>
        {error ? (
          <p role="alert" className="px-1.5 text-sm text-kumo-danger">
            {error}
          </p>
        ) : null}
        <p className="px-1.5 text-xs text-pretty text-kumo-subtle">
          {audience === "email"
            ? "Only the invited email can sign in and open this link."
            : mode === "submit"
              ? "Anyone with this link can fill in the form without signing in. They can't see other entries, and can send a few per hour."
              : "Anyone with a link can open the app without signing in, so share it like a password. Edits reach the bot under that person's name."}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2 px-4 pt-2 pb-4">
        {confirmDelete ? (
          <>
            <span className="flex-1 px-1 text-sm text-kumo-default">
              Delete the app, its data and all links?
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-full"
              loading={deleting}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="pressable flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-danger focus-visible:ring-2 focus-visible:ring-kumo-focus"
          >
            <TrashIcon size={16} />
            Delete app
          </button>
        )}
      </div>
    </div>
  )
}

/** Where a limited tool may act, from its other limits, e.g. "Primary calendar account only". */
function whereNote(g: AppToolGrant) {
  const names = (g.only ?? [])
    .slice(1)
    .map((scope) => scope.allow.map((a) => a.label ?? a.value).join(", "))
  return names.length ? `${names.join(" · ")} only` : ""
}

/** One action an app may take, as a row: what it does, whether it changes things. */
function ToolActionRow({
  label,
  title,
  reads,
  where,
  allowed,
}: {
  label: string
  title?: string
  reads: boolean
  where: string
  allowed: boolean
}) {
  return (
    <Row
      icon={<PlugsConnectedIcon size={14} />}
      label={<span title={title}>{label}</span>}
      detail={[reads ? "Reads" : "Changes things", where]
        .filter(Boolean)
        .join(" · ")}
    >
      {allowed ? null : (
        <span className="shrink-0 text-xs text-kumo-subtle">Not allowed</span>
      )}
    </Row>
  )
}

/** Tools on the user's apps that the app's server code may call live. */
function AppToolsSection({
  agent,
  app,
  onChanged,
}: {
  agent: BotConnection
  app: BotAppDetail
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const allowed = (g: AppToolGrant) =>
    app.approvedTools.includes(approvalKey(g))
  const pending = app.tools.filter((g) => !allowed(g))
  const writes = app.tools.some(
    (g) =>
      !g.readOnly &&
      (!g.only || g.only.some((o) => o.allow.some((a) => !a.reads)))
  )

  async function run(action: "approve" | "revoke") {
    setBusy(true)
    try {
      if (action === "approve") await agent.stub.approveAppTools(app.slug)
      else await agent.stub.revokeAppTools(app.slug)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const apps = [...new Set(app.tools.map((g) => g.app))].join(" and ")

  return (
    <div className="px-4 pt-6">
      <Group
        title={`Uses your ${apps}`}
        action={
          pending.length > 0 ? (
            <Button
              size="sm"
              variant="primary"
              className="btn-ink rounded-full"
              loading={busy}
              onClick={() => void run("approve")}
            >
              Allow
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              loading={busy}
              onClick={() => void run("revoke")}
            >
              Turn off
            </Button>
          )
        }
        hint={
          writes
            ? "Anyone who opens this app can trigger these. Each change shows in Activity."
            : "Anyone who opens this app can trigger these. The page shows only what the bot's code returns."
        }
      >
        {app.tools.flatMap((g) =>
          g.only?.length
            ? g.only[0]!.allow.map((a) => (
                <ToolActionRow
                  key={`${g.name}:${a.value}`}
                  label={a.label ?? a.value}
                  title={a.value}
                  reads={g.readOnly || a.reads}
                  where={whereNote(g)}
                  allowed={allowed(g)}
                />
              ))
            : [
                <ToolActionRow
                  key={g.name}
                  label={g.description || g.tool}
                  title={g.tool}
                  reads={g.readOnly}
                  where={g.readOnly ? "" : "with anything it asks"}
                  allowed={allowed(g)}
                />,
              ]
        )}
      </Group>
    </div>
  )
}

/** One person who can open the app: who, what they can do, copy their link. */
function PersonRow({
  name,
  detail,
  path,
  onRevoke,
}: {
  name: string
  detail: string
  path: string
  onRevoke?: () => void
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-kumo-line py-3 pr-3 pl-4 first:border-t-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-active) text-xs font-medium text-kumo-default">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-kumo-default">{name}</span>
        <span className="mt-0.5 block max-w-[75%] text-xs text-pretty text-kumo-subtle">
          {detail}
        </span>
      </span>
      <CopyButton
        text={absolute(path)}
        label={`Copy ${name === "You" ? "your" : `${name}'s`} link`}
      />
      {onRevoke ? (
        <Tooltip
          content="Remove access"
          render={
            <button
              type="button"
              aria-label={`Remove ${name}'s access`}
              onClick={onRevoke}
              className="icon-btn size-8! hover:text-kumo-danger!"
            >
              <XIcon size={16} />
            </button>
          }
        />
      ) : (
        // Keeps every row's copy button in the same column.
        <span aria-hidden className="size-8 shrink-0" />
      )}
    </li>
  )
}
