import { describe, expect, it, vi } from "vitest"
import {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isThemePreference,
  readStoredTheme,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
} from "@/lib/theme"

function memoryStorage(initial?: string) {
  const items = new Map<string, string>()
  if (initial !== undefined) items.set(THEME_STORAGE_KEY, initial)
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

describe("theme", () => {
  it("uses a valid saved choice before the system preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark")
    expect(resolveTheme("light", true)).toBe("light")
  })

  it("follows the system when there is no valid saved choice", () => {
    expect(resolveTheme(null, true)).toBe("dark")
    expect(resolveTheme("sepia", false)).toBe("light")
    expect(resolveTheme("system", true)).toBe("dark")
  })

  it("offers System, Light and Dark, System first", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"])
    expect(THEME_PREFERENCES.every(isThemePreference)).toBe(true)
    expect(isThemePreference("sepia")).toBe(false)
  })

  it("defaults to System when nothing valid is saved", () => {
    expect(readThemePreference(memoryStorage())).toBe("system")
    expect(readThemePreference(memoryStorage("sepia"))).toBe("system")
    expect(readThemePreference(memoryStorage("dark"))).toBe("dark")
    expect(readThemePreference(null)).toBe("system")
  })

  it("saves Light and Dark, and System clears the override", () => {
    const storage = memoryStorage()
    storeThemePreference("light", storage)
    expect(storage.items.get(THEME_STORAGE_KEY)).toBe("light")
    storeThemePreference("dark", storage)
    expect(readStoredTheme(storage)).toBe("dark")
    storeThemePreference("system", storage)
    expect(storage.items.has(THEME_STORAGE_KEY)).toBe(false)
    expect(readThemePreference(storage)).toBe("system")
  })

  it("reads the saved choice under the storage key", () => {
    const getItem = vi.fn(() => "dark")
    expect(readStoredTheme({ getItem })).toBe("dark")
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY)
  })

  it("ignores storage failures", () => {
    const blocked = () => {
      throw new Error("blocked")
    }
    expect(readStoredTheme({ getItem: blocked })).toBeNull()
    expect(readThemePreference({ getItem: blocked })).toBe("system")
    expect(() =>
      storeThemePreference("dark", { setItem: blocked, removeItem: blocked })
    ).not.toThrow()
    expect(() =>
      storeThemePreference("system", { setItem: blocked, removeItem: blocked })
    ).not.toThrow()
  })
})
