import { beforeEach, describe, expect, it, vi } from "vitest"
import { runSharedWorkspace } from "./shared-workspace"
import { PRIVATE_BOT } from "@/lib/sharing"

const bot = {
  getLiveView: vi.fn(async () => []),
  getBrowserFrame: vi.fn(async () => null),
  navigateBrowser: vi.fn(async () => true),
  closeBrowser: vi.fn(async () => {}),
  getActivity: vi.fn(async () => []),
  readFileData: vi.fn(async () => ({ mediaType: "image/png", base64: "eA==" })),
  readFileText: vi.fn(async () => ({ content: "hello", truncated: false })),
  runCommand: vi.fn(async () => ({ stdout: "hello", stderr: "", exitCode: 0 })),
}
const member = { ...PRIVATE_BOT, isolated: true, emails: ["wife@test.com"] }
const operations = [
  [{ method: "getLiveView" }, "getLiveView", []],
  [
    { method: "getBrowserFrame", toolCallId: "frame" },
    "getBrowserFrame",
    ["frame"],
  ],
  [
    { method: "navigateBrowser", action: "reload" },
    "navigateBrowser",
    ["reload"],
  ],
  [{ method: "closeBrowser" }, "closeBrowser", []],
  [{ method: "getActivity", limit: 100 }, "getActivity", [100]],
  [
    { method: "readFileData", path: "inbox/photo.png" },
    "readFileData",
    ["/workspace/inbox/photo.png"],
  ],
  [
    { method: "readFileText", path: "notes.txt" },
    "readFileText",
    ["/workspace/notes.txt"],
  ],
  [
    { method: "runCommand", command: "echo hello" },
    "runCommand",
    ["echo hello"],
  ],
] as const
beforeEach(() => vi.clearAllMocks())

describe("member computer RPC boundary", () => {
  it.each(operations)(
    "dispatches %j only to its scoped operation",
    async (action, method, args) => {
      await runSharedWorkspace(bot, member, "wife@test.com", action)
      expect(bot[method]).toHaveBeenCalledWith(...args)
      for (const [name, fn] of Object.entries(bot))
        if (name !== method) expect(fn).not.toHaveBeenCalled()
    }
  )
  it.each(operations)("rejects revoked access before %j", async (action) => {
    await expect(
      runSharedWorkspace(bot, PRIVATE_BOT, "wife@test.com", action)
    ).rejects.toThrow("Access revoked")
    for (const fn of Object.values(bot)) expect(fn).not.toHaveBeenCalled()
  })
  it("rejects admin methods and traversal even if called directly over DO RPC", async () => {
    for (const action of [
      { method: "provideSecret" },
      { method: "readFileText", path: "/workspace/../secret" },
    ])
      await expect(
        runSharedWorkspace(bot, member, "wife@test.com", action)
      ).rejects.toThrow()
    for (const fn of Object.values(bot)) expect(fn).not.toHaveBeenCalled()
  })
})
