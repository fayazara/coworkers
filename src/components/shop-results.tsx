import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useSearch } from "@tanstack/react-router"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  CaretLeftIcon,
  CaretRightIcon,
  ShoppingBagIcon,
} from "@/components/icons"
import { ShimmerText } from "@/components/shimmer-text"
import {
  Favicon,
  Price,
  Star,
  countryName,
  useMoney,
} from "@/components/shop-bits"
import { useOptionalHub } from "@/lib/hub-context"
import {
  compactCount,
  discountPercent,
  sizedImage,
  storeHost,
} from "@/lib/shop"
import { rememberProduct } from "@/lib/shop-products"
import type { ToolCall } from "@/lib/message-parts"
import type {
  ShopProductSummary,
  ShopQuery,
  ShopSearchResult,
} from "@/lib/shop"

/** Card width; the image is 4:5 above the text. */
const TILE = "w-[164px] md:w-[176px]"

function isSearchResult(value: unknown): value is ShopSearchResult {
  const v = value as ShopSearchResult | null
  return Boolean(v && Array.isArray(v.products) && v.query)
}

/** "Size M · Under $40 · Ships to India" */
function scopeOf(query: ShopQuery, money: ReturnType<typeof useMoney>) {
  const parts: string[] = []
  if (query.size?.length) parts.push(`Size ${query.size.join(", ")}`)
  if (query.color?.length) parts.push(query.color.join(", "))
  if (query.gender) {
    parts.push(query.gender.charAt(0).toUpperCase() + query.gender.slice(1))
  }
  if (query.currency && query.maxPrice !== undefined) {
    parts.push(
      query.minPrice !== undefined
        ? `${money(query.minPrice, query.currency)}–${money(query.maxPrice, query.currency)}`
        : `Under ${money(query.maxPrice, query.currency)}`
    )
  } else if (query.currency && query.minPrice !== undefined) {
    parts.push(`Over ${money(query.minPrice, query.currency)}`)
  }
  if (query.country) parts.push(`Ships to ${countryName(query.country)}`)
  return parts
}

/** Edge fades and arrow buttons for a row that scrolls sideways. */
function useSideScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    })
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])
  const page = (direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" })
  }
  return { ref, edges, measure, page }
}

/** shop_search in the thread: a row of product cards that opens the panel. */
export function ShopResults({
  call,
  botId,
}: {
  call: ToolCall
  botId?: string
}) {
  if (call.state !== "done" || !isSearchResult(call.output)) {
    return <ShopResultsLoading query={String(call.input.query ?? "")} />
  }
  return <ResultRow result={call.output} botId={botId} />
}

function ResultRow({
  result,
  botId,
}: {
  result: ShopSearchResult
  botId?: string
}) {
  const hub = useOptionalHub()
  const money = useMoney()
  const [products, setProducts] = useState(result.products)
  const [cursor, setCursor] = useState(result.cursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { ref, edges, measure, page } = useSideScroll()
  // The panel's product, so its card stays marked while it is open.
  const openId = (useSearch({ strict: false }) as { id?: string }).id

  useEffect(measure, [products, measure])

  async function more() {
    if (!hub?.shop || !cursor) return
    setLoading(true)
    setError(null)
    try {
      const next = await hub.shop.more(result.query, cursor)
      setProducts((prev) => {
        const known = new Set(prev.map((p) => p.id))
        return [...prev, ...next.products.filter((p) => !known.has(p.id))]
      })
      setCursor(next.cursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more.")
    } finally {
      setLoading(false)
    }
  }

  if (products.length === 0) {
    return (
      <div className="flex w-full max-w-[640px] items-center gap-3 rounded-3xl bg-kumo-tint p-3 pr-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-kumo-base text-kumo-subtle outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <ShoppingBagIcon size={20} />
        </span>
        <p className="min-w-0 text-[15px] text-kumo-default">
          Nothing in stores for “{result.query.query || "that"}”
          {result.notes[0] ? (
            <span className="block text-sm text-kumo-subtle">
              {result.notes[0]}
            </span>
          ) : null}
        </p>
      </div>
    )
  }

  const scope = scopeOf(result.query, money)
  const left = Math.max(0, result.total - products.length)
  return (
    <section
      aria-label={`Products for ${result.query.query}`}
      className="group/row w-full"
    >
      <Header query={result.query.query} scope={scope} total={result.total} />
      <div className="relative -mx-4 md:-mx-6">
        <div
          ref={ref}
          onScroll={measure}
          className="flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pt-3 pb-1 md:scroll-px-6 md:px-6 [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage: `linear-gradient(to right, ${edges.start ? "black" : "transparent"}, black 28px, black calc(100% - 28px), ${edges.end ? "black" : "transparent"})`,
          }}
        >
          {products.map((product) => (
            <Tile
              key={product.id}
              product={product}
              botId={botId}
              open={product.id === openId}
            />
          ))}
          {cursor && hub?.shop ? (
            <button
              type="button"
              onClick={() => void more()}
              disabled={loading}
              className={`pressable ${TILE} flex aspect-[4/5] shrink-0 snap-start flex-col items-center justify-center gap-1 self-start rounded-2xl bg-(--fill-hover) text-center transition-colors hover:bg-(--fill-active) focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:outline-none`}
            >
              {loading ? (
                <Loader size="sm" />
              ) : (
                <>
                  <span className="text-[15px] font-medium text-kumo-default">
                    Show more
                  </span>
                  {left > 0 ? (
                    <span className="text-xs text-kumo-subtle tabular-nums">
                      {compactCount(left)} more
                    </span>
                  ) : null}
                </>
              )}
            </button>
          ) : null}
        </div>
        <EdgeButton side="left" hidden={edges.start} onClick={() => page(-1)} />
        <EdgeButton side="right" hidden={edges.end} onClick={() => page(1)} />
      </div>
      {error ? (
        <p role="alert" className="mt-1 px-1 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function Header({
  query,
  scope,
  total,
}: {
  query: string
  scope: string[]
  total?: number
}) {
  return (
    <div className="flex items-center gap-2.5 pl-1">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-(--fill-hover) text-kumo-default">
        <ShoppingBagIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-kumo-default">
          {query ? <>“{query}”</> : "Similar items"}
          {total !== undefined ? (
            <span className="text-kumo-subtle tabular-nums">
              {" "}
              · {compactCount(total)} {total === 1 ? "result" : "results"}
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-kumo-subtle">
          {scope.length ? scope.join(" · ") : "Across Shopify stores"}
        </p>
      </div>
    </div>
  )
}

function EdgeButton({
  side,
  hidden,
  onClick,
}: {
  side: "left" | "right"
  hidden: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Scroll back" : "Scroll for more"}
      tabIndex={-1}
      onClick={onClick}
      // Centred on the photos, not the text under them. Touch scrolls by swiping.
      className={`absolute top-[114px] hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-kumo-base text-kumo-default shadow-[0_0_0_1px_var(--color-kumo-line),0_2px_8px_oklch(0_0_0/0.12)] transition-[opacity,scale] duration-150 md:top-[122px] [@media(pointer:fine)]:flex ${side === "left" ? "left-2" : "right-2"} ${hidden ? "pointer-events-none scale-90 opacity-0" : "opacity-0 group-hover/row:opacity-100 hover:scale-105"}`}
    >
      {side === "left" ? (
        <CaretLeftIcon size={18} />
      ) : (
        <CaretRightIcon size={18} />
      )}
    </button>
  )
}

function Tile({
  product,
  botId,
  open,
}: {
  product: ShopProductSummary
  botId?: string
  open: boolean
}) {
  const off = discountPercent(product.variant.price, product.variant.listPrice)
  const body = (
    <>
      <div
        className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-white outline -outline-offset-1 transition-[outline-color] ${open ? "outline-2 outline-kumo-contrast" : "outline-1 outline-black/[0.06]"}`}
      >
        {product.image ? (
          <img
            src={sizedImage(product.image.url, 360)}
            srcSet={`${sizedImage(product.image.url, 360)} 1x, ${sizedImage(product.image.url, 720)} 2x`}
            alt={product.image.alt || product.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover transition-transform duration-300 ease-out group-hover/tile:scale-[1.03]"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-kumo-subtle">
            <ShoppingBagIcon size={28} />
          </span>
        )}
        {off ? (
          <span className="absolute top-2 left-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-[#0b7a3e] tabular-nums shadow-[0_1px_2px_oklch(0_0_0/0.08)]">
            −{off}%
          </span>
        ) : null}
        {!product.variant.available ? (
          <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/70 py-1 text-center text-[11px] font-medium text-white backdrop-blur-sm">
            Sold out
          </span>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <p className="flex items-center gap-1.5 text-xs text-kumo-subtle">
          <Favicon host={storeHost(product.seller)} />
          <span className="truncate">{product.seller.name}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug font-medium text-pretty text-kumo-default">
          {product.title}
        </p>
        <p className="mt-1">
          <Price variant={product.variant} />
        </p>
        {product.rating ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-kumo-subtle tabular-nums">
            <Star />
            <span className="text-kumo-default">
              {product.rating.value.toFixed(1)}
            </span>
            <span>({compactCount(product.rating.count)})</span>
          </p>
        ) : null}
      </div>
    </>
  )
  const className = `group/tile ${TILE} shrink-0 snap-start rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-canvas`
  if (!botId) return <div className={className}>{body}</div>
  return (
    <Link
      to="/bots/$botId/product"
      params={{ botId }}
      search={{ id: product.id }}
      onClick={() => rememberProduct(product)}
      draggable={false}
      aria-label={`${product.title} from ${product.seller.name}`}
      className={`pressable ${className}`}
    >
      {body}
    </Link>
  )
}

function ShopResultsLoading({ query }: { query: string }) {
  return (
    <section aria-busy="true" className="w-full">
      <div className="flex items-center gap-2.5 pl-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-(--fill-hover) text-kumo-default">
          <ShoppingBagIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate">
            <ShimmerText
              className="text-[15px]"
              text={
                query ? `Searching stores for “${query}”` : "Searching stores"
              }
            />
          </p>
          <p className="truncate text-xs text-kumo-subtle">
            Checking prices and stock
          </p>
        </div>
      </div>
      <div className="-mx-4 flex gap-3 overflow-hidden px-4 pt-3 pb-1 md:-mx-6 md:px-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`${TILE} shrink-0`}>
            <div
              className="shop-skeleton aspect-[4/5] rounded-2xl"
              style={{ animationDelay: `${i * 120}ms` }}
            />
            <div className="mt-2 space-y-1.5 px-0.5">
              <div className="shop-skeleton h-3 w-16 rounded-full" />
              <div className="shop-skeleton h-3.5 w-full rounded-full" />
              <div className="shop-skeleton h-3.5 w-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
