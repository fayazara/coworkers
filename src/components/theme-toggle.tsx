import { useEffect, useState } from "react"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { MoonIcon, SunIcon } from "@/components/icons"
import {
  THEME_STORAGE_KEY,
  applyTheme,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  systemPrefersDark,
} from "@/lib/theme"
import type { Theme } from "@/lib/theme"

function preferredTheme(): Theme {
  return resolveTheme(readStoredTheme(), systemPrefersDark())
}

/** Light/dark switch. An untouched install follows the OS as it changes. */
export function ThemeToggle() {
  // Match the server render; the effect below applies the saved/system mode.
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    const sync = () => {
      const next = preferredTheme()
      applyTheme(next)
      setTheme(next)
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onSystemChange = () => {
      if (!readStoredTheme()) sync()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) sync()
    }

    sync()
    media.addEventListener("change", onSystemChange)
    window.addEventListener("storage", onStorage)
    return () => {
      media.removeEventListener("change", onSystemChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  function toggle() {
    const next = nextTheme(theme)
    storeTheme(next)
    applyTheme(next)
    setTheme(next)
  }

  const label = theme === "dark" ? "Use light mode" : "Use dark mode"
  return (
    <Tooltip
      content={label}
      render={
        <button
          type="button"
          aria-label="Dark mode"
          aria-pressed={theme === "dark"}
          onClick={toggle}
          className="icon-btn"
        >
          {theme === "dark" ? <SunIcon size={19} /> : <MoonIcon size={19} />}
        </button>
      }
    />
  )
}
