// @vitest-environment jsdom
import { createElement } from "react"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BotSharing } from "@/lib/sharing"
import type { BotConnection } from "@/lib/bot-context"

const mocks = vi.hoisted(() => {
  const stub = {
    getBotSharing: vi.fn(),
    setSharingConnection: vi.fn(),
    getApps: vi.fn(),
    createAppLink: vi.fn(),
  }
  return {
    stub,
    agent: { stub },
    connections: [{ id: "calendar", name: "Calendar" }],
  }
})
vi.mock("@/lib/hub-context", () => ({
  useHub: () => ({ state: { connections: mocks.connections } }),
}))
vi.mock("@/lib/bot-context", () => ({
  useBot: () => ({ state: { name: "Planner", apps: [] } }),
}))
import { AppSharingConnections } from "./app-sharing-connections"
import { AppsPane } from "./apps-pane"

let stored: BotSharing
beforeEach(() => {
  vi.resetAllMocks()
  stored = { emails: [], workspace: false, connectionIds: [], isolated: false }
  mocks.stub.getBotSharing.mockImplementation(async () => stored)
  mocks.stub.setSharingConnection.mockImplementation(
    async ({ connectionId, enabled }) => {
      stored = { ...stored, connectionIds: enabled ? [connectionId] : [] }
      return stored
    }
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const agent = mocks.agent as unknown as BotConnection

describe("app sharing account selection", () => {
  it("lets the owner opt in before isolation without granting membership", async () => {
    const view = render(
      createElement(AppSharingConnections, {
        agent,
        willIsolate: true,
        refreshKey: 0,
      })
    )
    const toggle = await view.findByRole("switch", {
      name: "Allow Calendar for shared apps",
    })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("true")
    )
    expect(mocks.stub.setSharingConnection).toHaveBeenCalledWith({
      connectionId: "calendar",
      enabled: true,
    })
    expect(stored.emails).toEqual([])
    expect(stored.workspace).toBe(false)
    expect(stored.isolated).toBe(false)
  })
  it("shows existing isolated accounts and supports revocation", async () => {
    stored = { ...stored, isolated: true, connectionIds: ["calendar"] }
    const view = render(
      createElement(AppSharingConnections, {
        agent,
        willIsolate: false,
        refreshKey: 0,
      })
    )
    const toggle = await view.findByRole("switch", {
      name: "Allow Calendar for shared apps",
    })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false")
    )
    expect(mocks.stub.setSharingConnection).toHaveBeenCalledWith({
      connectionId: "calendar",
      enabled: false,
    })
    expect(stored.isolated).toBe(true)
  })
  it("retains the last saved selection and reports a failed update", async () => {
    mocks.stub.setSharingConnection.mockRejectedValue(
      new Error("Access unavailable")
    )
    const view = render(
      createElement(AppSharingConnections, {
        agent,
        willIsolate: true,
        refreshKey: 0,
      })
    )
    const toggle = await view.findByRole("switch", {
      name: "Allow Calendar for shared apps",
    })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Access unavailable")
    )
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })
  it("exposes account selection in the actual app-sharing flow and keeps it after sharing", async () => {
    let app = {
      slug: "booking",
      name: "Booking",
      version: 1,
      updatedAt: Date.now(),
      links: [],
      access: { submit: [], read: [], wake: false },
      collections: [],
      tools: [],
      approvedTools: [],
    }
    mocks.stub.getApps.mockImplementation(async () => [app])
    mocks.stub.createAppLink.mockImplementation(async () => {
      stored = { ...stored, isolated: true }
      app = { ...app, links: [] }
    })
    const view = render(createElement(AppsPane, { agent }))
    fireEvent.click(await view.findByRole("button", { name: /Booking/ }))
    fireEvent.click(
      view.getByRole("switch", { name: "Allow messaging the bot" })
    )
    const account = await view.findByRole("switch", {
      name: "Allow Calendar for shared apps",
    })
    fireEvent.click(account)
    await waitFor(() =>
      expect(account.getAttribute("aria-checked")).toBe("true")
    )
    fireEvent.change(
      view.getByRole("textbox", { name: "Label for this sharing link" }),
      { target: { value: "Guest" } }
    )
    fireEvent.click(view.getByRole("button", { name: "Share" }))
    await waitFor(() =>
      expect(mocks.stub.createAppLink).toHaveBeenCalledWith(
        "booking",
        "Guest",
        "view",
        { audience: "link", email: undefined, canMessage: true }
      )
    )
    await waitFor(() =>
      expect(
        view
          .getByRole("switch", { name: "Allow messaging the bot" })
          .getAttribute("aria-checked")
      ).toBe("false")
    )
    expect(
      view
        .getByRole("switch", { name: "Allow Calendar for shared apps" })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(stored.connectionIds).toEqual(["calendar"])
  })
})
