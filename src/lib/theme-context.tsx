import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  parseThemePreference,
  resolveColorMode,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme"
import type { ColorMode, ThemePreference } from "./theme"

interface ThemeContextValue {
  preference: ThemePreference
  mode: ColorMode
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Stable during SSR/hydration. The inline bootstrap already colors the page;
  // this state only connects React controls and shadow-root renderers to it.
  const [theme, setTheme] = useState<{
    preference: ThemePreference
    mode: ColorMode
  }>({ preference: "system", mode: "light" })
  const preferenceRef = useRef<ThemePreference>("system")
  const apply = useCallback((preference: ThemePreference) => {
    preferenceRef.current = preference
    const mode = resolveColorMode(
      preference,
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
    )
    document.documentElement.dataset.themePreference = preference
    document.documentElement.dataset.mode = mode
    document.documentElement.style.colorScheme = mode
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[mode])
    setTheme((previous) =>
      previous.preference === preference && previous.mode === mode
        ? previous
        : { preference, mode }
    )
  }, [])

  useEffect(() => {
    let preference = parseThemePreference(
      document.documentElement.dataset.themePreference
    )
    try {
      preference = parseThemePreference(
        window.localStorage.getItem(THEME_STORAGE_KEY)
      )
    } catch {
      // Keep the bootstrap's preference if browser storage is unavailable.
    }
    apply(preference)
    const media = window.matchMedia?.("(prefers-color-scheme: dark)")
    const onSystemChange = () => apply(preferenceRef.current)
    const onStorage = (event: StorageEvent) => {
      // sessionStorage can also dispatch storage events from child frames.
      if (event.storageArea && event.storageArea !== window.localStorage) return
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        apply(parseThemePreference(event.newValue))
    }
    media?.addEventListener("change", onSystemChange)
    window.addEventListener("storage", onStorage)
    return () => {
      media?.removeEventListener("change", onSystemChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [apply])

  const setPreference = useCallback(
    (value: ThemePreference) => {
      const preference = parseThemePreference(value)
      apply(preference)
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference)
      } catch {
        // The selection still works for this tab when storage is blocked/full.
      }
    },
    [apply]
  )
  const value = useMemo(
    () => ({ ...theme, setPreference }),
    [theme, setPreference]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider")
  return theme
}
