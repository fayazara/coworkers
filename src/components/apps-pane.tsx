import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
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
import { useBot } from "@/lib/bot-context"
import type { BotConnection } from "@/lib/bot-context"
import { approvalKey } from "@/lib/types"
import type { AppLink, AppToolGrant, BotAppDetail } from "@/lib/types"

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
function AppThumbnail({ app, path }: { app: BotAppDetail; path?: string }) {
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
      className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-kumo-recessed shadow-[0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)] outline outline-1 -outline-offset-1 outline-black/[0.06] transition-shadow duration-150 ease-out group-hover:shadow-[0_1px_2px_oklch(0_0_0/0.06),0_6px_16px_oklch(0_0_0/0.08)]"
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
          key={`${app.version}:${app.approvedTools.join(",")}`}
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
  const hasForm = app.access.submit.length > 0
  const modes = hasForm
    ? MODE_LABELS
    : { edit: MODE_LABELS.edit, view: MODE_LABELS.view }
  const [mode, setMode] = useState<AppLink["mode"]>(hasForm ? "submit" : "edit")
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function share() {
    setCreating(true)
    try {
      await agent.stub.createAppLink(app.slug, label, mode)
      setLabel("")
      await onChanged()
    } finally {
      setCreating(false)
    }
  }

  async function revoke(token: string) {
    await agent.stub.revokeAppLink(token)
    await onChanged()
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
        <div className="mx-4 aspect-[16/10] shrink-0 overflow-hidden rounded-2xl bg-white outline outline-1 -outline-offset-1 outline-black/[0.06]">
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
          People with access
        </h4>
        <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
          {owner ? (
            <PersonRow name="You" detail="Owner" path={owner.path} />
          ) : null}
          {shared.map((link) => (
            <PersonRow
              key={link.token}
              name={link.label}
              detail={MODE_DETAILS[link.mode]}
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
              className="flex min-h-14 items-center gap-2 py-3 pr-3 pl-4"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
                <PlusIcon size={14} />
              </span>
              <input
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  mode === "submit" ? "Name this link" : "Add a person"
                }
                aria-label={
                  mode === "submit"
                    ? "Name of the public link, like Website"
                    : "Name of the person to share with"
                }
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
          {mode === "submit"
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

/** How a second limit reads, e.g. "Only in one account". */
function scopeNote(scope: { at: string; allow: unknown[] }) {
  const key = scope.at.split(".").at(-1)?.replace("[]", "") ?? ""
  const n = scope.allow.length
  if (/account/i.test(key)) {
    return n === 1 ? "Only in one account" : `Only in these ${n} accounts`
  }
  return `Only with these ${key} values`
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

  return (
    <div className="space-y-2 px-4 pt-6">
      <h4 className="px-1.5 text-sm font-medium text-kumo-default">
        What this app can do in your accounts
      </h4>
      <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
        {app.tools.map((g) => (
          <li
            key={g.name}
            className="flex min-h-14 items-center gap-3 border-t border-kumo-line py-3 pr-4 pl-4 first:border-t-0"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
              <PlugsConnectedIcon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-kumo-default">
                {g.app}
                {g.only?.length ? null : (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{g.tool}</span>
                  </>
                )}
              </span>
              {g.only?.length ? (
                <span className="mt-1.5 block space-y-1.5 text-xs">
                  {g.only[0]!.allow.map((a) => (
                    <span key={a.value} className="block" title={a.value}>
                      <span className="text-kumo-default">
                        {a.label ?? a.value}
                      </span>
                      <span className="text-kumo-subtle">
                        {" · "}
                        {g.readOnly || a.reads ? "reads" : "changes things"}
                      </span>
                      {a.label ? (
                        <span className="block truncate font-mono text-[11px] text-kumo-subtle">
                          {a.value}
                        </span>
                      ) : null}
                    </span>
                  ))}
                  {g.only.slice(1).map((scope) => (
                    <span
                      key={scope.at}
                      className="block truncate text-kumo-subtle"
                    >
                      {scopeNote(scope)}{" "}
                      <span className="font-mono text-[11px]">
                        ({scope.allow.map((a) => a.label ?? a.value).join(", ")}
                        )
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="mt-0.5 block text-xs text-pretty text-kumo-subtle">
                  {g.readOnly
                    ? "Reads"
                    : "Can change things, with any arguments"}
                  {g.description ? ` · ${g.description}` : ""}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 text-xs ${allowed(g) ? "text-kumo-default" : "text-kumo-subtle"}`}
            >
              {allowed(g) ? "Allowed" : "Not allowed"}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-3 px-1.5">
        <p className="flex-1 text-xs text-pretty text-kumo-subtle">
          {writes
            ? "Anyone who can open this app can make it use these, through the code the bot wrote. Allow only if you trust what it does. What it did shows in Activity."
            : "Anyone who can open this app can make it read these, through the code the bot wrote. The page shows only what that code returns."}
        </p>
        {pending.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            className="btn-ink shrink-0 rounded-full"
            loading={busy}
            onClick={() => void run("approve")}
          >
            Allow
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 rounded-full"
            loading={busy}
            onClick={() => void run("revoke")}
          >
            Turn off
          </Button>
        )}
      </div>
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
