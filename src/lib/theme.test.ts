import { describe, expect, it, vi } from "vitest"
import {
  THEME_STORAGE_KEY,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from "@/lib/theme"

describe("theme", () => {
  it("uses a valid saved choice before the system preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark")
    expect(resolveTheme("light", true)).toBe("light")
  })

  it("follows the system when there is no valid saved choice", () => {
    expect(resolveTheme(null, true)).toBe("dark")
    expect(resolveTheme("sepia", false)).toBe("light")
  })

  it("toggles between the two modes", () => {
    expect(nextTheme("light")).toBe("dark")
    expect(nextTheme("dark")).toBe("light")
  })

  it("reads and writes the saved choice", () => {
    const getItem = vi.fn(() => "dark")
    expect(readStoredTheme({ getItem })).toBe("dark")
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY)

    const setItem = vi.fn()
    storeTheme("light", { setItem })
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light")
  })

  it("ignores storage failures", () => {
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error("blocked")
        },
      })
    ).toBeNull()
    expect(() =>
      storeTheme("dark", {
        setItem: () => {
          throw new Error("blocked")
        },
      })
    ).not.toThrow()
  })
})
