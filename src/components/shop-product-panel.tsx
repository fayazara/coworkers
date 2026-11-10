import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useHydrated, useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  LockIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  ShoppingBagIcon,
  XIcon,
} from "@/components/icons"
import { Favicon, Price, Stars, useMoney } from "@/components/shop-bits"
import { useBot } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
import { sizedImage, storeHost } from "@/lib/shop"
import { isDetailed, rememberProduct, seenProduct } from "@/lib/shop-products"
import type {
  ShopMedia,
  ShopOption,
  ShopPick,
  ShopProduct,
  ShopProductSummary,
} from "@/lib/shop"

type Selection = { name: string; label: string }[]

const MAX_QUANTITY = 10

/**
 * The product panel beside the thread (a sheet on phones): photos, every
 * size and color with live stock and price, and Buy, which asks the bot to
 * set up the checkout for exactly this item.
 */
export function ShopProductPanel({ productId }: { productId: string }) {
  const hub = useHub()
  const shop = hub.shop
  const { botId, send, busy } = useBot()
  const navigate = useNavigate()
  const [product, setProduct] = useState<
    ShopProductSummary | ShopProduct | null
  >(() => seenProduct(productId))
  const [selected, setSelected] = useState<Selection>(
    () => seenProduct(productId)?.variant.options ?? []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const request = useRef(0)

  const load = useCallback(
    async (selection: Selection) => {
      if (!shop) return
      const n = ++request.current
      setLoading(true)
      setError(null)
      try {
        const next = await shop.product(productId, selection)
        if (n !== request.current) return
        rememberProduct(next)
        setProduct(next)
        setSelected(
          next.variant.options.length ? next.variant.options : selection
        )
      } catch (err) {
        if (n !== request.current) return
        setError(
          err instanceof Error ? err.message : "Could not load this product."
        )
      } finally {
        if (n === request.current) setLoading(false)
      }
    },
    [shop, productId]
  )

  // Details (stock per size, photos, highlights) once the hub is up.
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!shop || loadedFor.current === productId) return
    loadedFor.current = productId
    void load(seenProduct(productId)?.variant.options ?? [])
  }, [shop, productId, load])

  function choose(name: string, label: string) {
    const next = selected.some((o) => o.name === name)
      ? selected.map((o) => (o.name === name ? { name, label } : o))
      : [...selected, { name, label }]
    setSelected(next)
    void load(next)
  }

  function close() {
    void navigate({ to: "/bots/$botId", params: { botId } })
  }

  function buy() {
    if (!product || !send) return
    const variant = product.variant
    const options = variant.options
    const pick: ShopPick = {
      productId: product.id,
      variantId: variant.id,
      shop: product.seller.domain,
      store: product.seller.name,
      title: product.title,
      options,
      quantity,
    }
    const what = options.length
      ? `${product.title} (${options.map((o) => `${o.name} ${o.label}`).join(", ")})`
      : product.title
    send(
      `Buy ${quantity > 1 ? `${quantity} × ` : ""}${what} from ${product.seller.name}`,
      { pick }
    )
    close()
  }

  // What was asked for and what Shop could match, when they differ.
  const relaxed =
    product && isDetailed(product) && !loading
      ? selected.filter(
          (want) =>
            !product.variant.options.some(
              (o) => o.name === want.name && o.label === want.label
            )
        )
      : []

  return (
    <aside
      aria-label={product?.title ?? "Product"}
      className="flex h-full flex-col bg-kumo-canvas"
    >
      <div className="col-header justify-between">
        <div className="flex min-w-0 items-center gap-2 pl-1.5">
          {product ? (
            <>
              <Favicon
                host={storeHost(product.seller)}
                className="size-4 rounded"
              />
              <h2 className="truncate text-[15px] font-medium text-kumo-default">
                {product.seller.name}
              </h2>
            </>
          ) : (
            <h2 className="text-[15px] font-medium text-kumo-default">
              Product
            </h2>
          )}
        </div>
        <button
          type="button"
          aria-label="Close product"
          onClick={close}
          className="icon-btn"
        >
          <XIcon size={18} />
        </button>
      </div>

      {product ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 px-4 pb-6">
              <Gallery
                // A new set of photos (another colour) starts at the first.
                key={galleryOf(product)[0]?.url ?? "none"}
                media={galleryOf(product)}
                title={product.title}
              />
              <Summary product={product} />
              {product.options.map((option) => (
                <OptionPicker
                  key={option.name}
                  option={option}
                  value={
                    selected.find((o) => o.name === option.name)?.label ?? ""
                  }
                  onChoose={(label) => choose(option.name, label)}
                />
              ))}
              {relaxed.length ? (
                <p className="text-sm text-pretty text-kumo-warning">
                  {relaxed.map((o) => `${o.name} ${o.label}`).join(", ")}{" "}
                  {relaxed.length === 1 ? "isn't" : "aren't"} available with
                  that combination. Showing the closest match.
                </p>
              ) : null}
              {error ? (
                <p className="flex items-center gap-2 text-sm text-kumo-danger">
                  <span className="min-w-0 flex-1">{error}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    icon={<ArrowClockwiseIcon size={14} />}
                    onClick={() => void load(selected)}
                  >
                    Retry
                  </Button>
                </p>
              ) : null}
              {isDetailed(product) ? (
                <Details product={product} />
              ) : loading ? (
                <DetailsLoading />
              ) : null}
            </div>
          </div>
          <BuyBar
            product={product}
            quantity={quantity}
            setQuantity={setQuantity}
            loading={loading}
            disabledReason={
              !send ? "Connecting…" : busy ? "Wait for the bot to finish" : null
            }
            onBuy={buy}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          {error ? (
            <div className="space-y-3 px-6 text-center">
              <p className="text-sm text-kumo-danger">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => void load([])}
              >
                Try again
              </Button>
            </div>
          ) : (
            <Loader />
          )}
        </div>
      )}
    </aside>
  )
}

function galleryOf(product: ShopProductSummary | ShopProduct): ShopMedia[] {
  if (isDetailed(product) && product.media.length) return product.media
  return product.image ? [product.image] : []
}

/** Photos and videos, swiped on touch, stepped with arrows or thumbnails. */
function Gallery({ media, title }: { media: ShopMedia[]; title: string }) {
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const go = (i: number) => {
    const el = strip.current
    if (!el) return
    const next = Math.max(0, Math.min(media.length - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" })
  }

  function onScroll() {
    const el = strip.current
    if (!el || el.clientWidth === 0) return
    setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  if (media.length === 0) {
    return (
      <div className="mx-auto flex aspect-[4/5] max-h-[42vh] w-full items-center justify-center rounded-3xl bg-(--fill-hover) text-kumo-subtle md:max-h-[56vh]">
        <ShoppingBagIcon size={36} />
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="group/gallery relative mx-auto aspect-[4/5] max-h-[42vh] max-w-[calc(42vh*0.8)] overflow-hidden rounded-3xl bg-white outline outline-1 -outline-offset-1 outline-black/[0.06] md:max-h-[56vh] md:max-w-[calc(56vh*0.8)]">
        <div
          ref={strip}
          onScroll={onScroll}
          className="flex size-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          {media.map((item, i) => (
            <Slide
              key={item.url}
              item={item}
              active={i === index}
              eager={i === 0}
              alt={item.alt || title}
            />
          ))}
        </div>
        {media.length > 1 ? (
          <>
            <GalleryArrow
              side="left"
              hidden={index === 0}
              onClick={() => go(index - 1)}
            />
            <GalleryArrow
              side="right"
              hidden={index === media.length - 1}
              onClick={() => go(index + 1)}
            />
            <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
              {index + 1} / {media.length}
            </span>
          </>
        ) : null}
      </div>
      {media.length > 1 ? (
        // Padded on every side so the chosen thumbnail's outline is not clipped.
        <div className="-mx-4 -my-1 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 py-1 [&::-webkit-scrollbar]:hidden">
          {media.map((item, i) => (
            <button
              key={item.url}
              type="button"
              aria-label={`Show ${item.video ? "video" : "photo"} ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={`relative h-[60px] w-12 shrink-0 overflow-hidden rounded-xl bg-white outline -outline-offset-1 transition-[outline-color,opacity] ${i === index ? "outline-2 outline-kumo-contrast" : "opacity-80 outline-1 outline-black/[0.06] hover:opacity-100"}`}
            >
              <img
                src={sizedImage(item.url, 120)}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
              {item.video ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
                  <PlayIcon size={14} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Slide({
  item,
  active,
  eager,
  alt,
}: {
  item: ShopMedia
  active: boolean
  eager: boolean
  alt: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = video.current
    if (!el) return
    if (active) void el.play().catch(() => {})
    else el.pause()
  }, [active])
  return (
    <div className="size-full shrink-0 snap-center">
      {item.video ? (
        <video
          ref={video}
          src={item.video}
          poster={sizedImage(item.url, 900)}
          muted
          loop
          playsInline
          preload="none"
          aria-label={alt}
          className="size-full object-cover"
        />
      ) : (
        <img
          src={sizedImage(item.url, 900)}
          srcSet={`${sizedImage(item.url, 600)} 600w, ${sizedImage(item.url, 900)} 900w, ${sizedImage(item.url, 1400)} 1400w`}
          sizes="(max-width: 768px) 100vw, 560px"
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      )}
    </div>
  )
}

function GalleryArrow({
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
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      onClick={onClick}
      className={`absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-black shadow-[0_2px_8px_oklch(0_0_0/0.15)] transition-[opacity,scale] duration-150 [@media(pointer:fine)]:flex ${side === "left" ? "left-3" : "right-3"} ${hidden ? "pointer-events-none opacity-0" : "opacity-0 group-hover/gallery:opacity-100 hover:scale-105"}`}
    >
      {side === "left" ? (
        <CaretLeftIcon size={18} />
      ) : (
        <CaretRightIcon size={18} />
      )}
    </button>
  )
}

function Summary({ product }: { product: ShopProductSummary | ShopProduct }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[20px] leading-tight font-semibold tracking-tight text-pretty text-kumo-default">
        {product.title}
      </h3>
      {product.rating ? (
        <p className="flex items-center gap-2 text-sm text-kumo-subtle tabular-nums">
          <Stars value={product.rating.value} max={product.rating.max} />
          <span>
            <span className="font-medium text-kumo-default">
              {product.rating.value.toFixed(1)}
            </span>{" "}
            · {product.rating.count.toLocaleString("en-US")}{" "}
            {product.rating.count === 1 ? "review" : "reviews"}
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Price variant={product.variant} size="lg" />
        <Availability available={product.variant.available} />
      </div>
    </div>
  )
}

function Availability({ available }: { available: boolean }) {
  return available ? (
    <span className="inline-flex items-center gap-1 text-sm text-kumo-success">
      <CheckIcon size={14} />
      In stock
    </span>
  ) : (
    <span className="text-sm font-medium text-kumo-danger">Sold out</span>
  )
}

/** A colour name the browser knows, for a swatch beside the label. */
function swatch(label: string) {
  const name = label.toLowerCase().replace(/[^a-z]/g, "")
  if (!name || typeof CSS === "undefined") return null
  return CSS.supports("color", name) ? name : null
}

function OptionPicker({
  option,
  value,
  onChoose,
}: {
  option: ShopOption
  value: string
  onChoose: (label: string) => void
}) {
  const hydrated = useHydrated()
  const colors = /colou?r/i.test(option.name)
  // Long lists (43 colours) fold to two rows until opened.
  const [expanded, setExpanded] = useState(false)
  const long = option.values.length > 12
  const values =
    long && !expanded
      ? keepChosen(option.values.slice(0, 11), option.values, value)
      : option.values
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm text-kumo-subtle">
        {option.name}
        {value ? (
          <span className="font-medium text-kumo-default"> · {value}</span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => {
          const chosen = v.label === value
          const soldOut = v.available === false
          const color = colors && hydrated ? swatch(v.label) : null
          return (
            <button
              key={v.label}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChoose(v.label)}
              title={soldOut ? `${v.label} · sold out` : v.label}
              className={`pressable inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:outline-none ${
                chosen
                  ? "bg-kumo-contrast font-medium text-kumo-inverse"
                  : soldOut
                    ? "text-kumo-subtle line-through decoration-1 shadow-[inset_0_0_0_1px_var(--color-kumo-line)] hover:bg-(--fill-hover)"
                    : "bg-kumo-base text-kumo-default shadow-[inset_0_0_0_1px_var(--color-kumo-line)] hover:bg-(--fill-hover)"
              }`}
            >
              {color ? (
                <span
                  aria-hidden="true"
                  className="size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_oklch(0_0_0/0.15)]"
                  style={{ background: color }}
                />
              ) : null}
              {v.label}
            </button>
          )
        })}
        {long ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="h-9 rounded-full px-3 text-sm font-medium text-kumo-default hover:bg-(--fill-hover)"
          >
            {expanded
              ? "Fewer"
              : `+${option.values.length - values.length} more`}
          </button>
        ) : null}
      </div>
    </fieldset>
  )
}

/** The first few values, with the chosen one swapped in if it was further on. */
function keepChosen(
  shown: ShopOption["values"],
  all: ShopOption["values"],
  value: string
) {
  if (!value || shown.some((v) => v.label === value)) return shown
  const chosen = all.find((v) => v.label === value)
  return chosen ? [...shown.slice(0, -1), chosen] : shown
}

function Details({ product }: { product: ShopProduct }) {
  const specs = useMemo(
    () =>
      product.specs.map((line) => {
        const at = line.indexOf(":")
        return at > 0 && at < 40
          ? { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
          : { key: "", value: line }
      }),
    [product.specs]
  )
  return (
    <div className="space-y-5 pt-1">
      {product.highlights.length ? (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-kumo-default">
            Highlights
          </h4>
          <ul className="space-y-1.5">
            {product.highlights.map((line) => (
              <li
                key={line}
                className="flex gap-2.5 text-sm leading-relaxed text-pretty text-kumo-default"
              >
                <CheckIcon
                  size={14}
                  className="mt-[3px] shrink-0 text-kumo-success"
                />
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {specs.length ? (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-kumo-default">Details</h4>
          <dl className="overflow-hidden rounded-2xl bg-kumo-base text-sm shadow-[0_0_0_1px_var(--color-kumo-line)]">
            {specs.map((spec, i) => (
              <div
                key={`${spec.key}-${i}`}
                className="flex gap-3 border-b border-kumo-line px-3.5 py-2.5 last:border-b-0"
              >
                {spec.key ? (
                  <dt className="w-28 shrink-0 text-kumo-subtle">{spec.key}</dt>
                ) : null}
                <dd className="min-w-0 text-pretty text-kumo-default">
                  {spec.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {product.description ? <Description text={product.description} /> : null}
      <a
        href={product.variant.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-kumo-link hover:underline"
      >
        View on {storeHost(product.seller)}
        <ArrowSquareOutIcon size={14} />
      </a>
    </div>
  )
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 280
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-kumo-default">About</h4>
      <p
        className={`text-sm leading-relaxed text-pretty whitespace-pre-line text-kumo-default ${long && !open ? "line-clamp-5" : ""}`}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-sm font-medium text-kumo-default hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </section>
  )
}

function DetailsLoading() {
  return (
    <div aria-busy="true" className="space-y-2.5 pt-1">
      <div className="shop-skeleton h-3.5 w-24 rounded-full" />
      <div className="shop-skeleton h-3.5 w-full rounded-full" />
      <div className="shop-skeleton h-3.5 w-5/6 rounded-full" />
      <div className="shop-skeleton h-3.5 w-2/3 rounded-full" />
    </div>
  )
}

function BuyBar({
  product,
  quantity,
  setQuantity,
  loading,
  disabledReason,
  onBuy,
}: {
  product: ShopProductSummary | ShopProduct
  quantity: number
  setQuantity: (n: number) => void
  loading: boolean
  disabledReason: string | null
  onBuy: () => void
}) {
  const money = useMoney()
  const { price } = product.variant
  const available = product.variant.available
  return (
    <div className="shrink-0 border-t border-kumo-line px-4 pt-3 pb-[max(12px,var(--safe-bottom))]">
      <div className="flex items-center gap-2.5">
        <div
          role="group"
          aria-label="Quantity"
          className="flex h-11 shrink-0 items-center rounded-full bg-kumo-base shadow-[inset_0_0_0_1px_var(--color-kumo-line)]"
        >
          <button
            type="button"
            aria-label="One fewer"
            disabled={quantity <= 1}
            onClick={() => setQuantity(quantity - 1)}
            className="flex size-11 items-center justify-center rounded-full text-kumo-default transition-colors hover:bg-(--fill-hover) disabled:text-kumo-subtle disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <MinusIcon size={16} />
          </button>
          <span
            aria-live="polite"
            className="w-5 text-center text-[15px] font-medium text-kumo-default tabular-nums"
          >
            {quantity}
          </span>
          <button
            type="button"
            aria-label="One more"
            disabled={quantity >= MAX_QUANTITY}
            onClick={() => setQuantity(quantity + 1)}
            className="flex size-11 items-center justify-center rounded-full text-kumo-default transition-colors hover:bg-(--fill-hover) disabled:text-kumo-subtle disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="btn-ink h-11 min-w-0 flex-1 justify-center rounded-full text-[15px]"
          disabled={!available || loading || disabledReason !== null}
          onClick={onBuy}
        >
          {!available ? (
            "Sold out"
          ) : (
            <span className="truncate tabular-nums">
              Buy · {money(price.amount * quantity, price.currency)}
            </span>
          )}
        </Button>
      </div>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-kumo-subtle">
        <LockIcon size={12} />
        {disabledReason ?? `Your bot sets up the checkout. You pay on Shop.`}
      </p>
    </div>
  )
}
