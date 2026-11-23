/**
 * Surfaces: UI a bot shows, described as components from a fixed catalog and
 * the data they display. Shared by the bot (validation, storage) and the
 * client (rendering). No server-only imports. Spec: specs/surfaces.md.
 */

export const TONES = ["neutral", "good", "warn"] as const
export type Tone = (typeof TONES)[number]

/** Where a surface is drawn. Components adapt; the bot never picks this. */
export type Placement = "thread" | "desk" | "sheet"

/** A prop value read from the surface's data (JSON Pointer, RFC 6901). */
export interface Bind {
  $bind: string
}

export type SayAction = { say: string }
export type EventAction = { event: string; fields: string[]; confirm?: string }
export type LinkAction = { link: string }
export type Action = SayAction | EventAction | LinkAction

/** One component after normalizing: flat, with its children as ids. */
export interface SurfaceNode {
  id: string
  type: string
  /** Props the catalog knows, cleaned. Bindable ones may be a `Bind`. */
  props: Record<string, unknown>
  children?: string[]
}

export interface SurfaceLayout {
  /** Top-level node ids, drawn top to bottom. */
  root: string[]
  nodes: Record<string, SurfaceNode>
}

/** A surface as stored and sent to clients. */
export interface Surface extends SurfaceLayout {
  id: string
  title?: string
  data: Record<string, unknown>
  version: number
  status: "open" | "closed"
  updatedAt: number
  /** Pinned to the Desk. */
  desk?: DeskPin
}

export interface DeskPin {
  lane: "fyi" | "done"
  why: string
}

/** Something wrong with what the bot wrote, at a JSON Pointer into its input. */
export interface Problem {
  path: string
  message: string
}

/**
 * What show_surface and update_surface return. The client renders `surface`;
 * the model only sees a short summary (see `surfaceForModel`).
 */
export type SurfaceToolOutput =
  | { ok: true; surface: Surface; warnings?: Problem[] }
  | { ok: false; error: string; problems: Problem[] }

/** Stamped on the user message a surface's button started. */
export interface SurfaceActionMeta {
  surfaceId: string
  title?: string
  /** The button's label, shown as what the user said. */
  label: string
  event: string
}
