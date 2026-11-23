import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReadFileData } from "@/components/capture-card"
import { getAt, setAt } from "@/lib/surface/pointer"
import { actionAt } from "@/lib/surface/surface"
import type { Placement, Surface, SurfaceNode } from "@/lib/surface/types"
import {
  Callout,
  Image,
  List,
  Progress,
  Stats,
  Steps,
  Table,
  Text,
} from "./content"
import { SurfaceContext } from "./context"
import type { SurfaceContextValue } from "./context"
import {
  Actions,
  Choice,
  DateField,
  Form,
  Section,
  Split,
  TextField,
  Toggle,
} from "./controls"

/** Sends a button's event to the bot. Rejects with a message to show. */
export type OnSurfaceEvent = (
  surfaceId: string,
  version: number,
  target: string,
  values: Record<string, unknown>
) => Promise<void>

type Leaf = (props: { node: SurfaceNode }) => React.ReactNode
type Container = (props: {
  node: SurfaceNode
  children: React.ReactNode
}) => React.ReactNode

const LEAVES: Record<string, Leaf> = {
  Stats,
  List,
  Table,
  Callout,
  Text,
  Progress,
  Steps,
  Image,
  TextField,
  Choice,
  Toggle,
  DateField,
  Actions,
}

const CONTAINERS: Record<string, Container> = { Section, Split, Form }

function NodeView({
  id,
  nodes,
}: {
  id: string
  nodes: Record<string, SurfaceNode>
}) {
  const node = nodes[id]
  if (!node) return null
  const Box = CONTAINERS[node.type]
  if (Box) {
    return (
      <Box node={node}>
        {node.children?.map((child) => (
          <NodeView key={child} id={child} nodes={nodes} />
        ))}
      </Box>
    )
  }
  const Component = LEAVES[node.type]
  return Component ? <Component node={node} /> : null
}

/** Wide components need the whole column; the rest line up with bubbles. */
function isWide(surface: Surface) {
  return Object.values(surface.nodes).some(
    (n) => n.type === "Table" || n.type === "Split" || n.type === "Form"
  )
}

/**
 * A surface the bot showed, drawn with the app's own components. Field
 * edits stay here until a button sends them; when a newer version of the
 * surface arrives after a press, they are dropped for what the bot wrote.
 */
export function SurfaceView({
  surface,
  placement,
  interactive = true,
  onEvent,
  onSay,
  busy = false,
  readFile,
}: {
  surface: Surface
  placement: Placement
  /** False for an older copy of a surface that has moved on. */
  interactive?: boolean
  onEvent?: OnSurfaceEvent
  /** Sends a say button's text as the user's message. */
  onSay?: (text: string, target: string) => void
  /** The bot is working: buttons wait until it is done. */
  busy?: boolean
  readFile?: ReadFileData
}) {
  const [edits, setEdits] = useState<Map<string, unknown>>(() => new Map())
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<SurfaceContextValue["error"]>(null)
  const pressedAt = useRef<number | null>(null)

  // A new version after a press is the bot's answer: start from it.
  useEffect(() => {
    if (pressedAt.current !== null && surface.version > pressedAt.current) {
      pressedAt.current = null
      setEdits(new Map())
      setPending(null)
    }
  }, [surface.version])

  const data = useMemo(() => {
    let out = surface.data
    for (const [pointer, value] of edits) {
      out = setAt(out, pointer, value) ?? out
    }
    return out
  }, [surface.data, edits])

  const live = interactive && surface.status === "open" && !!onEvent
  const press = useCallback(
    (target: string) => {
      const found = actionAt(surface, target)
      if (!found) return
      const { action } = found
      setError(null)
      if ("say" in action) {
        onSay?.(action.say, target)
        return
      }
      if (!("event" in action) || !onEvent) return
      const values = Object.fromEntries(
        action.fields.map((pointer) => [pointer, getAt(data, pointer) ?? null])
      )
      setPending(target)
      pressedAt.current = surface.version
      onEvent(surface.id, surface.version, target, values).then(
        () => setPending((p) => (p === target ? null : p)),
        (err: unknown) => {
          pressedAt.current = null
          setPending(null)
          setError({
            target,
            message:
              err instanceof Error ? err.message : "That did not go through.",
          })
        }
      )
    },
    [surface, data, onEvent, onSay]
  )

  const context = useMemo<SurfaceContextValue>(
    () => ({
      surface,
      data,
      placement,
      interactive: live,
      canSay: !!onSay && interactive,
      busy,
      setField: (pointer, value) =>
        setEdits((prev) => new Map(prev).set(pointer, value)),
      edited: new Set(edits.keys()),
      press,
      pending,
      error,
      readFile,
    }),
    [
      surface,
      data,
      placement,
      live,
      onSay,
      interactive,
      busy,
      edits,
      press,
      pending,
      error,
      readFile,
    ]
  )

  if (surface.root.length === 0) return null
  return (
    <SurfaceContext.Provider value={context}>
      <div
        data-surface={surface.id}
        className={`sf-enter flex w-full flex-col gap-3 ${
          placement === "thread" && !isWide(surface) ? "max-w-[85%]" : ""
        }`}
      >
        {surface.root.map((id) => (
          <NodeView key={id} id={id} nodes={surface.nodes} />
        ))}
      </div>
    </SurfaceContext.Provider>
  )
}
