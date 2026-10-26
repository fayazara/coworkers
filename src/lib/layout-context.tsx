import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { useLocation } from "@tanstack/react-router"

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
  /** The sidebar is a drawer over the page because the window is narrow. */
  setSidebarOverlay: (overlay: boolean) => void
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
 * narrow window the sidebar is a drawer instead: it starts closed, closes
 * after each navigation, and does not touch the saved preference.
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
  const [dockedOpen, setDockedOpen] = useState(initialSidebarOpen)
  const [overlay, setSidebarOverlay] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [widths, setWidths] = useState(initialWidths)
  const sidebarOpen = overlay ? drawerOpen : dockedOpen

  const pathname = useLocation({ select: (location) => location.pathname })
  useEffect(() => setDrawerOpen(false), [pathname])

  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (overlay) return setDrawerOpen(open)
      setDockedOpen(open)
      writeCookie(SIDEBAR_COOKIE, open ? "open" : "closed")
    },
    [overlay]
  )

  const toggleSidebar = useCallback(
    () => setSidebarOpen(!sidebarOpen),
    [setSidebarOpen, sidebarOpen]
  )

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
      value={{
        sidebarOpen,
        toggleSidebar,
        setSidebarOpen,
        setSidebarOverlay,
        widths,
        setWidth,
      }}
    >
      {children}
    </LayoutContext.Provider>
  )
}
