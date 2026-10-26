import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels"

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
  open: boolean
  /** The panel's width when open: px, or any CSS length for the default. */
  width: number | string
  minWidth: number
  maxWidth: number | string
  /** Space the main content always keeps, in px. */
  mainMinWidth: number
  /** The user finished resizing the open panel. */
  onWidthChange: (px: number) => void
  /** The user dragged the panel shut, or tapped outside the drawer. */
  onClose: () => void
  /** The panel moved between docked beside the main content and a drawer. */
  onOverlayChange?: (overlay: boolean) => void
  panel: React.ReactNode
  children: React.ReactNode
}

/**
 * Main content beside a panel that slides open and shut and can be resized
 * by dragging the line between them. When the two do not fit side by side
 * (a phone), the panel slides over the main content as a drawer instead.
 */
export function SplitView({
  id,
  side,
  open,
  width,
  minWidth,
  maxWidth,
  mainMinWidth,
  onWidthChange,
  onClose,
  onOverlayChange,
  panel,
  children,
}: SplitViewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = usePanelRef()
  const widthRef = useRef(width)
  widthRef.current = width
  const [overlay, setOverlay] = useState(false)
  const docked = open && !overlay
  const openRef = useRef(docked)
  const callbacks = useRef({ onWidthChange, onClose, onOverlayChange })
  callbacks.current = { onWidthChange, onClose, onOverlayChange }

  // Measured before paint so a phone never shows a squeezed panel.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => {
      const next = box.clientWidth < minWidth + mainMinWidth
      setOverlay(next)
      callbacks.current.onOverlayChange?.(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [minWidth, mainMinWidth])

  // Open and close by resizing the panel; CSS animates the change.
  useEffect(() => {
    if (openRef.current === docked) return
    openRef.current = docked
    const group = groupRef.current
    const handle = panelRef.current
    if (!group || !handle) return
    group.dataset.animating = docked ? "open" : "close"
    if (docked) {
      const target = widthRef.current
      if (typeof target === "number") handle.resize(target)
      else handle.expand()
    } else {
      handle.collapse()
    }
    const timer = setTimeout(
      () => delete group.dataset.animating,
      docked ? OPEN_MS : CLOSE_MS
    )
    return () => clearTimeout(timer)
  }, [docked, panelRef])

  const sidePanel = (
    <Panel
      id={`${id}-panel`}
      panelRef={panelRef}
      defaultSize={docked ? width : 0}
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
      <div
        ref={contentRef}
        className="split-content"
        data-open={docked}
        data-side={side}
        style={
          {
            "--split-width": typeof width === "number" ? `${width}px` : width,
          } as React.CSSProperties
        }
        // Keep a closed panel out of the tab order and the accessibility tree.
        inert={!docked}
      >
        {overlay ? null : panel}
      </div>
    </Panel>
  )

  const main = (
    <Panel
      id={`${id}-main`}
      minSize={mainMinWidth}
      className="flex h-full min-w-0"
      style={{ overflow: "hidden" }}
    >
      {children}
    </Panel>
  )

  return (
    <div
      ref={boxRef}
      className="relative h-full w-full min-w-0 overflow-hidden"
    >
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
        <ResizeHandle disabled={!docked} />
        {side === "left" ? main : sidePanel}
      </Group>
      {overlay ? (
        <>
          <div
            className="split-backdrop"
            data-open={open}
            aria-hidden="true"
            onClick={() => callbacks.current.onClose()}
          />
          <div
            className="split-drawer bg-kumo-canvas"
            data-open={open}
            data-side={side}
            inert={!open}
          >
            {panel}
          </div>
        </>
      ) : null}
    </div>
  )
}
