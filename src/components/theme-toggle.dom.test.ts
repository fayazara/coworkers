// @vitest-environment jsdom

import { createElement } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { ThemeToggle } from "@/components/theme-toggle"
import { THEME_STORAGE_KEY } from "@/lib/theme"

// A matchMedia whose answer the test can flip, firing "change" like the OS.
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media)
  )
  return {
    set(next: boolean) {
      dark = next
      act(() => listeners.forEach((fn) => fn()))
    },
  }
}

function mount() {
  render(createElement(TooltipProvider, null, createElement(ThemeToggle)))
}

const mode = () => document.documentElement.dataset.mode

async function pick(label: string) {
  const trigger = screen.getByRole("button", { name: /^Theme:/ })
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger)
  const item = await screen.findByRole("menuitemradio", { name: label })
  fireEvent.click(item)
  await waitFor(() => expect(item.getAttribute("aria-checked")).toBe("true"))
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-mode")
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("starts on System and follows the OS live", () => {
    const system = fakeSystem(false)
    mount()
    expect(screen.getByRole("button", { name: "Theme: System" })).toBeTruthy()
    expect(mode()).toBe("light")

    system.set(true)
    expect(mode()).toBe("dark")
  })

  it("keeps a picked mode over the OS until System is picked again", async () => {
    const system = fakeSystem(false)
    mount()

    await pick("Dark")
    expect(mode()).toBe("dark")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeTruthy()

    system.set(false)
    expect(mode()).toBe("dark")

    await pick("Light")
    expect(mode()).toBe("light")
    system.set(true)
    expect(mode()).toBe("light")

    await pick("System")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(mode()).toBe("dark")
    system.set(false)
    expect(mode()).toBe("light")
  })
})
