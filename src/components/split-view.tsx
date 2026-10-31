import { useEffect, useRef } from "react"
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels"
import { Sheet } from "@/components/sheet"
import { useIsPhone } from "@/lib/use-is-phone"

// Match --panel-open-dur and --panel-close-dur in styles.css.
const OPEN_MS = 400
const CLOSE_MS = 350

/**
 * The line between two panels. Hovering it shows a small grip that stays on
 * the line but follows the pointer up and down, and keeps following while
 * dragging.
 */
function ResizeHandle({ disabled }: { disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The hit area is wider than the 1px line, so track the pointer on the
    // document and only move the grip while the separator is engaged.
    const onMove = (e: PointerEvent) => {
      const el = ref.current
      const state = el?.dataset.separator
      if (!el || (state !== "hover" && state !== "active")) return
      const rect = el.getBoundingClientRect()
      const y = Math.min(rect.height - 20, Math.max(20, e.clientY - rect.top))
      el.style.setProperty("--grip-y", `${y}px`)
    }
    document.addEventListener("pointermove", onMove, { passive: true })
    return () => document.removeEventListener("pointermove", onMove)
  }, [])

  return (
    <Separator
      elementRef={ref}
      disabled={disabled}
      disableDoubleClick
      className="resize-handle"
    >
      <span className="resize-grip" aria-hidden="true" />
    </Separator>
  )
}

interface SplitViewProps {
  id: string
  /** Which side the collapsible panel sits on. */
  side: "left" | "right"
  /** Names the panel when it opens as a sheet on a phone. */
  label: string
  open: boolean
  /** The panel's width when open: px, or any CSS length for the default. */
  width: number | string
  minWidth: number
  maxWidth: number | string
  /** Space the main content always keeps, in px. */
  mainMinWidth: number
  /** The user finished resizing the open panel. */
  onWidthChange: (px: number) => void
  /** The user dragged the panel shut. */
  onClose: () => void
  /** The user swiped the panel in, on a phone. */
  onOpen?: () => void
  panel: React.ReactNode
  children: React.ReactNode
}

/**
 * Main content beside a panel that slides open and shut and can be resized
 * by dragging the line between them. On a phone the panel becomes a sheet
 * over the content. The group stays mounted, with styles.css giving the main
 * panel the full width, so rotating a phone does not remount the content.
 */
export function SplitView({
  id,
  side,
  label,
  open,
  width,
  minWidth,
  maxWidth,
  mainMinWidth,
  onWidthChange,
  onClose,
  onOpen,
  panel,
  children,
}: SplitViewProps) {
  const phone = useIsPhone()
  const groupRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = usePanelRef()
  const widthRef = useRef(width)
  widthRef.current = width
  const openRef = useRef(open)
  const callbacks = useRef({ onWidthChange, onClose })
  callbacks.current = { onWidthChange, onClose }

  // Open and close by resizing the panel; CSS animates the change.
  useEffect(() => {
    if (phone || openRef.current === open) return
    openRef.current = open
    const group = groupRef.current
    const handle = panelRef.current
    if (!group || !handle) return
    group.dataset.animating = open ? "open" : "close"
    if (open) {
      const target = widthRef.current
      if (typeof target === "number") handle.resize(target)
      else handle.expand()
    } else {
      handle.collapse()
    }
    const timer = setTimeout(
      () => delete group.dataset.animating,
      open ? OPEN_MS : CLOSE_MS
    )
    return () => clearTimeout(timer)
  }, [open, phone, panelRef])

  const sidePanel = (
    <Panel
      id={`${id}-panel`}
      panelRef={panelRef}
      defaultSize={open ? width : 0}
      minSize={minWidth}
      maxSize={maxWidth}
      collapsible
      collapsedSize={0}
      groupResizeBehavior="preserve-pixel-size"
      style={{ overflow: "hidden" }}
      onResize={(size) => {
        // Content keeps its last open width while the panel slides shut.
        if (size.inPixels > 0) {
          contentRef.current?.style.setProperty(
            "--split-width",
            `${Math.round(size.inPixels)}px`
          )
        }
      }}
    >
      {phone ? null : (
        <div
          ref={contentRef}
          className="split-content"
          data-open={open}
          data-side={side}
          style={
            {
              "--split-width": typeof width === "number" ? `${width}px` : width,
            } as React.CSSProperties
          }
          // Keep a closed panel out of the tab order and the accessibility tree.
          inert={!open}
        >
          {panel}
        </div>
      )}
    </Panel>
  )

  const main = (
    <Panel
      id={`${id}-main`}
      minSize={phone ? 0 : mainMinWidth}
      className="flex h-full min-w-0"
      style={{ overflow: "hidden" }}
    >
      {children}
    </Panel>
  )

  return (
    <Group
      id={id}
      elementRef={groupRef}
      className="split-view"
      resizeTargetMinimumSize={{ fine: 10, coarse: 28 }}
      onLayoutChanged={(_layout, meta) => {
        const handle = panelRef.current
        if (!meta.isUserInteraction || !handle) return
        if (handle.isCollapsed()) {
          if (openRef.current) callbacks.current.onClose()
        } else {
          callbacks.current.onWidthChange(handle.getSize().inPixels)
        }
      }}
    >
      {side === "left" ? sidePanel : main}
      <ResizeHandle disabled={!open} />
      {side === "left" ? main : sidePanel}
      {phone ? (
        <Sheet
          side={side}
          label={label}
          open={open}
          onOpen={onOpen}
          onClose={onClose}
        >
          {panel}
        </Sheet>
      ) : null}
    </Group>
  )
}
