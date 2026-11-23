import { createContext, useContext } from "react"
import type { ReadFileData } from "@/components/capture-card"
import type { Placement, Surface } from "@/lib/surface/types"

export interface SurfaceContextValue {
  surface: Surface
  /** The surface's data with the user's unsent edits applied. */
  data: Record<string, unknown>
  placement: Placement
  /** Buttons and inputs work. False for a closed surface or a stale copy. */
  interactive: boolean
  /** `say` buttons work (the chat can take a message now). */
  canSay: boolean
  /** The bot is working: buttons wait, fields stay editable. */
  busy: boolean
  setField: (pointer: string, value: unknown) => void
  /** Field pointers the user changed. */
  edited: ReadonlySet<string>
  /** Press a button. Resolves when the press is handled. */
  press: (target: string) => void
  /** The button being handled, if any. */
  pending: string | null
  /** Why the last press failed. */
  error: { target: string; message: string } | null
  readFile?: ReadFileData
}

export const SurfaceContext = createContext<SurfaceContextValue | null>(null)

export function useSurface() {
  const value = useContext(SurfaceContext)
  if (!value) throw new Error("useSurface outside a surface")
  return value
}

/**
 * The look of a block on its own: data, not speech, so white on the page
 * with a hairline ring. On the Desk the card is already the frame, so
 * blocks sit on a soft tint instead of drawing a ring inside a ring.
 */
export function blockFrame(placement: Placement) {
  return placement === "desk"
    ? "bg-(--fill-hover)"
    : "bg-kumo-base ring-1 ring-kumo-line"
}
