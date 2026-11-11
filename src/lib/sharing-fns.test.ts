import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  hub: {
    hasBot: vi.fn(),
    listBots: vi.fn(),
    sharedBotRefs: vi.fn(),
    hasSharedBotRef: vi.fn(),
  },
  bot: {
    isSharedWith: vi.fn(),
    sharedSnapshot: vi.fn(),
    sharedMessage: vi.fn(),
    sharedUpload: vi.fn(),
    sharedChoice: vi.fn(),
    sharedFiles: vi.fn(),
    sharedFile: vi.fn(),
    sharedWorkspace: vi.fn(),
  },
}))
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (v: unknown) => v
    const builder = {
      validator(fn: typeof validate) {
        validate = fn
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
      },
    }
    return builder
  },
}))
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://coworkers.test"),
}))
vi.mock("cloudflare:workers", () => ({
  env: { UserHub: "hub", BotAgent: "bot" },
}))
vi.mock("./auth", () => ({ identify: mocks.identify }))
vi.mock("agents", () => ({
  getAgentByName: (ns: string) =>
    Promise.resolve(ns === "bot" ? mocks.bot : mocks.hub),
}))
import {
  answerSharedBotChoice,
  downloadSharedBotFile,
  getSharedBot,
  listSharedBotFiles,
  listSharedBots,
  messageSharedBot,
  uploadSharedBotFile,
  callSharedBotWorkspace,
} from "./sharing-fns"

const ref = { ownerId: "owner", botId: "bot" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.identify.mockResolvedValue({ id: "wife", email: "wife@example.com" })
  mocks.hub.hasBot.mockResolvedValue(true)
  mocks.hub.hasSharedBotRef.mockResolvedValue(true)
  mocks.bot.isSharedWith.mockResolvedValue(true)
  mocks.bot.sharedSnapshot.mockResolvedValue({
    state: { name: "Shared bot" },
    messages: [],
    apps: [],
    memory: "Bot-local memory",
  })
  mocks.bot.sharedUpload.mockResolvedValue({ path: "/workspace/inbox/file" })
  mocks.bot.sharedFiles.mockResolvedValue(["inbox/file"])
  mocks.bot.sharedFile.mockResolvedValue({ base64: "eA==" })
})

describe("shared member server functions", () => {
  const operations = [
    () => getSharedBot({ data: ref }),
    () =>
      messageSharedBot({
        data: { ...ref, text: "Hi", requestId: crypto.randomUUID() },
      }),
    () =>
      uploadSharedBotFile({ data: { ...ref, name: "file", base64: "eA==" } }),
    () =>
      answerSharedBotChoice({
        data: { ...ref, toolCallId: "question", option: "Yes" },
      }),
    () => listSharedBotFiles({ data: ref }),
    () => downloadSharedBotFile({ data: { ...ref, path: "inbox/file" } }),
    ...[
      { method: "getLiveView" },
      { method: "getBrowserFrame", toolCallId: "frame" },
      { method: "navigateBrowser", action: "reload" },
      { method: "closeBrowser" },
      { method: "getActivity", limit: 100 },
      { method: "readFileData", path: "inbox/photo.png" },
      { method: "readFileText", path: "inbox/file" },
      { method: "runCommand", command: "ls /workspace" },
    ].map(
      (action) => () => callSharedBotWorkspace({ data: { ...ref, action } })
    ),
  ]
  it.each(operations.map((op, i) => [i, op] as const))(
    "checks membership on every operation %s",
    async (_i, operation) => {
      mocks.bot.isSharedWith.mockResolvedValue(false)
      await expect(operation()).rejects.toThrow("Access revoked")
      for (const method of [
        mocks.bot.sharedSnapshot,
        mocks.bot.sharedMessage,
        mocks.bot.sharedUpload,
        mocks.bot.sharedChoice,
        mocks.bot.sharedFiles,
        mocks.bot.sharedFile,
        mocks.bot.sharedWorkspace,
      ])
        expect(method).not.toHaveBeenCalled()
    }
  )
  it("requires a real signed-in email rather than the demo profile", async () => {
    mocks.identify.mockResolvedValue({ id: "demo", email: null })
    await expect(getSharedBot({ data: ref })).rejects.toThrow("Sign in")
    expect(mocks.hub.hasBot).not.toHaveBeenCalled()
  })
  it("does not create empty bot objects for unknown names", async () => {
    mocks.hub.hasBot.mockResolvedValue(false)
    await expect(getSharedBot({ data: ref })).rejects.toThrow("Bot not found")
    expect(mocks.bot.isSharedWith).not.toHaveBeenCalled()
  })
  it("rejects unknown owner references at the index before looking up their hub", async () => {
    mocks.hub.hasSharedBotRef.mockResolvedValue(false)
    await expect(getSharedBot({ data: ref })).rejects.toThrow("Access revoked")
    expect(mocks.hub.hasBot).not.toHaveBeenCalled()
  })
  it("passes the verified identity to the bot, never a client-supplied email", async () => {
    await getSharedBot({ data: { ...ref, email: "owner@example.com" } })
    expect(mocks.bot.sharedSnapshot).toHaveBeenCalledWith("wife@example.com")
  })
  it("passes computer operations through the verified member identity", async () => {
    await callSharedBotWorkspace({
      data: {
        ...ref,
        email: "owner@test.com",
        action: { method: "readFileText", path: "notes.txt" },
      },
    })
    expect(mocks.bot.sharedWorkspace).toHaveBeenCalledWith("wife@example.com", {
      method: "readFileText",
      path: "/workspace/notes.txt",
    })
  })
  it("serializes and releases DO result handles before returning computer data", async () => {
    const dispose = vi.fn()
    mocks.bot.sharedWorkspace.mockResolvedValue({
      stdout: "hello",
      stderr: "",
      exitCode: 0,
      [Symbol.dispose]: dispose,
    })
    expect(
      await callSharedBotWorkspace({
        data: {
          ...ref,
          action: { method: "runCommand", command: "echo hello" },
        },
      })
    ).toEqual({ stdout: "hello", stderr: "", exitCode: 0 })
    expect(dispose).toHaveBeenCalledOnce()
  })
  it("rejects admin calls and path traversal before any bot operation", async () => {
    for (const action of [
      { method: "setBotSharing" },
      { method: "readFileText", path: "../secret" },
    ]) {
      await expect(async () =>
        callSharedBotWorkspace({ data: { ...ref, action } })
      ).rejects.toThrow()
    }
    expect(mocks.bot.sharedWorkspace).not.toHaveBeenCalled()
  })
  it("omits stale/revoked discovery entries rather than trusting the index", async () => {
    mocks.hub.sharedBotRefs.mockResolvedValue([ref])
    mocks.hub.listBots.mockResolvedValue([{ id: "bot", name: "Hidden" }])
    mocks.bot.isSharedWith.mockResolvedValue(false)
    expect(await listSharedBots()).toEqual([])
    expect(mocks.bot.sharedSnapshot).not.toHaveBeenCalled()
  })
})
