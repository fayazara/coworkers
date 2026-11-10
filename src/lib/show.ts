/**
 * Blocks a bot can show in a reply instead of plain text (the `show` tool).
 * One flat shape for every block, so any model can write it: the `type`
 * decides which fields are read.
 */

export const SHOW_BLOCK_TYPES = ["stats", "list", "callout", "actions"] as const
export type ShowBlockType = (typeof SHOW_BLOCK_TYPES)[number]

export const SHOW_TONES = ["neutral", "good", "warn"] as const
export type ShowTone = (typeof SHOW_TONES)[number]

export const MAX_SHOW_BLOCKS = 6
export const MAX_SHOW_ITEMS = 12

export interface ShowItem {
  label: string
  value?: string
  detail?: string
  url?: string
  tag?: string
  tone?: ShowTone
}

export interface ShowBlock {
  type: ShowBlockType
  title?: string
  /** A callout's body. */
  text?: string
  tone?: ShowTone
  items: ShowItem[]
}

/**
 * The colour of a stat's value: the tone the bot gave it, or else its sign.
 * A change reads at a glance only if up and down look different.
 */
export function statTone(item: ShowItem): ShowTone {
  if (item.tone) return item.tone
  const value = item.value?.trim() ?? ""
  if (/^[-−–]\s*\d/.test(value)) return "warn"
  if (/^\+\s*\d/.test(value)) return "good"
  return "neutral"
}

/** One size for every value in a row of stats, small enough for the longest. */
export function statSize(items: ShowItem[]): "lg" | "md" | "sm" {
  const longest = Math.max(0, ...items.map((i) => i.value?.length ?? 0))
  return longest <= 8 ? "lg" : longest <= 12 ? "md" : "sm"
}

/** Keep "mid-market" on one line: hyphens inside words do not break. */
export function keepHyphens(text: string) {
  return text.replace(/(\w)-(\w)/g, "$1\u2011$2")
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function tone(value: unknown): ShowTone | undefined {
  return SHOW_TONES.find((t) => t === value)
}

/** Only links a person can safely open. */
function link(value: unknown): string | undefined {
  const url = text(value)
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * The blocks of a `show` call, for rendering. Reads whatever is there and
 * drops the rest, so a call that is still streaming in renders as far as it
 * has got, and a block the model got wrong never breaks the thread.
 */
export function showBlocks(input: unknown): ShowBlock[] {
  if (!Array.isArray(input)) return []
  const blocks: ShowBlock[] = []
  for (const raw of input.slice(0, MAX_SHOW_BLOCKS)) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Record<string, unknown>
    const type = SHOW_BLOCK_TYPES.find((t) => t === record.type)
    if (!type) continue
    const items: ShowItem[] = []
    if (Array.isArray(record.items)) {
      for (const item of record.items.slice(0, MAX_SHOW_ITEMS)) {
        if (!item || typeof item !== "object") continue
        const i = item as Record<string, unknown>
        const label = text(i.label)
        if (!label) continue
        items.push({
          label,
          value: text(i.value),
          detail: text(i.detail),
          url: link(i.url),
          tag: text(i.tag),
          tone: tone(i.tone),
        })
      }
    }
    const block: ShowBlock = {
      type,
      title: text(record.title),
      text: text(record.text),
      tone: tone(record.tone),
      items,
    }
    // Nothing to draw yet (or ever): a callout needs words, the rest items.
    if (type === "callout" ? !block.text && !block.title : items.length === 0) {
      continue
    }
    blocks.push(block)
  }
  return blocks
}
