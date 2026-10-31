export const THEME_STORAGE_KEY = "coworkers-theme"

export const THEME_COLORS = {
  light: "#ffffff",
  dark: "#1a1a1a",
} as const

export type Theme = keyof typeof THEME_COLORS

type ReadableStorage = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem">

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark"
}

export function resolveTheme(
  stored: string | null,
  systemDark: boolean
): Theme {
  return isTheme(stored) ? stored : systemDark ? "dark" : "light"
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark"
}

export function readStoredTheme(
  storage?: ReadableStorage | null
): Theme | null {
  try {
    const target =
      storage === undefined && typeof localStorage !== "undefined"
        ? localStorage
        : storage
    const stored = target?.getItem(THEME_STORAGE_KEY) ?? null
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeTheme(
  theme: Theme,
  storage?: WritableStorage | null
): void {
  try {
    const target =
      storage === undefined && typeof localStorage !== "undefined"
        ? localStorage
        : storage
    target?.setItem(THEME_STORAGE_KEY, theme)
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
