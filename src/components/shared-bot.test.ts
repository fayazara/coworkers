// @vitest-environment jsdom
import { createElement, type ReactNode } from "react"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSharedBot: vi.fn(),
  workspace: vi.fn(),
  listFiles: vi.fn(),
  fileModel: {
    resetPaths: vi.fn(),
    select: (_paths: string[]) => {},
  },
}))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: () => null,
}))
vi.mock("@/lib/sharing-fns", () => ({
  getSharedBot: mocks.getSharedBot,
  callSharedBotWorkspace: mocks.workspace,
  listSharedBotFiles: mocks.listFiles,
  downloadSharedBotFile: vi.fn(),
  messageSharedBot: vi.fn(),
  uploadSharedBotFile: vi.fn(),
  answerSharedBotChoice: vi.fn(),
}))
vi.mock("@/lib/layout-context", () => ({
  useLayout: () => ({ widths: {}, setWidth: vi.fn() }),
}))
vi.mock("@/components/bot-header", () => ({
  BotHeader: ({ children }: { children: ReactNode }) =>
    createElement("header", null, children),
}))
vi.mock("@cloudflare/kumo/components/tooltip", () => ({
  Tooltip: ({ render }: { render: ReactNode }) => render,
}))
vi.mock("@/components/thread", () => ({
  Thread: () => createElement("div", null, "Shared conversation"),
}))
vi.mock("@/components/composer", () => ({ Composer: () => null }))
vi.mock("@/components/code-block", () => ({
  CodeBlock: ({ code }: { code: string }) => createElement("pre", null, code),
  languageForPath: () => "text",
}))
vi.mock("@/components/split-view", () => ({
  SplitView: ({
    children,
    panel,
    open,
  }: {
    children: ReactNode
    panel: ReactNode
    open: boolean
  }) => createElement("div", null, children, open ? panel : null),
}))
vi.mock("@pierre/trees/react", () => ({
  FileTree: () =>
    createElement(
      "button",
      { onClick: () => mocks.fileModel.select(["notes.txt"]) },
      "notes.txt"
    ),
  useFileTree: ({
    onSelectionChange,
  }: {
    onSelectionChange: (paths: string[]) => void
  }) => {
    mocks.fileModel.select = onSelectionChange
    return { model: mocks.fileModel }
  },
}))
import { SharedBotChat } from "@/routes/_app/shared.$ownerId.$botId"
import type { getSharedBot } from "@/lib/sharing-fns"

const initial = {
  state: { name: "Family Manager", avatar: "blue-rectangle", status: "idle" },
  messagesJson: "[]",
  memory: "Family notes",
  apps: [
    {
      slug: "family",
      name: "Family hub",
      path: "/apps/owner/bot/family/private/",
      version: 1,
      updatedAt: Date.now(),
    },
  ],
} as Awaited<ReturnType<typeof getSharedBot>>
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  mocks.getSharedBot.mockResolvedValue(initial)
  mocks.workspace.mockImplementation(
    async ({ data }: { data: { action: { method: string } } }) => {
      if (data.action.method === "runCommand")
        return { stdout: "shared terminal works", stderr: "", exitCode: 0 }
      if (data.action.method === "readFileText")
        return { content: "Shared file preview", truncated: false }
      return []
    }
  )
  mocks.listFiles.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("shared bot computer", () => {
  it("opens all five workspace tabs without an owner's socket or bot context", async () => {
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    for (const name of ["Browser", "Terminal", "Files", "Apps", "Activity"])
      expect(view.getByRole("tab", { name })).toBeTruthy()
    await waitFor(() =>
      expect(mocks.workspace).toHaveBeenCalledWith({
        data: {
          ownerId: "owner",
          botId: "bot",
          action: { method: "getLiveView" },
        },
      })
    )
    fireEvent.click(
      view.getByRole("button", { name: "Close family manager's computer" })
    )
    expect(view.queryByRole("tab", { name: "Browser" })).toBeNull()
    expect(
      view
        .getByRole("button", { name: "Computer" })
        .getAttribute("aria-pressed")
    ).toBe("false")
  })
  it("runs terminal commands through scoped membership-checked server functions", async () => {
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    fireEvent.click(view.getByRole("tab", { name: "Terminal" }))
    const command = view.getByRole("textbox", { name: "Shell command" })
    fireEvent.change(command, { target: { value: "echo hello" } })
    fireEvent.submit(command.closest("form")!)
    await waitFor(() =>
      expect(view.getByText("shared terminal works")).toBeTruthy()
    )
    expect(mocks.workspace).toHaveBeenCalledWith({
      data: {
        ownerId: "owner",
        botId: "bot",
        action: { method: "runCommand", command: "echo hello" },
      },
    })
  })
  it("lets members open and use apps without exposing sharing administration", async () => {
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    fireEvent.click(view.getByRole("tab", { name: "Apps" }))
    fireEvent.click(view.getByRole("button", { name: /Family hub/ }))
    expect(view.getByTitle("Family hub preview").getAttribute("src")).toBe(
      initial.apps[0].path
    )
    expect(view.getByRole("button", { name: "Open" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Share" })).toBeNull()
    expect(view.queryByRole("button", { name: "Settings" })).toBeNull()
  })
  it("shows the interactive shared browser and scopes navigation and closing", async () => {
    mocks.workspace.mockImplementation(
      async ({ data }: { data: { action: { method: string } } }) => {
        if (data.action.method === "getLiveView")
          return [
            {
              targetId: "tab",
              url: "https://browser.test/live",
              pageUrl: "https://example.com",
              title: "Shared browser",
            },
          ]
        return true
      }
    )
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    await waitFor(() => expect(view.getByTitle("Shared browser")).toBeTruthy())
    fireEvent.click(view.getByRole("button", { name: "Reload" }))
    await waitFor(() =>
      expect(mocks.workspace).toHaveBeenCalledWith({
        data: {
          ownerId: "owner",
          botId: "bot",
          action: { method: "navigateBrowser", action: "reload" },
        },
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Close browser session" }))
    await waitFor(() =>
      expect(mocks.workspace).toHaveBeenCalledWith({
        data: {
          ownerId: "owner",
          botId: "bot",
          action: { method: "closeBrowser" },
        },
      })
    )
  })
  it("loads shared workspace files and previews them through scoped RPC", async () => {
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    fireEvent.click(view.getByRole("tab", { name: "Files" }))
    await waitFor(() =>
      expect(mocks.listFiles).toHaveBeenCalledWith({
        data: { ownerId: "owner", botId: "bot" },
      })
    )
    fireEvent.click(view.getByRole("button", { name: "notes.txt" }))
    await waitFor(() =>
      expect(view.getByText("Shared file preview")).toBeTruthy()
    )
    expect(mocks.workspace).toHaveBeenCalledWith({
      data: {
        ownerId: "owner",
        botId: "bot",
        action: { method: "readFileText", path: "/workspace/notes.txt" },
      },
    })
    expect(view.getByRole("button", { name: "Download file" })).toBeTruthy()
  })
  it("loads activity through the member adapter", async () => {
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    fireEvent.click(view.getByRole("tab", { name: "Activity" }))
    await waitFor(() => expect(view.getByText("No activity yet")).toBeTruthy())
    expect(mocks.workspace).toHaveBeenCalledWith({
      data: {
        ownerId: "owner",
        botId: "bot",
        action: { method: "getActivity", limit: 200 },
      },
    })
  })
  it("clears both chat and the computer when membership is revoked", async () => {
    mocks.getSharedBot.mockRejectedValue(new Error("Access revoked"))
    const view = render(
      createElement(SharedBotChat, {
        params: { ownerId: "owner", botId: "bot" },
        initial,
      })
    )
    fireEvent.click(view.getByRole("button", { name: "Computer" }))
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Access revoked")
    )
    expect(view.queryByText("Shared conversation")).toBeNull()
    expect(view.queryByRole("tab", { name: "Browser" })).toBeNull()
    expect(
      view.getByRole("button", { name: "Computer" }).hasAttribute("disabled")
    ).toBe(true)
  })
})
