import type { AppAccess, AppLink } from "@/lib/types"
import { AppDataError, assertCollection } from "./app-store"
export { NO_ACCESS, parseAccess } from "./app-store"
import type { AppDataOp } from "./apps-runtime"
import type { AppCaller } from "./apps-runtime"
import { appOperationDenied } from "@/lib/sharing"

/**
 * Who may do what through an app link.
 *
 *   edit    everything
 *   view    read everything, write nothing
 *   submit  a public form: add new items to the app's `submit` collections,
 *           read its `read` collections, and read back only the items it
 *           added, by the id it got back. Nothing else.
 *
 * The id a submission gets is a 128-bit random receipt, so holding it is
 * what proves the item is yours. Ids the bot picks ("b1") never match the
 * receipt shape, so a stranger cannot read the bot's own items by guessing.
 */

export const MAX_SUBMISSION_BYTES = 8 * 1024
export const MAX_ACCESS_COLLECTIONS = 10

const RECEIPT_RE = /^[0-9a-f]{32}$/

export function newReceiptId() {
  return crypto.randomUUID().replace(/-/g, "")
}

export function isReceiptId(id: string) {
  return RECEIPT_RE.test(id)
}

/** What save_app was given, checked and normalised. Throws AppDataError. */
export function validateAccess(input: {
  read?: string[]
  submit?: string[]
  wake?: boolean
}): AppAccess {
  const clean = (list: string[] | undefined, what: string) => {
    const names = [...new Set((list ?? []).map((n) => n.trim()))]
    if (names.length > MAX_ACCESS_COLLECTIONS) {
      throw new AppDataError(
        `At most ${MAX_ACCESS_COLLECTIONS} ${what} collections`
      )
    }
    names.forEach(assertCollection)
    return names
  }
  const read = clean(input.read, "public read")
  const submit = clean(input.submit, "submit")
  if (submit.length === 0) {
    throw new AppDataError(
      "A public form needs at least one submit collection, e.g. ['responses']"
    )
  }
  const both = submit.filter((c) => read.includes(c))
  if (both.length > 0) {
    throw new AppDataError(
      `"${both[0]}" cannot be both public to read and a submit collection: everyone would see every submission`
    )
  }
  return { read, submit, wake: input.wake === true }
}

export type Decision =
  { ok: true; op: AppDataOp } | { ok: false; error: string; status: number }

const deny = (error: string, status = 403): Decision => ({
  ok: false,
  error,
  status,
})

/** Form backends manage their own data; ordinary view links stay view-only. */
export function callerDataMode(caller: AppCaller): AppLink["mode"] {
  return caller.server && caller.mode === "submit" ? "edit" : caller.mode
}

/** Rebind cached server capabilities to the current, authorized link. */
export function refreshAppCaller(
  caller: AppCaller,
  grant: AppLink | null
): AppCaller | null {
  if (!caller.token || !grant || grant.token !== caller.token) return null
  return {
    ...caller,
    label: grant.label,
    mode: grant.mode,
    canMessage: grant.canMessage,
    owner: grant.owner,
  }
}

/** Keep independent edit/message grants when applying public-form rules. */
export function authorizeCaller(
  caller: AppCaller,
  access: AppAccess,
  op: AppDataOp
): Decision {
  const mode = callerDataMode(caller)
  const denial = appOperationDenied({ ...caller, mode }, op.op)
  if (denial) return deny(denial)
  if (op.op === "tell" || op.op === "error") return { ok: true, op }
  return authorize(mode, access, op)
}

/**
 * Whether a link may run an op, and the op to run. For a submission the
 * item is rewritten: any id it brought is refused, and it gets a receipt.
 */
export function authorize(
  mode: AppLink["mode"],
  access: AppAccess,
  op: AppDataOp
): Decision {
  if (mode === "edit") return { ok: true, op }
  if (op.op === "info" || op.op === "error") return { ok: true, op }

  if (mode === "view") {
    if (op.op === "list" || op.op === "get") return { ok: true, op }
    return deny("This link is view-only")
  }

  // submit
  switch (op.op) {
    case "list":
      return access.read.includes(op.collection)
        ? { ok: true, op }
        : deny("This link cannot read that")
    case "get":
      if (access.read.includes(op.collection)) return { ok: true, op }
      // Your own submission, by its receipt. Missing reads as 404 either way.
      if (access.submit.includes(op.collection) && isReceiptId(op.id)) {
        return { ok: true, op }
      }
      return deny("This link cannot read that")
    case "put": {
      if (!access.submit.includes(op.collection)) {
        return deny("A public link cannot change that")
      }
      if (
        op.merge ||
        (op.item.id !== undefined && op.item.id !== null && op.item.id !== "")
      ) {
        return deny("A public link can only add new items, not change them")
      }
      if (JSON.stringify(op.item).length > MAX_SUBMISSION_BYTES) {
        return deny("That submission is too long", 413)
      }
      return {
        ok: true,
        op: { ...op, item: { ...op.item, id: newReceiptId() }, merge: false },
      }
    }
    case "remove":
      return deny("A public link cannot delete")
    case "tell":
      return deny("A public link cannot message the bot")
  }
}

/** Collections an `info` call lists for this link. */
export function visibleCollections<T extends { name: string }>(
  mode: AppLink["mode"],
  access: AppAccess,
  all: T[]
): T[] {
  if (mode !== "submit") return all
  return all.filter((c) => access.read.includes(c.name))
}

// ── Rate limits for public links ──────────────────────────────────────

export interface SubmitLimits {
  perVisitor: { limit: number; windowMs: number }
  perLink: { limit: number; windowMs: number }
}

export const SUBMIT_LIMITS: SubmitLimits = {
  /** Per visitor (IP) per link. */
  perVisitor: { limit: 5, windowMs: 10 * 60_000 },
  /** Per link, across everyone. */
  perLink: { limit: 100, windowMs: 60 * 60_000 },
}

/**
 * Writes an app's server.js makes for someone other than the user. Looser
 * than the page's own submissions, since one request may write a few
 * items, but a public route still cannot fill the app's data.
 */
export const SERVER_WRITE_LIMITS: SubmitLimits = {
  perVisitor: { limit: 30, windowMs: 10 * 60_000 },
  perLink: { limit: 500, windowMs: 60 * 60_000 },
}

/** Most visitors one link remembers; the oldest are forgotten first. */
export const MAX_TRACKED_VISITORS = 500

/** Recent submission times on one link: overall, and per visitor. */
export interface SubmitWindow {
  all: number[]
  visitors: Record<string, number[]>
}

export const EMPTY_WINDOW: SubmitWindow = { all: [], visitors: {} }

/**
 * Take one submission slot. Returns the window to store, and whether the
 * submission may go ahead. A refused one does not count against anyone.
 */
export function takeSubmitSlot(
  window: SubmitWindow,
  visitor: string,
  now: number,
  limits: SubmitLimits = SUBMIT_LIMITS
): { ok: boolean; retryAfterMs: number; window: SubmitWindow } {
  const recent = (hits: number[], windowMs: number) =>
    hits.filter((t) => t > now - windowMs && t <= now)
  const all = recent(window.all, limits.perLink.windowMs)
  const visitors: Record<string, number[]> = {}
  for (const [key, hits] of Object.entries(window.visitors)) {
    const kept = recent(hits, limits.perVisitor.windowMs)
    if (kept.length > 0) visitors[key] = kept
  }
  const mine = visitors[visitor] ?? []

  const wait = (hits: number[], limit: number, windowMs: number) =>
    hits.length >= limit ? hits[hits.length - limit]! + windowMs - now : 0
  const retryAfterMs = Math.max(
    wait(mine, limits.perVisitor.limit, limits.perVisitor.windowMs),
    wait(all, limits.perLink.limit, limits.perLink.windowMs)
  )
  if (retryAfterMs > 0) {
    return { ok: false, retryAfterMs, window: { all, visitors } }
  }

  visitors[visitor] = [...mine, now]
  const keys = Object.keys(visitors)
  if (keys.length > MAX_TRACKED_VISITORS) {
    const byLatest = keys.sort(
      (a, b) => visitors[a]!.at(-1)! - visitors[b]!.at(-1)!
    )
    for (const key of byLatest.slice(0, keys.length - MAX_TRACKED_VISITORS)) {
      delete visitors[key]
    }
  }
  return { ok: true, retryAfterMs: 0, window: { all: [...all, now], visitors } }
}

// ── Keeping receipts out of public data ───────────────────────────────

/** What a receipt id is replaced with. Truthy, so `if (slot.takenBy)` holds. */
export const HIDDEN_RECEIPT = "private"

/**
 * A copy of `value` with every string that is one of `receipts` replaced
 * by HIDDEN_RECEIPT, at any depth. Bots link public items to submissions
 * (`slot.takenBy = booking.id`); without this, anyone could list the public
 * collection, take the id and read that person's submission.
 */
export function hideReceipts<T>(value: T, receipts: ReadonlySet<string>): T {
  if (receipts.size === 0) return value
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return receipts.has(v) ? HIDDEN_RECEIPT : v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        // Keys can hold ids too: { "3a2e…": true }.
        out[receipts.has(k) ? HIDDEN_RECEIPT : k] = walk(x)
      }
      return out
    }
    return v
  }
  return walk(value) as T
}
