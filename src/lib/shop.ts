/**
 * Shopping across Shopify stores through Shop MCP (https://mcp.shop.com).
 * These are the shapes bots' shop tools return and the thread renders:
 * trimmed from Shop's UCP documents to what a card needs. Shared by the
 * agents and the client, so no server-only imports.
 */

/** An amount in minor units (cents), with its ISO 4217 currency. */
export interface Money {
  amount: number
  currency: string
}

export interface ShopImage {
  url: string
  alt: string
  width?: number
  height?: number
}

export interface ShopMedia extends ShopImage {
  /** For a video, the URL to play. The image fields are its poster. */
  video?: string
}

export interface ShopSeller {
  name: string
  /** The store's own site, for "View on …". */
  url: string
  /** The `*.myshopify.com` domain checkout calls take as `shop`. */
  domain: string
}

export interface ShopRating {
  value: number
  max: number
  count: number
}

export interface ShopOption {
  name: string
  values: {
    label: string
    /** Only known after a product lookup. Absent means not checked. */
    available?: boolean
  }[]
}

/** The one size/color combination an offer is for. */
export interface ShopVariant {
  id: string
  /** `[{ name: "Size", label: "M" }]` */
  options: { name: string; label: string }[]
  price: Money
  /** The price before a sale, when the store shows one. */
  listPrice?: Money
  available: boolean
  /** The store's product page for this variant, as Shop returned it. */
  url: string
}

/** A product as a search result card shows it. */
export interface ShopProductSummary {
  id: string
  title: string
  seller: ShopSeller
  image?: ShopImage
  rating?: ShopRating
  options: ShopOption[]
  variant: ShopVariant
}

/** A product as the product panel shows it. */
export interface ShopProduct extends ShopProductSummary {
  media: ShopMedia[]
  /** Plain text, without the store's HTML. */
  description: string
  highlights: string[]
  specs: string[]
  /** The options as asked for, which a sold-out combination can relax. */
  selected: { name: string; label: string }[]
}

/** What a search was for, so the card can say so and fetch more. */
export interface ShopQuery {
  query: string
  /** A product the results should look like. */
  like?: string
  size?: string[]
  color?: string[]
  gender?: string
  /** Minor units of `currency`. */
  minPrice?: number
  maxPrice?: number
  currency?: string
  /** Two-letter country the results ship to. */
  country?: string
}

export interface ShopSearchResult {
  query: ShopQuery
  products: ShopProductSummary[]
  total: number
  /** Pass back to fetch the next page with the same query. */
  cursor?: string
  /** Shop's notes on the search, e.g. a filter it could not apply. */
  notes: string[]
}

export type ShopCheckoutStatus =
  | "incomplete"
  | "requires_escalation"
  | "ready_for_complete"
  | "complete_in_progress"
  | "completed"
  | "canceled"

export interface ShopCheckoutLine {
  id: string
  title: string
  image?: string
  quantity: number
  /** The line's total, in the checkout's currency. */
  total: number
}

export interface ShopCheckoutMessage {
  type: "error" | "warning" | "info"
  code: string
  content: string
  severity?: string
}

export interface ShopCheckout {
  id: string
  /** The store's `*.myshopify.com` domain. */
  shop: string
  /** The store's name, as the bot knew it from search. */
  store: string
  status: ShopCheckoutStatus
  currency: string
  lines: ShopCheckoutLine[]
  /** In the merchant's order: subtotal, discounts, shipping, tax, total. */
  totals: { type: string; label: string; amount: number }[]
  messages: ShopCheckoutMessage[]
  /** Refund, shipping and other policies. */
  links: { type: string; title: string; url: string }[]
  /** Shop's page where the user reviews and pays. */
  continueUrl?: string
  expiresAt?: string
  order?: { id: string; label?: string; url?: string }
}

/**
 * What the user chose in the product panel, sent with their "Buy" message
 * (as `MessageMeta.pick`) so the bot checks out the exact item.
 */
export interface ShopPick {
  productId: string
  variantId: string
  shop: string
  store: string
  title: string
  options: { name: string; label: string }[]
  quantity: number
}

/** Shop's MCP server. Search and checkout need no sign-in. */
export const SHOP_MCP_URL = "https://mcp.shop.com"

/** Digits after the decimal point in a currency, from Intl (JPY 0, KWD 3). */
export function fractionDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * "$29.99", "₹3,650". Whole amounts drop their cents. `locale` is undefined
 * after hydration (the viewer's own) and fixed before it, so the server and
 * the first client render agree.
 */
export function formatMoney(amount: number, currency: string, locale?: string) {
  const digits = fractionDigits(currency)
  const value = amount / 10 ** digits
  const whole = Number.isInteger(value)
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    return `${value.toFixed(whole ? 0 : digits)} ${currency}`
  }
}

/** 40 (dollars) → 4000 (cents), for price filters. */
export function toMinorUnits(amount: number, currency: string) {
  return Math.round(amount * 10 ** fractionDigits(currency))
}

/** Whole percent off the list price, or null when there is no sale. */
export function discountPercent(price: Money, listPrice?: Money) {
  if (!listPrice || listPrice.currency !== price.currency) return null
  if (listPrice.amount <= price.amount) return null
  const off = Math.round((1 - price.amount / listPrice.amount) * 100)
  return off >= 1 ? off : null
}

/**
 * A smaller copy of a Shopify CDN image. Other hosts are returned as they
 * are. Product photos arrive at 2000px and more; a card needs a few hundred.
 */
export function sizedImage(url: string, width: number) {
  try {
    const u = new URL(url)
    if (u.hostname !== "cdn.shopify.com") return url
    u.searchParams.set("width", String(Math.round(width)))
    return u.toString()
  } catch {
    return url
  }
}

/** "12,345" → "12k" style, for review counts on small cards. */
export function compactCount(count: number) {
  if (count < 1000) return String(count)
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: count < 10_000 ? 1 : 0,
  }).format(count)
}

/** The store's own hostname, without "www.", for links and favicons. */
export function storeHost(seller: Pick<ShopSeller, "url" | "domain">) {
  try {
    return new URL(seller.url).hostname.replace(/^www\./, "")
  } catch {
    return seller.domain
  }
}

/** A checkout the user can still act on: open, not paid, not expired. */
export function checkoutOpen(checkout: ShopCheckout, now = Date.now()) {
  if (checkout.status === "completed" || checkout.status === "canceled") {
    return false
  }
  if (!checkout.expiresAt) return true
  const expires = Date.parse(checkout.expiresAt)
  return Number.isNaN(expires) || expires > now
}
