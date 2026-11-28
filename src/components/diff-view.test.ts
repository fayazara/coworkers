// @vitest-environment jsdom
import { createElement } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PatchView, EditView } from "./diff-view"
import { ThemeProvider, useTheme } from "@/lib/theme-context"

vi.mock("@tanstack/react-router", () => ({ useHydrated: () => true }))
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ options }: { options: { themeType: string } }) =>
    createElement("output", null, `patch:${options.themeType}`),
  MultiFileDiff: ({ options }: { options: { themeType: string } }) =>
    createElement("output", null, `file:${options.themeType}`),
}))

function Fixture() {
  const { setPreference } = useTheme()
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => setPreference("light") }, "Light"),
    createElement("button", { onClick: () => setPreference("dark") }, "Dark"),
    createElement(PatchView, { patch: "" }),
    createElement(EditView, {
      path: "notes.txt",
      oldText: "old",
      newText: "new",
    })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("keeps both shadow-root diff renderers on the selected app mode, not the OS", () => {
  render(createElement(ThemeProvider, null, createElement(Fixture)))
  expect(screen.getByText("patch:dark")).toBeTruthy()
  expect(screen.getByText("file:dark")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Light" }))
  expect(screen.getByText("patch:light")).toBeTruthy()
  expect(screen.getByText("file:light")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Dark" }))
  expect(screen.getByText("patch:dark")).toBeTruthy()
  expect(screen.getByText("file:dark")).toBeTruthy()
})
