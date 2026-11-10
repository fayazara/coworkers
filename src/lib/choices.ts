/** One tappable answer on an ask_user card. */
export interface ChoiceOption {
  label: string
  /** Why this option is there: the evidence behind it, in one line. */
  detail?: string
}

/**
 * The options of an ask_user call. Older calls in a bot's history passed
 * plain strings; newer ones pass `{ label, detail }`.
 */
export function choiceOptions(input: unknown): ChoiceOption[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((option): ChoiceOption[] => {
    if (typeof option === "string") return option ? [{ label: option }] : []
    if (!option || typeof option !== "object") return []
    const { label, detail } = option as { label?: unknown; detail?: unknown }
    if (typeof label !== "string" || !label) return []
    return [
      typeof detail === "string" && detail.trim()
        ? { label, detail }
        : { label },
    ]
  })
}

/** The letter key shown beside an option: A, B, C… */
export function choiceKey(index: number) {
  return String.fromCharCode(65 + index)
}

/** Two MCP endpoints are the same connection, whatever the trailing slash. */
export function sameEndpoint(a: string, b: string) {
  const norm = (value: string) => {
    try {
      const url = new URL(value)
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`
    } catch {
      return value.trim()
    }
  }
  return norm(a) === norm(b)
}
