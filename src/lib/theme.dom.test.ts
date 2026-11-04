// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  THEME_COLORS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  storeThemePreference,
} from "@/lib/theme"

function setSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: dark }) as MediaQueryList)
  )
}

function addThemeMeta() {
  const meta = document.createElement("meta")
  meta.name = "theme-color"
  meta.content = THEME_COLORS.light
  document.head.appendChild(meta)
}

describe("theme document behavior", () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.innerHTML = ""
    document.documentElement.removeAttribute("data-mode")
    document.documentElement.removeAttribute("style")
  })

  it("applies the saved mode before the first paint", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark")
    setSystemDark(false)
    addThemeMeta()

    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement.dataset.mode).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content
    ).toBe(THEME_COLORS.dark)
  })

  it("follows the OS when there is no saved mode", () => {
    setSystemDark(true)
    addThemeMeta()

    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement.dataset.mode).toBe("dark")
  })

  it("lets a saved Light win over a dark OS", () => {
    storeThemePreference("light")
    setSystemDark(true)
    addThemeMeta()

    new Function(THEME_INIT_SCRIPT)()

    expect(document.documentElement.dataset.mode).toBe("light")
  })

  it("follows the OS again once System is picked", () => {
    storeThemePreference("light")
    storeThemePreference("system")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()

    setSystemDark(true)
    addThemeMeta()
    new Function(THEME_INIT_SCRIPT)()
    expect(document.documentElement.dataset.mode).toBe("dark")

    setSystemDark(false)
    new Function(THEME_INIT_SCRIPT)()
    expect(document.documentElement.dataset.mode).toBe("light")
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content
    ).toBe(THEME_COLORS.light)
  })

  it("updates the document and browser chrome when toggled", () => {
    addThemeMeta()
    applyTheme("light")
    expect(document.documentElement.dataset.mode).toBe("light")
    expect(document.documentElement.style.colorScheme).toBe("light")

    applyTheme("dark")
    expect(document.documentElement.dataset.mode).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content
    ).toBe(THEME_COLORS.dark)
  })
})
