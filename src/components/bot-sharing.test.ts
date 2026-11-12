// @vitest-environment jsdom
import { createElement } from "react"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BotSharing } from "@/lib/sharing"

const mocks = vi.hoisted(() => {
  const stub = { getBotSharing: vi.fn(), setBotSharing: vi.fn() }
  return { stub, agent: { stub }, connections: [{ id: "mail", name: "Mail" }] }
})
vi.mock("@/lib/bot-context", () => ({
  useBot: () => ({ agent: mocks.agent, botId: "trip" }),
}))
vi.mock("@/lib/hub-context", () => ({
  useHub: () => ({
    viewer: { id: "owner", email: "owner@test.com" },
    state: { connections: mocks.connections },
  }),
}))
import { BotSharingSettings } from "./bot-sharing"

let stored: BotSharing
beforeEach(() => {
  vi.resetAllMocks()
  stored = { emails: [], workspace: false, connectionIds: [], isolated: false }
  mocks.stub.getBotSharing.mockImplementation(async () => stored)
  mocks.stub.setBotSharing.mockImplementation(
    async (input: Omit<BotSharing, "isolated">) => {
      stored = {
        ...input,
        isolated: stored.isolated || input.workspace || input.emails.length > 0,
      }
      return stored
    }
  )
})
afterEach(cleanup)

async function openSettings() {
  const view = render(createElement(BotSharingSettings))
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Add" })).toBeTruthy()
  )
  return view
}

describe("simple sharing settings", () => {
  it("uses a switch and has no consent checkbox or save step", async () => {
    const view = await openSettings()
    expect(
      view.getByRole("switch", { name: "Share with everyone who can sign in" })
    ).toBeTruthy()
    expect(view.queryByRole("checkbox")).toBeNull()
    expect(view.queryByText(/I understand/)).toBeNull()
    expect(view.queryByRole("button", { name: "Save sharing" })).toBeNull()
  })
  it("saves the everyone switch immediately without an acknowledgement", async () => {
    const view = await openSettings()
    fireEvent.click(
      view.getByRole("switch", { name: "Share with everyone who can sign in" })
    )
    await waitFor(() =>
      expect(mocks.stub.setBotSharing).toHaveBeenCalledWith({
        emails: [],
        workspace: true,
        connectionIds: [],
      })
    )
  })
  it("adds an email directly", async () => {
    const view = await openSettings()
    fireEvent.change(
      view.getByRole("textbox", { name: "Email to share with" }),
      { target: { value: "WIFE@EXAMPLE.COM" } }
    )
    fireEvent.click(view.getByRole("button", { name: "Add" }))
    await waitFor(() =>
      expect(mocks.stub.setBotSharing).toHaveBeenCalledWith({
        emails: ["wife@example.com"],
        workspace: false,
        connectionIds: [],
      })
    )
    await waitFor(() => expect(view.getByText("wife@example.com")).toBeTruthy())
  })
  it("removes an invitation directly without a confirmation dialog", async () => {
    stored = { ...stored, emails: ["wife@example.com"], isolated: true }
    const view = await openSettings()
    fireEvent.click(view.getByRole("button", { name: "Remove" }))
    await waitFor(() =>
      expect(mocks.stub.setBotSharing).toHaveBeenCalledWith({
        emails: [],
        workspace: false,
        connectionIds: [],
      })
    )
    expect(view.queryByRole("dialog")).toBeNull()
  })
  it("uses an immediately saved switch for connected accounts too", async () => {
    stored = { ...stored, isolated: true }
    const view = await openSettings()
    fireEvent.click(
      view.getByRole("switch", { name: "Share Mail with this bot" })
    )
    await waitFor(() =>
      expect(mocks.stub.setBotSharing).toHaveBeenCalledWith({
        emails: [],
        workspace: false,
        connectionIds: ["mail"],
      })
    )
    expect(view.queryByRole("checkbox")).toBeNull()
  })
  it("restores the switch and shows an error when saving fails", async () => {
    mocks.stub.setBotSharing.mockRejectedValue(new Error("Could not save"))
    const view = await openSettings()
    const toggle = view.getByRole("switch", {
      name: "Share with everyone who can sign in",
    })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Could not save")
    )
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })
})
