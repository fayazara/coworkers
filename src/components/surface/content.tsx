import { useEffect, useRef, useState } from "react"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  InfoIcon,
  ListBulletsIcon,
  MinusIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons"
import { useFileData } from "@/components/capture-card"
import { CATALOG } from "@/lib/surface/catalog"
import {
  asText,
  keepHyphens,
  statSize,
  statTone,
} from "@/lib/surface/format"
import {
  normalizeItemValues,
  normalizeRowValues,
  safeSrc,
  safeUrl,
} from "@/lib/surface/normalize"
import { progressValue, resolve } from "@/lib/surface/pointer"
import type { SurfaceNode, Tone } from "@/lib/surface/types"
import { blockFrame, useSurface } from "./context"

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-kumo-subtle",
  good: "text-kumo-success",
  warn: "text-kumo-warning",
}

const VALUE_SIZE = {
  lg: "text-[22px]",
  md: "text-[18px]",
  sm: "text-[16px]",
} as const

type Item = Record<string, unknown>

/** A prop's items: written inline (each scalar may be bound) or bound whole. */
export function useItems(
  node: SurfaceNode,
  prop: string,
  spec: Parameters<typeof normalizeItemValues>[1]
): Item[] {
  const { data } = useSurface()
  const raw = node.props[prop]
  const items = Array.isArray(raw)
    ? (raw as Item[])
    : normalizeItemValues(resolve(raw, data), spec)
  return items.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([k, v]) => [k, resolve(v, data)])
    )
  )
}

/** A prop's text, read through its binding. */
function useText(node: SurfaceNode, prop: string): string | undefined {
  const { data } = useSurface()
  return asText(resolve(node.props[prop], data))
}

/**
 * Counts changes to a value after the first render, so the element showing
 * it can remount and play its pop-in. The first value does not pop.
 */
function useChangeKey(value: unknown) {
  const last = useRef(value)
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (last.current !== value) {
      last.current = value
      setKey((k) => k + 1)
    }
  }, [value])
  return key
}

function StatValue({ value, className }: { value: string; className: string }) {
  const key = useChangeKey(value)
  return (
    <p key={key} className={`${className} ${key ? "sf-pop" : ""}`}>
      {value}
    </p>
  )
}

/** Two to four headline numbers, side by side, each value on one line. */
export function Stats({ node }: { node: SurfaceNode }) {
  const { placement } = useSurface()
  const items = useItems(node, "items", CATALOG.Stats.props.items)
  const size = VALUE_SIZE[statSize(items.map((i) => asText(i.value)))]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {items.map((item, index) => {
        const value = asText(item.value)
        const tone = statTone(value, item.tone as Tone | undefined)
        const detail = asText(item.detail)
        return (
          <div
            key={index}
            className={`min-w-0 rounded-2xl px-4 py-3 ${blockFrame(placement)}`}
          >
            <p className="text-[13px] text-pretty text-kumo-subtle">
              {keepHyphens(String(item.label))}
            </p>
            <StatValue
              value={value ?? "–"}
              className={`mt-0.5 leading-tight font-semibold text-balance tabular-nums ${size} ${
                tone === "neutral" ? "text-kumo-default" : TONE_TEXT[tone]
              }`}
            />
            {detail ? (
              <p className="mt-0.5 text-[13px] text-pretty text-kumo-subtle">
                {keepHyphens(detail)}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function Thumb({ src }: { src: string }) {
  const { readFile } = useSurface()
  const remote = /^https:\/\//i.test(src)
  const file = useFileData(remote ? undefined : readFile, src)
  const url = remote ? src : file.url
  return (
    <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-kumo-tint">
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : null}
    </span>
  )
}

function ListRow({ item }: { item: Item }) {
  const label = asText(item.label) ?? ""
  const value = asText(item.value)
  const detail = asText(item.detail)
  const tag = asText(item.tag)
  // Checked when written; checked again here so no path skips it.
  const url = safeUrl(item.url)
  const image = safeSrc(item.image)
  const tone = (item.tone as Tone | undefined) ?? "neutral"
  const body = (
    <>
      {image ? <Thumb src={image} /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] text-kumo-default">
          <span className="min-w-0 text-pretty">{label}</span>
          {url ? (
            <ArrowSquareOutIcon
              size={13}
              className="shrink-0 text-kumo-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          ) : null}
        </span>
        {detail ? (
          <span className="mt-0.5 block text-[13px] text-pretty text-kumo-subtle">
            {keepHyphens(detail)}
          </span>
        ) : null}
      </span>
      {value || tag ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {value ? (
            <span className="text-[15px] font-medium text-kumo-default tabular-nums">
              {value}
            </span>
          ) : null}
          {tag ? (
            <span
              className={`rounded-full bg-kumo-tint px-2 py-0.5 text-xs ${TONE_TEXT[tone]}`}
            >
              {tag}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  )
  const className = "flex items-start gap-3 rounded-2xl px-3 py-2.5"
  return (
    <li className="sf-enter">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className={`${className} group outline-none hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus`}
        >
          {body}
        </a>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}

/** Things the bot found: a name, the fact about it, a value and a tag. */
export function List({ node }: { node: SurfaceNode }) {
  const { placement } = useSurface()
  const items = useItems(node, "items", CATALOG.List.props.items)
  const title = asText(node.props.title)
  if (!items.length) return null
  return (
    <div className={`rounded-3xl p-2 ${blockFrame(placement)}`}>
      {title ? (
        <p className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[13px] text-kumo-subtle">
          <ListBulletsIcon size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{title}</span>
          <span className="shrink-0 tabular-nums">· {items.length}</span>
        </p>
      ) : null}
      <ul>
        {items.map((item, index) => (
          <ListRow key={`${index}:${String(item.label)}`} item={item} />
        ))}
      </ul>
    </div>
  )
}

type Cell = string | { text: string; url?: string; tone?: Tone }

/** For comparing across attributes. Numbers right-aligned, in tabular figures. */
export function Table({ node }: { node: SurfaceNode }) {
  const { data, placement } = useSurface()
  const columns = useItems(node, "columns", CATALOG.Table.props.columns)
  const raw = node.props.rows
  const rows = (
    Array.isArray(raw) ? raw : normalizeRowValues(resolve(raw, data))
  ) as Cell[][]
  const title = asText(node.props.title)
  const capped = placement === "desk" ? rows.slice(0, 8) : rows
  if (!columns.length || !rows.length) return null
  const align = (i: number) =>
    columns[i]?.align === "end" ? "text-right" : "text-left"
  return (
    <div className={`rounded-3xl p-2 ${blockFrame(placement)}`}>
      {title ? (
        <p className="px-3 pt-2 pb-1.5 text-[13px] text-kumo-subtle">{title}</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[15px] tabular-nums">
          <thead>
            <tr>
              {columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`px-3 py-2 text-[13px] font-normal whitespace-nowrap text-kumo-subtle ${align(i)} ${i === 0 ? "sticky left-0 bg-inherit" : ""}`}
                >
                  {String(column.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {capped.map((row, r) => (
              <tr key={r} className="sf-enter border-t border-kumo-line">
                {columns.map((_, i) => {
                  const cell = row[i] ?? ""
                  const text = typeof cell === "string" ? cell : cell.text
                  const url =
                    typeof cell === "string" ? undefined : safeUrl(cell.url)
                  const tone = typeof cell === "string" ? undefined : cell.tone
                  return (
                    <td
                      key={i}
                      className={`px-3 py-2 align-top ${align(i)} ${
                        tone && tone !== "neutral"
                          ? TONE_TEXT[tone]
                          : "text-kumo-default"
                      } ${columns[i]?.align === "end" ? "whitespace-nowrap" : "min-w-[6rem]"}`}
                    >
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline decoration-kumo-line underline-offset-4 hover:decoration-current"
                        >
                          {text}
                        </a>
                      ) : (
                        text
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {capped.length < rows.length ? (
        <p className="px-3 pt-1.5 pb-1 text-[13px] text-kumo-subtle">
          {rows.length - capped.length} more in the chat
        </p>
      ) : null}
    </div>
  )
}

/** One thing the user should not miss: a caveat, a warning, good news. */
export function Callout({ node }: { node: SurfaceNode }) {
  const { placement } = useSurface()
  const text = useText(node, "text")
  const title = asText(node.props.title)
  const tone = (node.props.tone as Tone | undefined) ?? "neutral"
  const Icon =
    tone === "good" ? CheckCircleIcon : tone === "warn" ? WarningIcon : InfoIcon
  if (!text && !title) return null
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl px-4 py-3 ${
        tone === "warn" ? "bg-kumo-warning-tint" : blockFrame(placement)
      }`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${TONE_TEXT[tone]}`} />
      <div className="min-w-0 text-[15px] text-pretty text-kumo-default">
        {title ? <p className="font-semibold">{title}</p> : null}
        {text ? <p>{text}</p> : null}
      </div>
    </div>
  )
}

export function Text({ node }: { node: SurfaceNode }) {
  const text = useText(node, "text")
  if (!text) return null
  const role = node.props.role
  return (
    <p
      className={`px-1 text-pretty ${
        role === "subtle"
          ? "text-[13px] text-kumo-subtle"
          : role === "label"
            ? "text-[13px] font-medium text-kumo-subtle"
            : "text-[15px] text-kumo-default"
      }`}
    >
      {keepHyphens(text)}
    </p>
  )
}

/** A bar for work under way. No value means "working on it". */
export function Progress({ node }: { node: SurfaceNode }) {
  const { data, placement } = useSurface()
  const label = asText(node.props.label) ?? ""
  const value = progressValue(resolve(node.props.value, data))
  const detail = asText(resolve(node.props.detail, data))
  const state = resolve(node.props.state, data)
  const done = state === "done" || value === 1
  const failed = state === "failed"
  return (
    <div className={`rounded-2xl px-4 py-3 ${blockFrame(placement)}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-[15px] text-pretty text-kumo-default">
          {label}
        </p>
        {value !== null && !failed ? (
          <p className="shrink-0 text-[13px] text-kumo-subtle tabular-nums">
            {Math.round(value * 100)}%
          </p>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-kumo-tint"
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-(--duration-slow) ease-(--ease-smooth-out) ${
            failed
              ? "bg-kumo-danger"
              : done
                ? "bg-kumo-success"
                : "bg-kumo-contrast"
          } ${value === null && !done && !failed ? "sf-indeterminate w-1/3" : ""}`}
          style={
            value !== null || done || failed
              ? { width: `${(done ? 1 : (value ?? 1)) * 100}%` }
              : undefined
          }
        />
      </div>
      {detail ? (
        <p
          className={`mt-1.5 text-[13px] text-pretty ${failed ? "text-kumo-danger" : "text-kumo-subtle"}`}
        >
          {detail}
        </p>
      ) : null}
    </div>
  )
}

function StepIcon({ state }: { state: string }) {
  switch (state) {
    case "done":
      return (
        <CheckCircleIcon size={18} className="sf-pop text-kumo-success" />
      )
    case "active":
      return <Loader size={16} />
    case "failed":
      return <XIcon size={18} className="text-kumo-danger" />
    case "skipped":
      return <MinusIcon size={18} className="text-kumo-subtle" />
    default:
      return (
        <span className="block size-[14px] rounded-full ring-[1.5px] ring-kumo-line ring-inset" />
      )
  }
}

/**
 * A checklist. The bot ticks through it, or with a tick event the user
 * does: tapping a step shows it ticked at once and tells the bot, whose
 * update then replaces the guess.
 */
export function Steps({ node }: { node: SurfaceNode }) {
  const { surface, placement, interactive, busy, press, error } = useSurface()
  const items = useItems(node, "items", CATALOG.Steps.props.items)
  const [ticked, setTicked] = useState<{
    index: number
    done: boolean
    version: number
  } | null>(null)
  if (!items.length) return null
  const tickable = !!node.props.tick && interactive
  const guess =
    ticked &&
    ticked.version === surface.version &&
    error?.target !== `${node.id}#${ticked.index}`
      ? ticked
      : null
  return (
    <ol className={`rounded-3xl p-2 ${blockFrame(placement)}`}>
      {items.map((item, index) => {
        const given = String(item.state ?? "pending")
        const state =
          guess?.index === index ? (guess.done ? "done" : "pending") : given
        const detail = asText(item.detail)
        const body = (
          <>
            <span
              key={state}
              className="flex size-5 shrink-0 items-center justify-center pt-0.5"
            >
              <StepIcon state={state} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-[15px] text-pretty ${
                  state === "pending" || state === "skipped"
                    ? "text-kumo-subtle"
                    : "text-kumo-default"
                } ${state === "skipped" ? "line-through" : ""}`}
              >
                {String(item.label)}
              </span>
              {detail ? (
                <span className="mt-0.5 block text-[13px] text-pretty text-kumo-subtle">
                  {detail}
                </span>
              ) : null}
            </span>
          </>
        )
        const row = `flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-start ${state === "active" ? "bg-(--fill-hover)" : ""}`
        return (
          <li key={`${index}:${String(item.label)}`}>
            {tickable ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={state === "done"}
                disabled={busy || guess !== null}
                onClick={() => {
                  setTicked({
                    index,
                    done: given !== "done",
                    version: surface.version,
                  })
                  press(`${node.id}#${index}`)
                }}
                className={`${row} pressable outline-none hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:cursor-default`}
              >
                {body}
              </button>
            ) : (
              <div className={row}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function Image({ node }: { node: SurfaceNode }) {
  const { data, readFile } = useSurface()
  const src = safeSrc(resolve(node.props.src, data))
  const remote = !!src && /^https:\/\//i.test(src)
  const file = useFileData(remote || !src ? undefined : readFile, src ?? "")
  const url = remote ? src : file.url
  const alt = asText(node.props.alt) ?? ""
  const caption = asText(node.props.caption)
  if (!src) return null
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl bg-kumo-tint ring-1 ring-kumo-line">
        {url ? (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="block max-h-[480px] w-full object-contain"
          />
        ) : (
          <div className="aspect-video" />
        )}
      </div>
      {caption ? (
        <figcaption className="mt-1.5 px-1 text-[13px] text-kumo-subtle">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
