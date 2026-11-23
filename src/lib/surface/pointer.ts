/** JSON Pointer (RFC 6901) reads and immutable writes over surface data. */

const POINTER = /^(\/[^/]*)+$/
/** Keys that would reach Object.prototype when written. */
const UNSAFE = new Set(["__proto__", "prototype", "constructor"])

export function isPointer(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 200) return false
  if (!POINTER.test(value)) return false
  return parsePointer(value).every((t) => !UNSAFE.has(t))
}

export function parsePointer(pointer: string): string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
}

function child(value: unknown, token: string): unknown {
  if (Array.isArray(value)) {
    if (!/^(0|[1-9]\d*)$/.test(token)) return undefined
    return value[Number(token)]
  }
  if (value && typeof value === "object") {
    return Object.hasOwn(value, token)
      ? (value as Record<string, unknown>)[token]
      : undefined
  }
  return undefined
}

export function getAt(data: unknown, pointer: string): unknown {
  let value = data
  for (const token of parsePointer(pointer)) {
    value = child(value, token)
    if (value === undefined) return undefined
  }
  return value
}

/**
 * A copy of `data` with `value` at `pointer`, creating objects on the way.
 * `null` deletes. Returns null when the path runs through a non-container
 * (a string, a number) or past the end of an array.
 */
export function setAt(
  data: Record<string, unknown>,
  pointer: string,
  value: unknown
): Record<string, unknown> | null {
  // Callers check pointers too; this is the last line, so it checks again.
  if (!isPointer(pointer)) return null
  const tokens = parsePointer(pointer)
  const write = (node: unknown, index: number): unknown => {
    const token = tokens[index]
    const last = index === tokens.length - 1
    if (Array.isArray(node)) {
      const at = token === "-" ? node.length : Number(token)
      if (!/^(0|[1-9]\d*|-)$/.test(token) || at > node.length) {
        throw new Error("bad index")
      }
      const copy = node.slice()
      if (last) {
        if (value === null) copy.splice(at, 1)
        else copy[at] = value
      } else copy[at] = write(copy[at] ?? {}, index + 1)
      return copy
    }
    if (node === undefined || node === null) node = {}
    if (typeof node !== "object") throw new Error("not a container")
    const copy: Record<string, unknown> = { ...(node as object) }
    if (last) {
      if (value === null) delete copy[token]
      else copy[token] = value
    } else copy[token] = write(copy[token], index + 1)
    return copy
  }
  try {
    return write(data, 0) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isBind(value: unknown): value is { $bind: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { $bind?: unknown }).$bind === "string"
  )
}

/** A prop's value: the literal, or what its binding points at. */
export function resolve(value: unknown, data: unknown): unknown {
  return isBind(value) ? getAt(data, value.$bind) : value
}

/**
 * A Progress bound to a list of steps reads as the share of them done, so a
 * bar beside a Steps moves with it and never needs updating on its own.
 */
export function progressValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value))
  }
  if (!Array.isArray(value) || value.length === 0) return null
  const settled = value.filter((item) => {
    const state = (item as { state?: unknown } | null)?.state
    return state === "done" || state === "skipped"
  }).length
  return settled / value.length
}
