/** Display rules the renderer applies, kept pure so they can be tested. */

import type { Tone } from "./types"

/**
 * The colour of a stat's value: the tone the bot gave it, or else its sign.
 * A change reads at a glance only if up and down look different.
 */
export function statTone(value: string | undefined, tone?: Tone): Tone {
  if (tone) return tone
  const text = value?.trim() ?? ""
  if (/^[-−–]\s*\d/.test(text)) return "warn"
  if (/^\+\s*\d/.test(text)) return "good"
  return "neutral"
}

/** One size for every value in a row of stats, small enough for the longest. */
export function statSize(values: (string | undefined)[]): "lg" | "md" | "sm" {
  const longest = Math.max(0, ...values.map((v) => v?.length ?? 0))
  return longest <= 8 ? "lg" : longest <= 12 ? "md" : "sm"
}

/** Keep "mid-market" on one line: hyphens inside words do not break. */
export function keepHyphens(text: string) {
  return text.replace(/(\w)-(\w)/g, "$1‑$2")
}

/** Text for a value of any type, or undefined when there is nothing to show. */
export function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

export function checkFieldValue(
  value: unknown,
  rules: { required?: boolean; kind?: string; max?: number }
): string | null {
  const empty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  if (empty) return rules.required ? "Required" : null
  if (typeof value !== "string") return null
  if (rules.max && value.length > rules.max) {
    return `At most ${rules.max} characters`
  }
  if (rules.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Not an email address"
  }
  if (rules.kind === "url" && !/^https?:\/\/\S+$/i.test(value)) {
    return "Not a link"
  }
  if (rules.kind === "number" && !Number.isFinite(Number(value))) {
    return "Not a number"
  }
  return null
}
