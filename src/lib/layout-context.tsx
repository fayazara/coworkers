import { createContext, useCallback, useContext, useState } from "react"
import { useIsPhone } from "@/lib/use-is-phone"

export const SIDEBAR_COOKIE = "coworkers-sidebar"
export const WIDTHS_COOKIE = "coworkers-widths"

export interface PanelWidths {
  /** Sidebar width in px. */
  sidebar?: number
  /** Right-hand panel (Computer, Settings) width in px. */
  panel?: number
}

/** Reads `coworkers-widths=sidebar:300,panel:520` from a Cookie header. */
export function parseWidths(cookie: string): PanelWidths {
  const raw = new RegExp(`${WIDTHS_COOKIE}=([^;]*)`).exec(cookie)?.[1]
  const widths: PanelWidths = {}
  for (const pair of decodeURIComponent(raw ?? "").split(",")) {
    const [key, value] = pair.split(":")
    const px = Number(value)
    if ((key === "sidebar" || key === "panel") && px > 0 && px < 4000) {
      widths[key] = Math.round(px)
    }
  }
  return widths
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`
}

interface LayoutContextValue {
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  widths: PanelWidths
  setWidth: (key: keyof PanelWidths, px: number) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function useLayout() {
  const value = useContext(LayoutContext)
  if (!value) throw new Error("useLayout must be used inside LayoutProvider")
  return value
}

/**
 * App chrome state. The sidebar preference and panel widths live in cookies
 * so the server renders them in place and nothing moves on page load. On a
 * phone the sidebar is a drawer over the page: it starts shut and leaves the
 * saved preference alone.
 */
export function LayoutProvider({
  initialSidebarOpen,
  initialWidths,
  children,
}: {
  initialSidebarOpen: boolean
  initialWidths: PanelWidths
  children: React.ReactNode
}) {
  const phone = useIsPhone()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pinnedOpen, setOpen] = useState(initialSidebarOpen)
  const sidebarOpen = phone ? drawerOpen : pinnedOpen
  const [widths, setWidths] = useState(initialWidths)

  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (phone) return setDrawerOpen(open)
      setOpen(open)
      writeCookie(SIDEBAR_COOKIE, open ? "open" : "closed")
    },
    [phone]
  )

  const toggleSidebar = useCallback(() => {
    if (phone) return setDrawerOpen((open) => !open)
    setOpen((open) => {
      writeCookie(SIDEBAR_COOKIE, open ? "closed" : "open")
      return !open
    })
  }, [phone])

  const setWidth = useCallback((key: keyof PanelWidths, px: number) => {
    setWidths((current) => {
      const next = { ...current, [key]: Math.round(px) }
      const value = Object.entries(next)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")
      writeCookie(WIDTHS_COOKIE, encodeURIComponent(value))
      return next
    })
  }, [])

  return (
    <LayoutContext.Provider
      value={{ sidebarOpen, toggleSidebar, setSidebarOpen, widths, setWidth }}
    >
      {children}
    </LayoutContext.Provider>
  )
}
