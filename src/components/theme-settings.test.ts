// @vitest-environment jsdom
import { createElement } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ThemeMenu, ThemeSettings } from "./theme-settings"
import { ThemeProvider } from "@/lib/theme-context"
import { THEME_STORAGE_KEY } from "@/lib/theme"

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("offers System, Light and Dark as exclusive sidebar menu choices", async () => {
  render(createElement(ThemeProvider, null, createElement(ThemeMenu)))
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
  const dark = await screen.findByRole("menuitemradio", { name: "Dark" })
  expect(
    screen
      .getByRole("menuitemradio", { name: "System" })
      .getAttribute("aria-checked")
  ).toBe("true")
  expect(screen.getByRole("menuitemradio", { name: "Light" })).toBeTruthy()
  fireEvent.click(dark)
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
  expect(document.documentElement.dataset.mode).toBe("dark")
})

it("saves the settings choice without an extra Save button", async () => {
  render(createElement(ThemeProvider, null, createElement(ThemeSettings)))
  fireEvent.click(screen.getByRole("combobox", { name: "Color mode" }))
  const dark = await screen.findByRole("option", { name: "Dark" })
  fireEvent.pointerDown(dark, { pointerType: "mouse" })
  fireEvent.click(dark)
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
  expect(document.documentElement.dataset.mode).toBe("dark")
})
