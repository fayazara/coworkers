import { useCallback, useEffect, useRef, useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  LockIcon,
  ShoppingBagIcon,
  WarningIcon,
} from "@/components/icons"
import { ShimmerText } from "@/components/shimmer-text"
import { useMoney } from "@/components/shop-bits"
import { useOptionalHub } from "@/lib/hub-context"
import { checkoutOpen, sizedImage } from "@/lib/shop"
import type { ToolCall } from "@/lib/message-parts"
import type { ShopCheckout, ShopCheckoutMessage } from "@/lib/shop"

function isCheckout(value: unknown): value is ShopCheckout {
  const v = value as ShopCheckout | null
  return Boolean(v && typeof v.id === "string" && Array.isArray(v.lines))
}

/** What Shop's checkout page will ask for, by message code. */
const STILL_NEEDED: Record<string, string | null> = {
  buyer_identity_contact_method_required: "contact details",
  delivery_address_required: "a delivery address",
  // Follows from the missing address, not from the items.
  delivery_no_delivery_available: null,
  // A store's own step, which the checkout page walks through.
  extension_interaction_required: null,
}

/** Errors the user will sort out on Shop, as one short list. */
function stillNeeded(messages: ShopCheckoutMessage[]) {
  const needs: string[] = []
  const other: ShopCheckoutMessage[] = []
  for (const m of messages) {
    if (m.type !== "error") continue
    if (m.code in STILL_NEEDED) {
      const label = STILL_NEEDED[m.code]
      if (label && !needs.includes(label)) needs.push(label)
    } else {
      other.push(m)
    }
  }
  return { needs: [...needs, "payment"], other }
}

/** "Black Classic Crew Neck - M": Shopify appends the variant to the title. */
function splitTitle(title: string) {
  const at = title.lastIndexOf(" - ")
  return at > 0
    ? { name: title.slice(0, at), variant: title.slice(at + 3) }
    : { name: title, variant: "" }
}

function listJoin(items: string[]) {
  if (items.length < 2) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

const POLICY_ORDER = [
  "refund_policy",
  "shipping_policy",
  "terms_of_service",
  "privacy_policy",
]

/** shop_checkout in the thread: what is in it, and the way to pay. */
export function ShopCheckoutCard({ call }: { call: ToolCall }) {
  if (call.state !== "done" || !isCheckout(call.output)) {
    return (
      <div
        aria-busy="true"
        className="flex w-full max-w-[640px] items-center gap-3 rounded-3xl bg-kumo-tint p-3 pr-4"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-kumo-base text-kumo-subtle outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <ShoppingBagIcon size={20} />
        </span>
        <ShimmerText
          className="text-[15px]"
          text={`Setting up checkout${call.input.store ? ` at ${String(call.input.store)}` : ""}`}
        />
      </div>
    )
  }
  return <Checkout initial={call.output} />
}

/**
 * Re-reads the checkout from Shop when the card shows and when the user
 * comes back to the tab after paying, so a paid order shows as paid.
 */
function useLiveCheckout(initial: ShopCheckout) {
  const hub = useOptionalHub()
  const shop = hub?.shop ?? null
  const [checkout, setCheckout] = useState(initial)
  const [checking, setChecking] = useState(false)
  const latest = useRef(checkout)
  latest.current = checkout

  const check = useCallback(async () => {
    const current = latest.current
    if (!shop || !checkoutOpen(current)) return
    setChecking(true)
    try {
      setCheckout(await shop.checkout(current.shop, current.id, current.store))
    } catch {
      // Keep what we have; the next look tries again.
    } finally {
      setChecking(false)
    }
  }, [shop])

  useEffect(() => {
    void check()
  }, [check])

  return { checkout, checking, check }
}

function Checkout({ initial }: { initial: ShopCheckout }) {
  const { checkout, checking, check } = useLiveCheckout(initial)
  const money = useMoney()
  const hydrated = useHydrated()
  const [wentToPay, setWentToPay] = useState(false)

  // Back from Shop's page: see whether it went through.
  useEffect(() => {
    if (!wentToPay) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [wentToPay, check])

  const paid = checkout.status === "completed"
  const canceled = checkout.status === "canceled"
  // Expiry depends on the clock, so only after hydration.
  const expired = hydrated && !paid && !canceled && !checkoutOpen(checkout)
  const open = !paid && !canceled && !expired
  const amount = (n: number) => money(n, checkout.currency)
  const total = checkout.totals.find((t) => t.type === "total")
  const rows = checkout.totals.filter((t) => t.type !== "total")
  const priced = new Set(checkout.totals.map((t) => t.type))
  const shippingKnown = priced.has("fulfillment") || priced.has("shipping")
  const taxKnown = priced.has("tax")
  const { needs, other } = stillNeeded(checkout.messages)
  const notices = checkout.messages.filter((m) => m.type !== "error")
  const policies = [...checkout.links].sort(
    (a, b) => POLICY_ORDER.indexOf(a.type) - POLICY_ORDER.indexOf(b.type)
  )
  const count = checkout.lines.reduce((n, l) => n + l.quantity, 0)
  const single = checkout.lines.length === 1
  const heldUntil =
    hydrated && checkout.expiresAt
      ? new Date(checkout.expiresAt).toLocaleDateString([], {
          day: "numeric",
          month: "short",
        })
      : null

  return (
    <article
      aria-label={`Checkout at ${checkout.store || checkout.shop}`}
      className="w-full max-w-[640px] rounded-3xl bg-kumo-tint p-3"
    >
      <header className="flex items-start justify-between gap-3 px-3 pt-1 pb-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-kumo-default">
            {checkout.store || "Checkout"}
          </p>
          <p className="truncate text-sm text-kumo-subtle tabular-nums">
            {count} {count === 1 ? "item" : "items"}
            {open && heldUntil ? ` · Held until ${heldUntil}` : ""}
          </p>
        </div>
        <StatusPill
          state={
            paid
              ? "paid"
              : canceled
                ? "canceled"
                : expired
                  ? "expired"
                  : checkout.status === "complete_in_progress"
                    ? "processing"
                    : "ready"
          }
        />
      </header>

      <div className="overflow-hidden rounded-2xl bg-kumo-base shadow-[0_0_0_1px_var(--color-kumo-line),0_1px_2px_oklch(0_0_0/0.03)]">
        <ul className="divide-y divide-kumo-line">
          {checkout.lines.map((line) => {
            const { name, variant } = splitTitle(line.title)
            return (
              <li key={line.id} className="flex items-center gap-3.5 p-3">
                <span
                  className={`relative shrink-0 overflow-hidden rounded-xl bg-white outline outline-1 -outline-offset-1 outline-black/[0.06] ${single ? "h-[100px] w-[80px]" : "h-[70px] w-[56px]"}`}
                >
                  {line.image ? (
                    <img
                      src={sizedImage(line.image, single ? 240 : 168)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-kumo-subtle">
                      <ShoppingBagIcon size={20} />
                    </span>
                  )}
                  {line.quantity > 1 ? (
                    <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/75 px-1.5 text-[11px] font-semibold text-white tabular-nums">
                      {line.quantity}
                    </span>
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[15px] leading-snug font-medium text-pretty text-kumo-default">
                    {name}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-kumo-subtle tabular-nums">
                    {[variant, `Qty ${line.quantity}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 text-[15px] font-medium text-kumo-default tabular-nums">
                  {amount(line.total)}
                </p>
              </li>
            )
          })}
        </ul>
        <dl className="space-y-1.5 border-t border-kumo-line px-3 py-3 text-sm tabular-nums">
          {rows.map((row) => (
            <div key={row.type} className="flex justify-between gap-3">
              <dt className="text-kumo-subtle">{row.label}</dt>
              <dd
                className={
                  row.amount < 0 ? "text-kumo-success" : "text-kumo-default"
                }
              >
                {amount(row.amount)}
              </dd>
            </div>
          ))}
          {!shippingKnown || !taxKnown ? (
            <div className="flex justify-between gap-3">
              <dt className="text-kumo-subtle">
                {!shippingKnown && !taxKnown
                  ? "Shipping and taxes"
                  : !shippingKnown
                    ? "Shipping"
                    : "Taxes"}
              </dt>
              <dd className="text-kumo-subtle">
                {paid ? "Included" : "At checkout"}
              </dd>
            </div>
          ) : null}
          {total ? (
            <div className="flex items-baseline justify-between gap-3 pt-1.5">
              <dt className="text-[15px] font-semibold text-kumo-default">
                {total.label}
              </dt>
              <dd className="text-[19px] font-semibold tracking-tight text-kumo-default">
                {amount(total.amount)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {notices.length || (open && other.length) ? (
        <ul className="mt-3 space-y-1.5 px-1">
          {[...notices, ...(open ? other : [])].map((m, i) => (
            <li
              key={`${m.code}-${i}`}
              className={`flex gap-2 rounded-2xl px-3 py-2 text-sm text-pretty ${m.type === "info" ? "bg-kumo-base text-kumo-default" : "bg-kumo-warning-tint text-kumo-default"}`}
            >
              {m.type !== "info" ? (
                <WarningIcon
                  size={16}
                  className="mt-0.5 shrink-0 text-kumo-warning"
                />
              ) : null}
              <span>{m.content}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="px-1 pt-3 pb-0.5">
        {paid ? (
          <div className="shop-paid flex items-center gap-3 rounded-2xl bg-kumo-base px-3 py-3">
            <CheckCircleIcon size={26} className="shrink-0 text-kumo-success" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-kumo-default">
                Order placed
              </p>
              <p className="truncate text-sm text-kumo-subtle">
                {checkout.order?.label
                  ? `Order ${checkout.order.label}`
                  : "Track it in the Shop app"}
              </p>
            </div>
            {checkout.order?.url ? (
              <a
                href={checkout.order.url}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium text-kumo-default outline outline-1 -outline-offset-1 outline-kumo-line transition-colors hover:bg-(--fill-hover)"
              >
                View order
              </a>
            ) : null}
          </div>
        ) : open && checkout.continueUrl ? (
          <>
            <a
              href={checkout.continueUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => setWentToPay(true)}
              className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-kumo-contrast px-5 text-[15px] font-semibold text-kumo-inverse shadow-[0_1px_2px_oklch(0_0_0/0.12)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-tint focus-visible:outline-none"
            >
              <LockIcon size={16} />
              Review and pay on Shop
              {total ? (
                <span className="font-normal tabular-nums opacity-70">
                  · {amount(total.amount)}
                </span>
              ) : null}
            </a>
            <p className="mt-2 text-center text-xs text-balance text-kumo-subtle">
              {needs.length
                ? `You add ${listJoin(needs)} there. Nothing is charged until you pay.`
                : "Nothing is charged until you pay."}
              {wentToPay ? (
                <button
                  type="button"
                  onClick={() => void check()}
                  disabled={checking}
                  className="ml-1.5 inline-flex items-center gap-1 font-medium text-kumo-default underline-offset-2 hover:underline disabled:opacity-60"
                >
                  <ArrowClockwiseIcon
                    size={12}
                    className={checking ? "step-spin" : ""}
                  />
                  Paid? Check again
                </button>
              ) : null}
            </p>
          </>
        ) : (
          <p className="rounded-2xl bg-kumo-base px-3 py-2.5 text-sm text-kumo-subtle">
            {canceled
              ? "This checkout was canceled."
              : "This checkout expired. Ask for a new one to buy these."}
          </p>
        )}
        {policies.length ? (
          <p className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-kumo-subtle">
            {policies.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 hover:text-kumo-default hover:underline"
              >
                {link.title}
                <ArrowSquareOutIcon size={10} className="opacity-60" />
              </a>
            ))}
          </p>
        ) : null}
      </footer>
    </article>
  )
}

type PillState = "ready" | "processing" | "paid" | "canceled" | "expired"

const PILL: Record<PillState, { label: string; tone: string; dot: string }> = {
  ready: {
    label: "Ready to pay",
    tone: "bg-kumo-base text-kumo-default",
    dot: "bg-kumo-success",
  },
  processing: {
    label: "Processing",
    tone: "bg-kumo-base text-kumo-default",
    dot: "bg-kumo-warning",
  },
  paid: {
    label: "Paid",
    tone: "bg-kumo-success/12 text-kumo-success",
    dot: "bg-kumo-success",
  },
  canceled: {
    label: "Canceled",
    tone: "bg-(--fill-hover) text-kumo-subtle",
    dot: "bg-current opacity-50",
  },
  expired: {
    label: "Expired",
    tone: "bg-(--fill-hover) text-kumo-subtle",
    dot: "bg-current opacity-50",
  },
}

function StatusPill({ state }: { state: PillState }) {
  const pill = PILL[state]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-[0_0_0_1px_var(--color-kumo-line)] ${pill.tone}`}
    >
      <span className={`size-1.5 rounded-full ${pill.dot}`} />
      {pill.label}
    </span>
  )
}
