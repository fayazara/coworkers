/**
 * Writing surfaces: what show_surface and update_surface do to the stored
 * copy, the checks on a button press, and what the model reads back.
 */

import { LIMITS, componentSpec } from "./catalog"
import {
  SURFACE_ID,
  bindingsOf,
  cleanText,
  normalizeData,
  normalizeLayout,
} from "./normalize"
import {
  getAt,
  isBind,
  isPointer,
  progressValue,
  resolve,
  setAt,
} from "./pointer"
import type {
  Action,
  DeskPin,
  EventAction,
  Problem,
  Surface,
  SurfaceNode,
  SurfaceToolOutput,
} from "./types"

export interface ShowSurfaceInput {
  id?: unknown
  title?: unknown
  layout?: unknown
  data?: unknown
  desk?: unknown
}

export interface UpdateSurfaceInput {
  id?: unknown
  title?: unknown
  data?: unknown
  layout?: unknown
  close?: unknown
  desk?: unknown
}

const REJECTED =
  "Nothing was shown. Fix these problems and call the tool again."

function fail(problems: Problem[]): SurfaceToolOutput {
  return { ok: false, error: REJECTED, problems }
}

function unresolved(surface: Surface): Problem[] {
  return [...new Set(bindingsOf(surface))]
    .filter((pointer) => getAt(surface.data, pointer) === undefined)
    .map((pointer) => ({
      path: pointer,
      message: "Bound, but data has nothing there yet; it shows as empty.",
    }))
}

/** A bar and a checklist tracking the same work drift apart unless linked. */
function progressDrift(surface: Surface): Problem[] {
  const nodes = Object.values(surface.nodes)
  const steps = nodes.find((n) => n.type === "Steps" && !n.props.tick)
  if (!steps) return []
  return nodes
    .filter(
      (n) =>
        n.type === "Progress" &&
        n.props.value !== undefined &&
        !Array.isArray(resolve(n.props.value, surface.data))
    )
    .map((n) => ({
      path: `/nodes/${n.id}/value`,
      message: isBind(steps.props.items)
        ? `This bar will not move with the Steps. Bind value to the steps' items, { "$bind": "${steps.props.items.$bind}" }, and it counts the steps done.`
        : 'This bar will not move with the Steps. Put the steps in data, bind both Steps items and this value to that pointer, and the bar counts the steps done.',
    }))
}

function deskPin(raw: unknown, path: string, problems: Problem[]) {
  if (raw === undefined || raw === null || raw === false) return undefined
  const r = raw as { lane?: unknown; why?: unknown }
  const lane = r.lane === "done" ? "done" : "fyi"
  const why = cleanText(r.why, 140)
  if (!why) {
    problems.push({
      path: `${path}/why`,
      message: "A Desk pin needs why: one line on why it is there.",
    })
    return undefined
  }
  return { lane, why } satisfies DeskPin
}

/** A readable id from the title, for surfaces the bot did not name. */
export function surfaceIdFrom(title: string | undefined, taken: Set<string>) {
  const base =
    (title ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "surface"
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * show_surface: a new surface, or a replacement for the one with this id.
 * Pass the stored copy as `prev` when the id exists.
 */
export function showSurface(
  input: ShowSurfaceInput,
  prev: Surface | undefined,
  taken: Set<string>,
  now = Date.now()
): SurfaceToolOutput {
  const problems: Problem[] = []
  const title = cleanText(input.title, 80)
  let id: string
  if (input.id === undefined || input.id === null || input.id === "") {
    id = surfaceIdFrom(title, taken)
  } else if (typeof input.id === "string" && SURFACE_ID.test(input.id)) {
    id = input.id
  } else {
    return fail([
      {
        path: "/id",
        message:
          'Ids are lowercase letters, digits and -, like "macbook-watch".',
      },
    ])
  }
  const layout = normalizeLayout(input.layout)
  const data = normalizeData(input.data)
  const desk = deskPin(input.desk, "/desk", problems)
  if (desk && !title) {
    problems.push({ path: "/title", message: "A Desk pin needs a title." })
  }
  problems.push(...layout.problems, ...data.problems)
  if (layout.value.root.length === 0 && !layout.problems.length) {
    problems.push({ path: "/layout", message: "layout has no components." })
  }
  if (problems.length) return fail(problems)
  const surface: Surface = {
    id,
    ...(title ? { title } : {}),
    ...layout.value,
    data: data.value,
    version: (prev?.version ?? 0) + 1,
    status: "open",
    updatedAt: now,
    ...(desk ? { desk } : prev?.desk ? { desk: prev.desk } : {}),
  }
  const warnings = [
    ...layout.warnings,
    ...data.warnings,
    ...unresolved(surface),
    ...progressDrift(surface),
  ]
  return { ok: true, surface, ...(warnings.length ? { warnings } : {}) }
}

/** update_surface: data patches, a new layout, a title, closing, pinning. */
export function updateSurface(
  input: UpdateSurfaceInput,
  prev: Surface,
  now = Date.now()
): SurfaceToolOutput {
  const problems: Problem[] = []
  const warnings: Problem[] = []
  if (prev.status === "closed") {
    return fail([
      {
        path: "/id",
        message: "That surface is closed. Show a new one with show_surface.",
      },
    ])
  }
  let next: Surface = { ...prev }
  if (input.title !== undefined) {
    const title = cleanText(input.title, 80)
    if (title) next.title = title
  }
  if (input.layout !== undefined) {
    const layout = normalizeLayout(input.layout)
    problems.push(...layout.problems)
    warnings.push(...layout.warnings)
    next = { ...next, ...layout.value }
  }
  if (input.data !== undefined) {
    if (!Array.isArray(input.data)) {
      problems.push({
        path: "/data",
        message:
          'data is a list of changes: [{ "path": "/price", "value": "₹90,000" }]. null deletes.',
      })
    } else {
      let data = next.data
      input.data.forEach((change, i) => {
        const c = change as { path?: unknown; value?: unknown } | null
        if (!c || !isPointer(c.path)) {
          problems.push({
            path: `/data/${i}/path`,
            message: 'Each change has a JSON Pointer path, like "/price".',
          })
          return
        }
        const updated = setAt(data, c.path, c.value === undefined ? null : c.value)
        if (!updated) {
          problems.push({
            path: `/data/${i}/path`,
            message: `"${c.path}" runs through something that is not an object or list.`,
          })
          return
        }
        data = updated
      })
      const checked = normalizeData(data)
      problems.push(...checked.problems)
      next.data = checked.value
    }
  }
  if (input.desk !== undefined) {
    if (input.desk === false || input.desk === null) delete next.desk
    else {
      const desk = deskPin(input.desk, "/desk", problems)
      if (desk) next.desk = desk
      if (desk && !next.title) {
        problems.push({ path: "/title", message: "A Desk pin needs a title." })
      }
    }
  }
  if (input.close === true) next.status = "closed"
  if (problems.length) return fail(problems)
  next.version = prev.version + 1
  next.updatedAt = now
  warnings.push(...unresolved(next), ...progressDrift(next))
  return { ok: true, surface: next, ...(warnings.length ? { warnings } : {}) }
}

/** What the model reads back from a surface tool: short, never the payload. */
export function surfaceForModel(output: SurfaceToolOutput): string {
  if (!output.ok) {
    return [
      output.error,
      ...output.problems.map((p) => `- ${p.path}: ${p.message}`),
    ].join("\n")
  }
  const { surface, warnings } = output
  const lines = [
    `Surface "${surface.id}" is ${surface.status === "closed" ? "closed" : "on screen"} (version ${surface.version}${surface.desk ? ", pinned to the Desk" : ""}).`,
    surface.status === "closed"
      ? "It stays visible, read-only."
      : `The user can see it now. Do not repeat it or add a closing message in text: if your work is done, end your turn here. To change it later, call update_surface with id "${surface.id}".`,
  ]
  if (warnings?.length) {
    lines.push(
      "Warnings (shown anyway):",
      ...warnings.map((w) => `- ${w.path}: ${w.message}`)
    )
  }
  return lines.join("\n")
}

/** One line per open surface, for prompts and list_surfaces. */
export function surfaceLine(surface: Surface): string {
  const fields = Object.values(surface.nodes)
    .map((n) => n.props.field)
    .filter((f): f is string => typeof f === "string")
  const types = [...new Set(Object.values(surface.nodes).map((n) => n.type))]
  return [
    `- ${surface.id}${surface.title ? `: ${surface.title}` : ""}`,
    `(${types.join(", ")}`,
    `${surface.desk ? "; on the Desk" : ""}`,
    `; updated ${new Date(surface.updatedAt).toISOString().slice(0, 16)}Z)`,
    fields.length ? ` fields ${fields.join(", ")}` : "",
    ` data keys: ${Object.keys(surface.data).join(", ") || "none"}`,
  ].join("")
}

/**
 * The button a press names. Targets are `<nodeId>#<index>` for Actions
 * items and Steps, and `<nodeId>#submit` / `<nodeId>#secondary` for a Form.
 * A step's tick carries its own values: which step, and which way.
 */
export function actionAt(
  surface: Surface,
  target: string
): {
  label: string
  action: Action
  values?: Record<string, unknown>
} | null {
  const [nodeId, which] = target.split("#")
  const node = surface.nodes[nodeId]
  if (!node || which === undefined) return null
  if (node.type === "Steps" && /^\d+$/.test(which)) {
    const tick = node.props.tick as EventAction | undefined
    const items = resolve(node.props.items, surface.data)
    const step = Number(which)
    const item = Array.isArray(items) ? items[step] : undefined
    const label =
      item && typeof item === "object"
        ? cleanText((item as Record<string, unknown>).label, LIMITS.label)
        : undefined
    if (!tick || !label) return null
    const done = (item as Record<string, unknown>).state !== "done"
    return {
      label: `${done ? "Ticked" : "Unticked"} ${label}`,
      action: tick,
      values: { step, label, done },
    }
  }
  if (node.type === "Actions" && /^\d+$/.test(which)) {
    const item = (node.props.items as Record<string, unknown>[] | undefined)?.[
      Number(which)
    ]
    return item?.action && typeof item.label === "string"
      ? { label: item.label, action: item.action as Action }
      : null
  }
  if (node.type === "Form" && (which === "submit" || which === "secondary")) {
    const button = node.props[which] as
      | { label?: string; action?: Action }
      | undefined
    return button?.action && button.label
      ? { label: button.label, action: button.action }
      : null
  }
  return null
}

/** The input that writes to a field. */
export function inputFor(
  surface: Surface,
  pointer: string
): SurfaceNode | undefined {
  return Object.values(surface.nodes).find((n) => n.props.field === pointer)
}

/**
 * The values a press sends, checked against the inputs that own them. The
 * client checks first; this is the boundary.
 */
export function checkActionValues(
  surface: Surface,
  action: EventAction,
  values: unknown
): { values: Record<string, unknown> } | { error: string } {
  const given =
    values && typeof values === "object" && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {}
  for (const key of Object.keys(given)) {
    if (!action.fields.includes(key)) {
      return { error: `That button does not send ${key}.` }
    }
  }
  let out: Record<string, unknown> = {}
  for (const pointer of action.fields) {
    const node = inputFor(surface, pointer)
    const spec = node ? componentSpec(node.type) : undefined
    const raw = given[pointer]
    let value: unknown
    switch (spec?.value) {
      case "text": {
        const max = Math.min(
          typeof node?.props.max === "number" ? node.props.max : LIMITS.fieldText,
          LIMITS.fieldText
        )
        value = typeof raw === "string" ? raw.slice(0, max) : ""
        break
      }
      case "bool":
        value = raw === true
        break
      case "date":
        value =
          typeof raw === "string" &&
          /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(raw)
            ? raw
            : ""
        break
      case "choice": {
        const options = resolve(node?.props.options, surface.data)
        const allowed = Array.isArray(options)
          ? new Set(options.map((o) => (o as { value?: unknown }).value))
          : null
        const pick = (v: unknown) =>
          typeof v === "string" && (!allowed || allowed.has(v))
        value = node?.props.multiple
          ? Array.isArray(raw)
            ? raw.filter(pick)
            : []
          : pick(raw)
            ? raw
            : ""
        break
      }
      default:
        // A field no input owns: send what the surface's data holds.
        value = getAt(surface.data, pointer) ?? null
    }
    if (node?.props.required === true) {
      const empty =
        value === "" ||
        value === null ||
        (Array.isArray(value) && value.length === 0)
      if (empty) {
        return {
          error: `${String(node.props.label ?? pointer)} is required.`,
        }
      }
    }
    out = setAt(out, pointer, value) ?? out
  }
  return { values: out }
}


/** A surface showing the bot's own work still under way. */
export function showsWorkUnderway(surface: Surface): boolean {
  return Object.values(surface.nodes).some((node) => {
    if (node.type === "Progress") {
      const state = resolve(node.props.state, surface.data)
      const value = progressValue(resolve(node.props.value, surface.data))
      return state !== "done" && state !== "failed" && value !== 1
    }
    // A checklist the user ticks is theirs; its active step is not the bot's.
    if (node.type === "Steps" && !node.props.tick) {
      const items = resolve(node.props.items, surface.data)
      return (
        Array.isArray(items) &&
        items.some(
          (item) =>
            !!item &&
            typeof item === "object" &&
            (item as Record<string, unknown>).state === "active"
        )
      )
    }
    return false
  })
}

interface StepLike {
  toolCalls: readonly { toolName: string }[]
  toolResults: readonly { toolName: string; output?: unknown }[]
}

/**
 * Whether a step ends the turn: it only wrote surfaces, every write landed,
 * and none shows work still going. The surface is then the reply, so there
 * is nothing to say after it. A rejected write goes back for a fix, and a
 * surface tracking work lets the bot carry on with it.
 */
export function surfaceEndsStep(step: StepLike | undefined): boolean {
  if (!step) return false
  const writes = new Set(["show_surface", "update_surface"])
  // Bookkeeping a bot does alongside its answer, like naming itself on its
  // first job, does not need another step.
  const quiet = new Set(["set_name"])
  if (!step.toolCalls.some((call) => writes.has(call.toolName))) return false
  if (!step.toolCalls.every((c) => writes.has(c.toolName) || quiet.has(c.toolName))) {
    return false
  }
  if (step.toolResults.length !== step.toolCalls.length) return false
  return step.toolResults
    .filter((result) => writes.has(result.toolName))
    .every((result) => {
      const output = result.output as SurfaceToolOutput | undefined
      return (
        output?.ok === true &&
        (output.surface.status === "closed" || !showsWorkUnderway(output.surface))
      )
    })
}
