// @vitest-environment jsdom
import { createElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider, useTheme } from "./theme-context"
import {
  parseThemePreference,
  resolveColorMode,
  THEME_BOOTSTRAP,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme"

let systemDark = false
let media: EventTarget

function bootstrap() {
  new Function("window", "document", "localStorage", THEME_BOOTSTRAP)(
    window,
    document,
    window.localStorage
  )
}

function Controls() {
  const { preference, mode, setPreference } = useTheme()
  return createElement(
    "div",
    null,
    createElement("output", null, `${preference}:${mode}`),
    ...(["system", "light", "dark"] as const).map((value) =>
      createElement(
        "button",
        { key: value, onClick: () => setPreference(value) },
        value
      )
    )
  )
}

function app() {
  return createElement(ThemeProvider, null, createElement(Controls))
}

function changeSystem(dark: boolean) {
  systemDark = dark
  act(() => media.dispatchEvent(new Event("change")))
}

beforeEach(() => {
  systemDark = false
  media = new EventTarget()
  Object.defineProperty(media, "matches", { get: () => systemDark })
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media)
  )
  window.localStorage.clear()
  document.documentElement.removeAttribute("data-mode")
  document.documentElement.removeAttribute("data-theme-preference")
  document.documentElement.removeAttribute("style")
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">'
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("theme preference", () => {
  it.each([null, undefined, "", "sepia", {}, "system"])(
    "defaults %s to System",
    (value) => {
      expect(parseThemePreference(value)).toBe("system")
    }
  )

  it.each(["light", "dark"] as const)("preserves %s", (value) => {
    expect(parseThemePreference(value)).toBe(value)
  })

  it("resolves explicit overrides independently of the device", () => {
    expect(resolveColorMode("light", true)).toBe("light")
    expect(resolveColorMode("dark", false)).toBe("dark")
    expect(resolveColorMode("system", true)).toBe("dark")
    expect(resolveColorMode("system", false)).toBe("light")
  })
})

describe("first-paint bootstrap", () => {
  it.each([false, true])("uses the device before React (dark=%s)", (dark) => {
    systemDark = dark
    bootstrap()
    const mode = dark ? "dark" : "light"
    expect(document.documentElement.dataset.mode).toBe(mode)
    expect(document.documentElement.dataset.themePreference).toBe("system")
    expect(document.documentElement.style.colorScheme).toBe(mode)
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content")
    ).toBe(THEME_COLORS[mode])
  })

  it.each(["light", "dark"] as const)(
    "restores saved %s before React",
    (mode) => {
      systemDark = mode === "light"
      window.localStorage.setItem(THEME_STORAGE_KEY, mode)
      bootstrap()
      expect(document.documentElement.dataset.mode).toBe(mode)
      expect(document.documentElement.dataset.themePreference).toBe(mode)
    }
  )

  it("ignores corrupt storage", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "invalid")
    systemDark = true
    bootstrap()
    expect(document.documentElement.dataset.mode).toBe("dark")
  })

  it("works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    systemDark = true
    bootstrap()
    expect(document.documentElement.dataset.mode).toBe("dark")
  })

  it("works without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined)
    bootstrap()
    expect(document.documentElement.dataset.mode).toBe("light")
  })

  it("hydrates without resetting the bootstrapped dark page or mismatching HTML", async () => {
    const container = document.createElement("div")
    container.innerHTML = renderToString(app())
    document.body.appendChild(container)
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark")
    bootstrap()
    const onRecoverableError = vi.fn()
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, app(), { onRecoverableError })
    })
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.mode).toBe("dark")
    expect(container.querySelector("output")?.textContent).toBe("dark:dark")
    act(() => root.unmount())
    container.remove()
  })
})

describe("live theme", () => {
  it("follows OS changes only in System and saves choices immediately", () => {
    render(app())
    expect(screen.getByRole("status").textContent).toBe("system:light")
    changeSystem(true)
    expect(screen.getByRole("status").textContent).toBe("system:dark")
    fireEvent.click(screen.getByRole("button", { name: "light" }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light")
    changeSystem(false)
    changeSystem(true)
    expect(screen.getByRole("status").textContent).toBe("light:light")
    expect(document.documentElement.dataset.mode).toBe("light")
    fireEvent.click(screen.getByRole("button", { name: "system" }))
    expect(screen.getByRole("status").textContent).toBe("system:dark")
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system")
  })

  it("restores the saved choice on remount", () => {
    const first = render(app())
    fireEvent.click(screen.getByRole("button", { name: "dark" }))
    first.unmount()
    render(app())
    expect(screen.getByRole("status").textContent).toBe("dark:dark")
  })

  it("synchronizes other tabs, removal and clear, but ignores unrelated keys", () => {
    render(app())
    const storage = (key: string | null, newValue: string | null) =>
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            newValue,
            storageArea: window.localStorage,
          })
        )
      })
    storage(THEME_STORAGE_KEY, "dark")
    expect(screen.getByRole("status").textContent).toBe("dark:dark")
    storage("other-key", "light")
    expect(screen.getByRole("status").textContent).toBe("dark:dark")
    storage(THEME_STORAGE_KEY, null)
    expect(screen.getByRole("status").textContent).toBe("system:light")
    storage(THEME_STORAGE_KEY, "dark")
    storage(null, null)
    expect(screen.getByRole("status").textContent).toBe("system:light")
  })

  it("ignores sessionStorage events from child frames", () => {
    render(app())
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "dark",
          storageArea: window.sessionStorage,
        })
      )
    )
    expect(screen.getByRole("status").textContent).toBe("system:light")
  })

  it("still applies choices if persistence fails", () => {
    render(app())
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full")
    })
    fireEvent.click(screen.getByRole("button", { name: "dark" }))
    expect(screen.getByRole("status").textContent).toBe("dark:dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content")
    ).toBe(THEME_COLORS.dark)
  })

  it("preserves bootstrap preference if reading storage fails", () => {
    document.documentElement.dataset.themePreference = "dark"
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(app())
    expect(screen.getByRole("status").textContent).toBe("dark:dark")
  })

  it("removes media and storage listeners on unmount", () => {
    const removeMedia = vi.spyOn(media, "removeEventListener")
    const removeStorage = vi.spyOn(window, "removeEventListener")
    const view = render(app())
    view.unmount()
    expect(removeMedia).toHaveBeenCalledWith("change", expect.any(Function))
    expect(removeStorage).toHaveBeenCalledWith("storage", expect.any(Function))
  })
})
