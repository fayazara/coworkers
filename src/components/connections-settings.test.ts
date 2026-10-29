// @vitest-environment jsdom
import { createElement } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Connection } from "@/lib/types"
import { ConnectionsSettings } from "./connections-settings"

const { useHubMock } = vi.hoisted(() => ({ useHubMock: vi.fn() }))
vi.mock("@/lib/hub-context", () => ({ useHub: useHubMock }))

const PARALLEL_URL = "https://mcp.parallel.ai/mcp?tools=web_search,web_fetch"
const connection: Connection = {
  id: "parallel-1",
  name: "Parallel",
  url: PARALLEL_URL,
  headerNames: [],
  status: "ready",
  tools: 2,
}

let hub: {
  live: boolean
  state: { connections: Connection[] }
  addConnection: ReturnType<typeof vi.fn>
  removeConnection: ReturnType<typeof vi.fn>
  refreshConnections: ReturnType<typeof vi.fn>
  reconnect: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  hub = {
    live: true,
    state: { connections: [] },
    addConnection: vi.fn().mockResolvedValue(connection),
    removeConnection: vi.fn(),
    refreshConnections: vi.fn(),
    reconnect: vi.fn(),
  }
  useHubMock.mockImplementation(() => hub)
})
afterEach(cleanup)

describe("Parallel quick connect", () => {
  it("connects search and page reads in one click without credentials", async () => {
    render(createElement(ConnectionsSettings))
    fireEvent.click(screen.getByRole("button", { name: "Connect Parallel" }))
    await waitFor(() =>
      expect(hub.addConnection).toHaveBeenCalledWith({
        name: "Parallel",
        url: PARALLEL_URL,
      })
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Parallel added" })
          .hasAttribute("disabled")
      ).toBe(true)
    )
    expect(hub.addConnection).toHaveBeenCalledTimes(1)
  })

  it("does not add a second connection while the first is pending", async () => {
    let resolve!: (value: Connection) => void
    hub.addConnection.mockImplementation(
      () =>
        new Promise<Connection>((done) => {
          resolve = done
        })
    )
    render(createElement(ConnectionsSettings))
    const button = screen.getByRole("button", { name: "Connect Parallel" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(hub.addConnection).toHaveBeenCalledTimes(1)
    resolve(connection)
    await screen.findByRole("button", { name: "Parallel added" })
  })

  it("shows failures and lets the user retry", async () => {
    hub.addConnection.mockRejectedValueOnce(
      new Error("Could not reach Parallel")
    )
    render(createElement(ConnectionsSettings))
    fireEvent.click(screen.getByRole("button", { name: "Connect Parallel" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reach Parallel"
    )
    fireEvent.click(screen.getByRole("button", { name: "Connect Parallel" }))
    await screen.findByRole("button", { name: "Parallel added" })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(hub.addConnection).toHaveBeenCalledTimes(2)
  })

  it("disables connecting until the hub is live", () => {
    hub.live = false
    render(createElement(ConnectionsSettings))
    const button = screen.getByRole("button", { name: "Connect Parallel" })
    fireEvent.click(button)
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(hub.addConnection).not.toHaveBeenCalled()
  })

  it.each([
    "https://mcp.parallel.ai/mcp?login&tools=web_search",
    "https://mcp.parallel.ai/mcp/",
    "https://search.parallel.ai/mcp",
    "https://search.parallel.ai/mcp-oauth",
    "https://search-mcp.parallel.ai/mcp",
    "https://task-mcp.parallel.ai/mcp",
  ])("recognizes an existing Parallel connection at %s", (url) => {
    hub.state.connections = [{ ...connection, name: "Research", url }]
    render(createElement(ConnectionsSettings))
    expect(
      screen.queryByRole("button", { name: "Connect Parallel" })
    ).toBeNull()
    expect(screen.getByText("Research")).toBeTruthy()
  })

  it("does not confuse a name or lookalike URL with Parallel", () => {
    hub.state.connections = [
      { ...connection, url: "https://mcp.parallel.ai.example.com/mcp" },
    ]
    render(createElement(ConnectionsSettings))
    expect(
      screen.getByRole("button", { name: "Connect Parallel" })
    ).toBeTruthy()
  })

  it("moves the connector to the connected list and restores the preset after removal", async () => {
    const view = render(createElement(ConnectionsSettings))
    fireEvent.click(screen.getByRole("button", { name: "Connect Parallel" }))
    await screen.findByRole("button", { name: "Parallel added" })
    hub.state = { connections: [connection] }
    view.rerender(createElement(ConnectionsSettings))
    expect(screen.queryByRole("button", { name: "Parallel added" })).toBeNull()
    expect(screen.getByRole("button", { name: "Remove Parallel" })).toBeTruthy()
    hub.state = { connections: [] }
    view.rerender(createElement(ConnectionsSettings))
    const button = screen.getByRole("button", { name: "Connect Parallel" })
    expect(button.hasAttribute("disabled")).toBe(false)
  })
})
