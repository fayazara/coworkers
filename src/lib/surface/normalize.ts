/**
 * Turning what a model wrote into a surface layout.
 *
 * One pass serves both sides. The client draws whatever is valid so far
 * (input streams in partially, so a half-written node is simply skipped).
 * The server rejects the write when there are problems, and hands them back
 * to the model with a path and a fix, so the next try is right.
 */

import { LIMITS, SUGGEST, componentSpec } from "./catalog"
import type { ComponentSpec, PropSpec } from "./catalog"
import { isBind, isPointer } from "./pointer"
import { TONES } from "./types"
import type { Problem, SurfaceLayout, SurfaceNode } from "./types"

export interface Normalized<T> {
  value: T
  /** Reject the write: the model must fix these. */
  problems: Problem[]
  /** Kept going without them; reported back so the model learns. */
  warnings: Problem[]
}

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/
export const SURFACE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const EVENT_NAME = /^[a-z][a-z0-9_]{0,31}$/
/** A path in the bot's files: no scheme, no climbing out. */
const FILE_PATH = /^[\w][\w./ -]*$/

type Ctx = { problems: Problem[]; warnings: Problem[] }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function bindOf(raw: unknown, path: string, allowed: boolean, ctx: Ctx) {
  if (!isBind(raw)) return undefined
  if (!allowed) {
    ctx.warnings.push({ path, message: "This prop cannot be bound; dropped." })
    return null
  }
  if (!isPointer(raw.$bind)) {
    ctx.problems.push({
      path,
      message: `"${raw.$bind}" is not a JSON Pointer. Write it like "/price" or "/items/0/name".`,
    })
    return null
  }
  return { $bind: raw.$bind }
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const url = value.trim()
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    new URL(url)
    return url
  } catch {
    return undefined
  }
}

export function safeSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const src = value.trim()
  if (/^https:\/\//i.test(src)) return safeUrl(src)
  const path = src.replace(/^\/+/, "")
  if (!path || path.includes("..") || !FILE_PATH.test(path)) return undefined
  return path
}

/** Plain text for display: trimmed, capped, never empty. */
export function cleanText(value: unknown, max: number): string | undefined {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : undefined
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function normalizeAction(
  raw: unknown,
  spec: Extract<PropSpec, { kind: "action" }>,
  path: string,
  ctx: Ctx
) {
  // Where only an event fits, a bare name can mean nothing else.
  if (typeof raw === "string" && spec.only?.length === 1 && spec.only[0] === "event") {
    ctx.warnings.push({
      path,
      message: `An action is an object; read "${raw}" as { "event": "${raw}" }.`,
    })
    return normalizeAction({ event: raw }, spec, path, ctx)
  }
  const r = record(raw)
  if (!r) {
    ctx.problems.push({
      path,
      message:
        'An action is an object with one of "say", "event" or "link", like { "event": "send_reply" }.',
    })
    return undefined
  }
  const kinds = (["say", "event", "link"] as const).filter((k) => k in r)
  if (kinds.length !== 1) {
    ctx.problems.push({
      path,
      message:
        'An action has exactly one of "say" (text sent as the user), "event" (sent to you with field values) or "link" (opens a URL).',
    })
    return undefined
  }
  const kind = kinds[0]
  if (spec.only && !spec.only.includes(kind)) {
    ctx.problems.push({
      path,
      message: `Use ${spec.only.map((k) => `"${k}"`).join(" or ")} here.`,
    })
    return undefined
  }
  if (kind === "say") {
    const say = cleanText(r.say, 200)
    // Sent as it is, the moment it is pressed: no room to finish it.
    if (say && /[:…]$|\.\.\.$/.test(say)) {
      ctx.problems.push({
        path: `${path}/say`,
        message:
          "A say action is sent as written the moment it is pressed, so it must be a whole message. For something the user types, use a TextField in a Form.",
      })
      return undefined
    }
    return say ? { say } : undefined
  }
  if (kind === "link") {
    const link = safeUrl(r.link)
    if (!link) {
      ctx.problems.push({
        path: `${path}/link`,
        message: "Links must be full https:// URLs.",
      })
      return undefined
    }
    return { link }
  }
  const event = typeof r.event === "string" ? r.event.trim() : ""
  if (!EVENT_NAME.test(event)) {
    ctx.problems.push({
      path: `${path}/event`,
      message:
        'Event names are lowercase words joined by _, like "send_reply".',
    })
    return undefined
  }
  const action: {
    event: string
    fields?: string[]
    confirm?: string
  } = { event }
  if (Array.isArray(r.fields)) {
    action.fields = r.fields.filter((f, i) => {
      if (isPointer(f)) return true
      ctx.warnings.push({
        path: `${path}/fields/${i}`,
        message: "Not a JSON Pointer; dropped.",
      })
      return false
    }) as string[]
  }
  const confirm = cleanText(r.confirm, 160)
  if (confirm) action.confirm = confirm
  return action
}

function normalizeRows(
  raw: unknown,
  spec: Extract<PropSpec, { kind: "rows" }>,
  path: string,
  ctx: Ctx
) {
  const bound = bindOf(raw, path, true, ctx)
  if (bound !== undefined) return bound ?? undefined
  if (!Array.isArray(raw)) return undefined
  if (raw.length > spec.max) {
    ctx.warnings.push({
      path,
      message: `Only the first ${spec.max} rows are shown.`,
    })
  }
  return normalizeRowValues(raw.slice(0, spec.max))
}

/** Table rows from a literal or from data: cells as strings or { text, url, tone }. */
export function normalizeRowValues(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => {
    if (!Array.isArray(row)) return []
    const cells = row.slice(0, 6).map((cell) => {
      const r = record(cell)
      if (!r) return cleanText(cell, LIMITS.label) ?? ""
      const text = cleanText(r.text, LIMITS.label) ?? ""
      const url = safeUrl(r.url)
      const tone = TONES.find((t) => t === r.tone)
      return { text, ...(url ? { url } : {}), ...(tone ? { tone } : {}) }
    })
    return cells.length ? [cells] : []
  })
}

function normalizeProps(
  raw: Record<string, unknown>,
  specs: Record<string, PropSpec>,
  path: string,
  ctx: Ctx,
  known: Set<string> = new Set()
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  let ok = true
  for (const [key, spec] of Object.entries(specs)) {
    const before = ctx.problems.length
    const value = normalizeProp(raw[key], spec, `${path}/${key}`, ctx)
    if (value === undefined) {
      if ("required" in spec && spec.required) {
        ok = false
        // The prop already said what is wrong with it.
        if (ctx.problems.length > before) continue
        ctx.problems.push({
          path: `${path}/${key}`,
          message: `"${key}" is required.`,
        })
        ok = false
      }
      continue
    }
    out[key] = value
  }
  for (const key of Object.keys(raw)) {
    if (!(key in specs) && !known.has(key)) {
      ctx.warnings.push({
        path: `${path}/${key}`,
        message: `Unknown prop "${key}"; dropped.`,
      })
    }
  }
  return ok ? out : null
}

function normalizeProp(
  raw: unknown,
  spec: PropSpec,
  path: string,
  ctx: Ctx
): unknown {
  if (raw === undefined || raw === null) return undefined
  switch (spec.kind) {
    case "text": {
      const bound = bindOf(raw, path, !!spec.bind, ctx)
      if (bound !== undefined) return bound ?? undefined
      const text = cleanText(raw, spec.max)
      if (typeof raw === "string" && raw.trim().length > spec.max) {
        ctx.warnings.push({
          path,
          message: `Longer than ${spec.max} characters; cut.`,
        })
      }
      return text
    }
    case "number": {
      const bound = bindOf(raw, path, !!spec.bind, ctx)
      if (bound !== undefined) return bound ?? undefined
      const n = typeof raw === "string" ? Number(raw) : raw
      if (typeof n !== "number" || !Number.isFinite(n)) return undefined
      return Math.min(spec.max ?? n, Math.max(spec.min ?? n, n))
    }
    case "bool":
      return raw === true || raw === "true"
        ? true
        : raw === false || raw === "false"
          ? false
          : undefined
    case "enum": {
      const bound = bindOf(raw, path, !!spec.bind, ctx)
      if (bound !== undefined) return bound ?? undefined
      const value = spec.values.find((v) => v === raw)
      if (!value) {
        ctx.warnings.push({
          path,
          message: `Use one of ${spec.values.join(", ")}; dropped.`,
        })
      }
      return value
    }
    case "url": {
      const bound = bindOf(raw, path, !!spec.bind, ctx)
      if (bound !== undefined) return bound ?? undefined
      const url = safeUrl(raw)
      if (!url) {
        ctx.warnings.push({
          path,
          message: "Not an http(s) link; dropped.",
        })
      }
      return url
    }
    case "src": {
      const bound = bindOf(raw, path, !!spec.bind, ctx)
      if (bound !== undefined) return bound ?? undefined
      const src = safeSrc(raw)
      if (!src) {
        ctx.warnings.push({
          path,
          message: "Use an https image URL or a path in your files; dropped.",
        })
      }
      return src
    }
    case "field": {
      if (isPointer(raw)) return raw
      // A bare name ("subject", "reply.subject") is a slip with one meaning.
      if (typeof raw === "string" && /^[A-Za-z_][\w-]*(\.[\w-]+)*$/.test(raw)) {
        const pointer = `/${raw.split(".").join("/")}`
        if (isPointer(pointer)) {
          ctx.warnings.push({
            path,
            message: `A field is a JSON Pointer; read "${raw}" as "${pointer}".`,
          })
          return pointer
        }
      }
      ctx.problems.push({
        path,
        message:
          'A field is a JSON Pointer into data where the value is kept, like "/reply/subject".',
      })
      return undefined
    }
    case "action":
      return normalizeAction(raw, spec, path, ctx)
    case "rows":
      return normalizeRows(raw, spec, path, ctx)
    case "object": {
      const r = record(raw)
      if (!r) return undefined
      return normalizeProps(r, spec.props, path, ctx) ?? undefined
    }
    case "items": {
      const bound = bindOf(raw, path, true, ctx)
      if (bound !== undefined) return bound ?? undefined
      if (!Array.isArray(raw)) return undefined
      if (raw.length > spec.max) {
        ctx.warnings.push({
          path,
          message: `At most ${spec.max} items; the rest are dropped.`,
        })
      }
      const items: Record<string, unknown>[] = []
      raw.slice(0, spec.max).forEach((item, i) => {
        const r = record(item)
        if (!r) return
        const value = normalizeProps(r, spec.item, `${path}/${i}`, ctx)
        if (value) items.push(value)
      })
      if (items.length < spec.min) {
        ctx.problems.push({
          path,
          message: `Needs at least ${spec.min} item${spec.min === 1 ? "" : "s"}.`,
        })
        return items.length ? items : undefined
      }
      return items
    }
  }
}

/**
 * Items bound to data, cleaned with the item's spec the same way literal
 * items are. Used when rendering, since data can change after the write.
 */
export function normalizeItemValues(
  raw: unknown,
  spec: Extract<PropSpec, { kind: "items" }>
): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  const ctx: Ctx = { problems: [], warnings: [] }
  return raw.slice(0, spec.max).flatMap((item) => {
    const r = record(item)
    if (!r) return []
    const value = normalizeProps(r, spec.item, "", ctx)
    return value ? [value] : []
  })
}

function suggestion(type: string) {
  const near = SUGGEST[type]
  return near ? ` Use ${near}.` : ""
}

/** Every field an input under these nodes writes to, in order. */
export function fieldsUnder(
  ids: string[],
  nodes: Record<string, SurfaceNode>
): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const node = nodes[id]
    if (!node) return
    const field = node.props.field
    if (typeof field === "string") out.push(field)
    node.children?.forEach(walk)
  }
  ids.forEach(walk)
  return out
}

/**
 * Event actions that name no fields send every field of the form they are
 * in, or none outside one.
 */
function fillEventFields(layout: SurfaceLayout) {
  const fill = (action: unknown, fields: string[]) => {
    const a = record(action)
    if (a && typeof a.event === "string" && !Array.isArray(a.fields)) {
      a.fields = fields
    }
  }
  const walk = (id: string, formFields: string[]) => {
    const node = layout.nodes[id]
    if (!node) return
    let fields = formFields
    if (node.type === "Form") {
      fields = fieldsUnder(node.children ?? [], layout.nodes)
      fill(record(node.props.submit)?.action, fields)
      fill(record(node.props.secondary)?.action, fields)
    }
    // A tick sends which step, not the form around it.
    if (node.type === "Steps") fill(node.props.tick, [])
    if (node.type === "Actions" && Array.isArray(node.props.items)) {
      for (const item of node.props.items) fill(record(item)?.action, fields)
    }
    node.children?.forEach((child) => walk(child, fields))
  }
  layout.root.forEach((id) => walk(id, []))
}

export function normalizeLayout(input: unknown): Normalized<SurfaceLayout> {
  const ctx: Ctx = { problems: [], warnings: [] }
  const layout: SurfaceLayout = { root: [], nodes: {} }
  if (!Array.isArray(input)) {
    if (input !== undefined) {
      ctx.problems.push({
        path: "/layout",
        message: "layout is a list of components.",
      })
    }
    return { value: layout, ...ctx }
  }
  const perType = new Map<string, number>()
  let count = 0
  let full = false

  const visit = (
    raw: unknown,
    path: string,
    depth: number,
    autoId: string
  ): string | null => {
    const r = record(raw)
    if (!r) return null
    const type = typeof r.type === "string" ? r.type : ""
    const spec: ComponentSpec | undefined = componentSpec(type)
    if (!spec) {
      // While streaming, the type may not have arrived yet.
      if (type) {
        ctx.problems.push({
          path: `${path}/type`,
          message: `Unknown component "${type}".${suggestion(type)}`,
        })
      }
      return null
    }
    if (count >= LIMITS.nodes) {
      if (!full) {
        ctx.problems.push({
          path,
          message: `A surface has at most ${LIMITS.nodes} components. Show less, or split it into two surfaces.`,
        })
        full = true
      }
      return null
    }
    if (depth > LIMITS.depth) {
      ctx.problems.push({
        path,
        message: `Nested too deep: at most ${LIMITS.depth} levels.`,
      })
      return null
    }
    const seen = perType.get(type) ?? 0
    if (spec.maxPerSurface && seen >= spec.maxPerSurface) {
      ctx.warnings.push({
        path,
        message: `At most ${spec.maxPerSurface} ${type} per surface; dropped.`,
      })
      return null
    }

    let id = autoId
    if (r.id !== undefined) {
      if (typeof r.id === "string" && NODE_ID.test(r.id)) id = r.id
      else {
        ctx.warnings.push({
          path: `${path}/id`,
          message: "Ids are lowercase letters, digits and -; replaced.",
        })
      }
    }
    if (layout.nodes[id]) {
      ctx.problems.push({
        path: `${path}/id`,
        message: `The id "${id}" is used twice.`,
      })
      return null
    }

    const props = normalizeProps(
      r,
      spec.props,
      path,
      ctx,
      new Set(["type", "id", "children"])
    )
    if (!props) return null
    count++
    perType.set(type, seen + 1)
    const node: SurfaceNode = { id, type, props }
    layout.nodes[id] = node

    if (spec.children) {
      const kids = Array.isArray(r.children) ? r.children : []
      if (kids.length > spec.children.max) {
        ctx.warnings.push({
          path: `${path}/children`,
          message: `${type} holds at most ${spec.children.max}; the rest are dropped.`,
        })
      }
      node.children = kids
        .slice(0, spec.children.max)
        .map((kid, i) =>
          visit(kid, `${path}/children/${i}`, depth + 1, `${id}-${i}`)
        )
        .filter((kid): kid is string => kid !== null)
      if (node.children.length < spec.children.min) {
        ctx.problems.push({
          path: `${path}/children`,
          message: `${type} needs ${spec.children.min === spec.children.max ? "exactly" : "at least"} ${spec.children.min} component${spec.children.min === 1 ? "" : "s"} in children.`,
        })
      }
    } else if (r.children !== undefined) {
      ctx.warnings.push({
        path: `${path}/children`,
        message: `${type} has no children; dropped.`,
      })
    }
    return id
  }

  input.forEach((raw, i) => {
    const id = visit(raw, `/layout/${i}`, 1, `n${i}`)
    if (id) layout.root.push(id)
  })
  fillEventFields(layout)
  if (JSON.stringify(layout).length > LIMITS.layoutBytes) {
    ctx.problems.push({
      path: "/layout",
      message: "The layout is too big. Put long lists in data and bind them.",
    })
  }
  return { value: layout, ...ctx }
}

/** Plain JSON data, within the size limit. */
export function normalizeData(
  input: unknown,
  path = "/data"
): Normalized<Record<string, unknown>> {
  const ctx: Ctx = { problems: [], warnings: [] }
  if (input === undefined) return { value: {}, ...ctx }
  const r = record(input)
  if (!r) {
    ctx.problems.push({ path, message: "data is a JSON object." })
    return { value: {}, ...ctx }
  }
  let json: string
  try {
    json = JSON.stringify(r)
  } catch {
    ctx.problems.push({ path, message: "data must be plain JSON." })
    return { value: {}, ...ctx }
  }
  if (json.length > LIMITS.dataBytes) {
    ctx.problems.push({
      path,
      message: `data is over ${LIMITS.dataBytes / 1024} KB. Show fewer items.`,
    })
  }
  return { value: JSON.parse(json) as Record<string, unknown>, ...ctx }
}

/** Every binding in a layout, with the path of the prop that holds it. */
export function bindingsOf(layout: SurfaceLayout): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (isBind(value)) out.push(value.$bind)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") {
      Object.values(value).forEach(walk)
    }
  }
  for (const node of Object.values(layout.nodes)) walk(node.props)
  return out
}
