import { Button } from "@cloudflare/kumo/components/button"
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  InfoIcon,
  ListBulletsIcon,
  WarningIcon,
} from "@/components/icons"
import { keepHyphens, showBlocks, statSize, statTone } from "@/lib/show"
import type { ShowBlock, ShowItem, ShowTone } from "@/lib/show"
import type { ToolCall } from "@/lib/message-parts"

const TONE_TEXT: Record<ShowTone, string> = {
  neutral: "text-kumo-subtle",
  good: "text-kumo-success",
  warn: "text-kumo-warning",
}

/** Blocks are data, not speech: white on the page, not a grey bubble. */
const SURFACE = "bg-kumo-base ring-1 ring-kumo-line"

const VALUE_SIZE = {
  lg: "text-[22px]",
  md: "text-[18px]",
  sm: "text-[16px]",
} as const

/** Two to four headline numbers, side by side, each value on one line. */
function Stats({ block }: { block: ShowBlock }) {
  const size = VALUE_SIZE[statSize(block.items)]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {block.items.map((item, index) => {
        const tone = statTone(item)
        return (
          <div
            key={index}
            className={`min-w-0 rounded-2xl px-4 py-3 ${SURFACE}`}
          >
            <p className="text-[13px] text-pretty text-kumo-subtle">
              {keepHyphens(item.label)}
            </p>
            <p
              className={`mt-0.5 leading-tight font-semibold text-balance tabular-nums ${size} ${
                tone === "neutral" ? "text-kumo-default" : TONE_TEXT[tone]
              }`}
            >
              {item.value ?? "-"}
            </p>
            {item.detail ? (
              <p className="mt-0.5 text-[13px] text-pretty text-kumo-subtle">
                {keepHyphens(item.detail)}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ListRow({ item }: { item: ShowItem }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] text-kumo-default">
          <span className="min-w-0 text-pretty">{item.label}</span>
          {item.url ? (
            <ArrowSquareOutIcon
              size={13}
              className="shrink-0 text-kumo-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          ) : null}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block text-[13px] text-pretty text-kumo-subtle">
            {keepHyphens(item.detail)}
          </span>
        ) : null}
      </span>
      {item.value || item.tag ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {item.value ? (
            <span className="text-[15px] font-medium text-kumo-default tabular-nums">
              {item.value}
            </span>
          ) : null}
          {item.tag ? (
            <span
              className={`rounded-full bg-kumo-tint px-2 py-0.5 text-xs ${TONE_TEXT[item.tone ?? "neutral"]}`}
            >
              {item.tag}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  )
  const className = "flex items-start gap-4 rounded-2xl px-3 py-2.5"
  return (
    <li>
      {item.url ? (
        <a
          href={item.url}
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
function List({ block }: { block: ShowBlock }) {
  return (
    <div className={`rounded-3xl p-2 ${SURFACE}`}>
      {block.title ? (
        <p className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[13px] text-kumo-subtle">
          <ListBulletsIcon size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{block.title}</span>
          <span className="shrink-0 tabular-nums">· {block.items.length}</span>
        </p>
      ) : null}
      <ul>
        {block.items.map((item, index) => (
          <ListRow key={index} item={item} />
        ))}
      </ul>
    </div>
  )
}

/** One thing the user should not miss: a caveat, a warning, good news. */
function Callout({ block }: { block: ShowBlock }) {
  const tone = block.tone ?? "neutral"
  const Icon =
    tone === "good" ? CheckCircleIcon : tone === "warn" ? WarningIcon : InfoIcon
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl px-4 py-3 ${
        tone === "warn" ? "bg-kumo-warning-tint" : SURFACE
      }`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${TONE_TEXT[tone]}`} />
      <div className="min-w-0 text-[15px] text-pretty text-kumo-default">
        {block.title ? <p className="font-semibold">{block.title}</p> : null}
        {block.text ? <p>{block.text}</p> : null}
      </div>
    </div>
  )
}

/** Next steps the user can take with one tap: each sends its label. */
function Actions({
  block,
  onPick,
}: {
  block: ShowBlock
  onPick?: (text: string) => void
}) {
  return (
    <div className="flex max-w-[85%] flex-wrap gap-2">
      {block.items.map((item, index) => (
        <Button
          key={index}
          variant="outline"
          className="rounded-full"
          disabled={!onPick}
          onClick={() => onPick?.(item.label)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * The newest offer of next steps in a turn, drawn after everything else in
 * it: buttons are the last thing to read, whatever order the bot wrote in.
 * Offers that were not taken go away with the next message.
 */
export function ShowActions({
  calls,
  onPick,
}: {
  calls: ToolCall[]
  onPick?: (text: string) => void
}) {
  if (!onPick) return null
  const block = calls
    .flatMap((call) => showBlocks(call.input.blocks))
    .findLast((b) => b.type === "actions")
  return block ? <Actions block={block} onPick={onPick} /> : null
}

/**
 * A `show` call: the reply as blocks instead of prose. Draws as the call
 * streams in, so a long list fills up row by row.
 */
export function ShowBlocks({ call }: { call: ToolCall }) {
  const blocks = showBlocks(call.input.blocks).filter(
    (b) => b.type !== "actions"
  )
  if (blocks.length === 0) return null
  return (
    // The same width and rhythm as the bot's bubbles (max 85%, gap-3), so a
    // reply of text and blocks lines up on both edges.
    <div className="flex w-full max-w-[85%] flex-col gap-3">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "stats":
            return <Stats key={index} block={block} />
          case "list":
            return <List key={index} block={block} />
          case "callout":
            return <Callout key={index} block={block} />
          case "actions":
            // Drawn by ShowActions at the end of the turn instead.
            return null
        }
      })}
    </div>
  )
}
