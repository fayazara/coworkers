import { useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import { discountPercent, formatMoney } from "@/lib/shop"
import type { Money, ShopVariant } from "@/lib/shop"

/** A site's favicon, or nothing when it has none. */
export function Favicon({
  host,
  className = "size-[1em] rounded-[3px]",
}: {
  host: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed || !host) return null
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 ${className}`}
    />
  )
}

/**
 * Money in the viewer's own format once hydrated. Before that a fixed
 * locale, so the server and the first client render agree.
 */
export function useMoney() {
  const hydrated = useHydrated()
  const locale = hydrated ? undefined : "en-US"
  return (amount: number, currency: string) =>
    formatMoney(amount, currency, locale)
}

const STAR =
  "M12 2.8l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.58-4.46 6.33-.92L12 2.8z"

function StarShape({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={STAR} fill="currentColor" strokeLinejoin="round" />
    </svg>
  )
}

/** One filled star, for a compact rating. */
export function Star({ className = "size-3" }: { className?: string }) {
  return <StarShape className={`text-[#f5a524] ${className}`} />
}

/** Five stars, filled to the rating. */
export function Stars({
  value,
  max = 5,
  className = "size-4",
}: {
  value: number
  max?: number
  className?: string
}) {
  const filled = Math.max(0, Math.min(1, value / max)) * 100
  const row = (tone: string) => (
    <span className={`flex ${tone}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <StarShape key={i} className={`shrink-0 ${className}`} />
      ))}
    </span>
  )
  return (
    <span
      role="img"
      aria-label={`Rated ${value} out of ${max}`}
      className="relative inline-flex"
    >
      {row("text-(--fill-active)")}
      <span
        className="absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${filled}%` }}
      >
        {row("text-[#f5a524]")}
      </span>
    </span>
  )
}

/** "$29.99 $34.99 −14%": the price, and the sale when there is one. */
export function Price({
  variant,
  size = "sm",
}: {
  variant: Pick<ShopVariant, "price" | "listPrice">
  size?: "sm" | "lg"
}) {
  const money = useMoney()
  const off = discountPercent(variant.price, variant.listPrice)
  const show = (m: Money) => money(m.amount, m.currency)
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
      <span
        className={
          size === "lg"
            ? "text-[22px] font-semibold tracking-tight text-kumo-default"
            : "text-[14px] font-semibold text-kumo-default"
        }
      >
        {show(variant.price)}
      </span>
      {variant.listPrice && off ? (
        <>
          <span
            className={`text-kumo-subtle line-through decoration-1 ${size === "lg" ? "text-[15px]" : "text-xs"}`}
          >
            {show(variant.listPrice)}
          </span>
          {size === "lg" ? (
            <span className="self-center rounded-full bg-kumo-success/12 px-2 py-0.5 text-xs font-semibold text-kumo-success">
              Save {off}%
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}

/** "India", for a two-letter code. */
export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}
