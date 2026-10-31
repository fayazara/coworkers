import { useRef } from "react"
import { Drawer } from "@base-ui/react/drawer"

/** Half the screen, so the thread stays in view, then full height. */
const DETENTS = [0.6, 1]

interface SheetProps {
  /** "left" is a drawer from the edge, "right" a bottom sheet. */
  side: "left" | "right"
  label: string
  open: boolean
  /** Swiped in from the edge. Only the left drawer can do this. */
  onOpen?: () => void
  onClose: () => void
  children: React.ReactNode
}

/** How a SplitView's panel appears on a phone. */
export function Sheet({
  side,
  label,
  open,
  onOpen,
  onClose,
  children,
}: SheetProps) {
  const left = side === "left"
  const popup = useRef<HTMLDivElement>(null)

  const portal = (
    <Drawer.Portal>
      <Drawer.Backdrop className="sheet-backdrop" data-side={side} />
      <Drawer.Viewport className="sheet-viewport" data-side={side}>
        <Drawer.Popup
          ref={popup}
          aria-label={label}
          // Panels open from links too, and the first field in one would
          // otherwise take focus and bring up the keyboard.
          initialFocus={popup}
          className="sheet-popup"
          data-side={side}
        >
          {left ? null : <div className="sheet-handle" aria-hidden="true" />}
          <Drawer.Content
            className="sheet-content"
            // A tap on the page you are already on changes nothing, so the
            // route alone cannot close the drawer.
            onClick={(e) => {
              if (!left) return
              const target = e.target as HTMLElement
              if (target.closest("a[href]")) onClose()
            }}
          >
            {children}
          </Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
  )

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => (next ? onOpen?.() : onClose())}
      swipeDirection={left ? "left" : "down"}
      snapPoints={left ? undefined : DETENTS}
    >
      {left ? (
        <>
          <Drawer.SwipeArea
            className="sheet-swipe-area"
            disabled={open || !onOpen}
          />
          {portal}
        </>
      ) : (
        <Drawer.VirtualKeyboardProvider>
          {portal}
        </Drawer.VirtualKeyboardProvider>
      )}
    </Drawer.Root>
  )
}
