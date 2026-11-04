import { useEffect, useState } from "react"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { LaptopIcon, MoonIcon, SunIcon } from "@/components/icons"
import {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
  systemPrefersDark,
} from "@/lib/theme"
import type { ThemePreference } from "@/lib/theme"

const LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
}

const ICONS = {
  system: LaptopIcon,
  light: SunIcon,
  dark: MoonIcon,
} satisfies Record<ThemePreference, unknown>

/** Draws the page for a preference: System asks the OS, now. */
function show(preference: ThemePreference) {
  applyTheme(
    resolveTheme(
      preference === "system" ? null : preference,
      systemPrefersDark()
    )
  )
}

/**
 * System, Light or Dark. System (the default) follows the OS as it changes;
 * Light and Dark are saved and win over it until System is picked again.
 */
export function ThemeToggle() {
  // Match the server render; the effect below reads the saved choice.
  const [preference, setPreference] = useState<ThemePreference>("system")

  useEffect(() => {
    const sync = () => {
      const next = readThemePreference()
      show(next)
      setPreference(next)
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onSystemChange = () => {
      if (readThemePreference() === "system") sync()
    }
    // Another tab changed it.
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

  function choose(value: unknown) {
    if (!isThemePreference(value)) return
    storeThemePreference(value)
    show(value)
    setPreference(value)
  }

  const Icon = ICONS[preference]
  const label = `Theme: ${LABELS[preference]}`
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={(props) => (
          <Tooltip
            content={label}
            render={
              <button
                {...props}
                type="button"
                aria-label={label}
                className="icon-btn"
              >
                <Icon size={18} />
              </button>
            }
          />
        )}
      />
      <DropdownMenu.Content side="top" align="end">
        <DropdownMenu.Group>
          <DropdownMenu.Label>Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={preference} onValueChange={choose}>
            {THEME_PREFERENCES.map((value) => {
              const ItemIcon = ICONS[value]
              return (
                <DropdownMenu.RadioItem
                  key={value}
                  value={value}
                  closeOnClick
                  icon={<ItemIcon />}
                  className="gap-2"
                >
                  {LABELS[value]}
                  <DropdownMenu.RadioItemIndicator />
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
