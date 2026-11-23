/**
 * Surfaces in a thread. Every show_surface and update_surface result carries
 * the whole surface, so the newest copy of each is simply the one with the
 * highest version among the messages loaded. It is drawn in one place: where
 * it was last shown, or at its newest update when that message is not
 * loaded. Older placements give way to it.
 */

import type { UIMessage } from "ai"
import { normalizeData, normalizeLayout, cleanText } from "./normalize"
import type { Surface, SurfaceToolOutput } from "./types"

export interface ThreadSurface {
  surface: Surface
  /** The tool call where it is drawn. */
  anchor: string
}

interface ToolPartLike {
  type: string
  toolCallId?: string
  state?: string
  output?: unknown
}

export function latestSurfaces(
  messages: UIMessage[]
): Map<string, ThreadSurface> {
  const out = new Map<string, ThreadSurface>()
  const shownAt = new Map<string, string>()
  const updatedAt = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const part of message.parts) {
      const p = part as ToolPartLike
      const show = p.type === "tool-show_surface"
      if (!show && p.type !== "tool-update_surface") continue
      if (p.state !== "output-available" || !p.toolCallId) continue
      const output = p.output as SurfaceToolOutput | undefined
      if (!output?.ok) continue
      const { surface } = output
      if (show) shownAt.set(surface.id, p.toolCallId)
      else updatedAt.set(surface.id, p.toolCallId)
      const prev = out.get(surface.id)
      if (!prev || surface.version >= prev.surface.version) {
        out.set(surface.id, { surface, anchor: "" })
      }
    }
  }
  for (const [id, entry] of out) {
    entry.anchor = shownAt.get(id) ?? updatedAt.get(id) ?? ""
  }
  return out
}

/** A show_surface call still streaming in: drawn as far as it has got. */
export function draftSurface(input: Record<string, unknown>): Surface {
  const layout = normalizeLayout(input.layout).value
  const data = normalizeData(input.data).value
  const title = cleanText(input.title, 80)
  return {
    id: typeof input.id === "string" ? input.id : "draft",
    ...(title ? { title } : {}),
    ...layout,
    data,
    version: 0,
    status: "open",
    updatedAt: 0,
  }
}
