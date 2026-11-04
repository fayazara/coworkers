export const THEME_STORAGE_KEY = "coworkers-theme"

/**
 * The browser chrome (theme-color) for each mode: the main surface, so the
 * status bar runs into the page. Must equal --brand-surface in
 * src/theme/tokens.css (a test checks), and the manifest's colors.
 */
export const THEME_COLORS = {
  light: "#ffffff",
  dark: "#0f0f0f",
} as const

/** The mode the page is drawn in. */
export type Theme = keyof typeof THEME_COLORS

/**
 * What the user picked. "system" follows prefers-color-scheme as it changes
 * and is stored as no value at all, so a fresh install follows the OS.
 */
export type ThemePreference = Theme | "system"

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
]

type ReadableStorage = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem" | "removeItem">

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark"
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || isTheme(value)
}

/** A stored Light or Dark wins; anything else follows the OS. */
export function resolveTheme(
  stored: string | null,
  systemDark: boolean
): Theme {
  return isTheme(stored) ? stored : systemDark ? "dark" : "light"
}

function defaultStorage<T>(storage: T | null | undefined): T | null {
  if (storage !== undefined) return storage
  return typeof localStorage !== "undefined"
    ? (localStorage as unknown as T)
    : null
}

/** The saved override, or null when the app follows the OS. */
export function readStoredTheme(
  storage?: ReadableStorage | null
): Theme | null {
  try {
    const stored = defaultStorage(storage)?.getItem(THEME_STORAGE_KEY) ?? null
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function readThemePreference(
  storage?: ReadableStorage | null
): ThemePreference {
  return readStoredTheme(storage) ?? "system"
}

/** Light and Dark are saved; System clears the override. */
export function storeThemePreference(
  preference: ThemePreference,
  storage?: WritableStorage | null
): void {
  try {
    const target = defaultStorage(storage)
    if (isTheme(preference)) target?.setItem(THEME_STORAGE_KEY, preference)
    else target?.removeItem(THEME_STORAGE_KEY)
  } catch {
    // A blocked storage API should not stop the theme from changing.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.mode = theme
  root.style.colorScheme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme])
}

/**
 * Runs in the document head before paint. Keep it dependency-free so a stored
 * choice or the OS preference is applied before the first light surface shows.
 */
export const THEME_INIT_SCRIPT = `(function(){var t="light";try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark")t=s;else if(matchMedia("(prefers-color-scheme: dark)").matches)t="dark"}catch(e){}try{var r=document.documentElement;r.dataset.mode=t;r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch(e){}})()`
