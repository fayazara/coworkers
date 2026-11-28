import { describe, expect, it } from "vitest"
import {
  PRIVATE_BOT,
  appSharingSchema,
  appOperationDenied,
  blockedForSharedBot,
  botSharingSchema,
  canUseAppLink,
  isBotMember,
  sharedConnectionRule,
  sharedWorkspaceActionSchema,
} from "./sharing"

describe("bot membership", () => {
  it("is private by default, even for an authenticated workspace user", () => {
    expect(isBotMember(PRIVATE_BOT, "wife@example.com")).toBe(false)
  })
  it("matches verified email addresses, not colliding user-id slugs", () => {
    const sharing = { ...PRIVATE_BOT, emails: ["a.b@example.com"] }
    expect(isBotMember(sharing, "A.B@EXAMPLE.COM")).toBe(true)
    expect(isBotMember(sharing, "a+b@example.com")).toBe(false)
    expect(isBotMember(sharing, null)).toBe(false)
  })
  it("requires an authenticated identity for workspace-wide sharing", () => {
    expect(isBotMember({ ...PRIVATE_BOT, workspace: true }, null)).toBe(false)
    expect(
      isBotMember({ ...PRIVATE_BOT, workspace: true }, "member@example.com")
    ).toBe(true)
  })
  it("validates invites and connection allowlists without a consent gate", () => {
    expect(botSharingSchema.safeParse({ emails: ["bad"] }).success).toBe(false)
    expect(botSharingSchema.parse({ emails: [] })).toEqual({
      emails: [],
      workspace: false,
      connectionIds: [],
    })
    expect(
      botSharingSchema.parse({
        emails: [" WIFE@EXAMPLE.COM "],
      }).emails
    ).toEqual(["wife@example.com"])
  })
})

describe("independent app permissions", () => {
  it.each(["put", "remove", "tell", "error"])(
    "rejects %s on default view-only links",
    (op) => {
      expect(appOperationDenied({ mode: "view" }, op)).not.toBeNull()
    }
  )
  it.each(["info", "list", "get"])(
    "allows %s without messaging or editing",
    (op) => {
      expect(appOperationDenied({ mode: "view" }, op)).toBeNull()
    }
  )
  it("editing never implicitly enables messaging, and messaging never enables editing", () => {
    expect(appOperationDenied({ mode: "edit" }, "put")).toBeNull()
    expect(appOperationDenied({ mode: "edit" }, "tell")).not.toBeNull()
    expect(
      appOperationDenied({ mode: "view", canMessage: true }, "tell")
    ).toBeNull()
    expect(
      appOperationDenied({ mode: "view", canMessage: true }, "put")
    ).not.toBeNull()
  })
})

describe("app authorization", () => {
  it("requires owner or explicit bot membership for private entry URLs", () => {
    expect(canUseAppLink({ audience: "owner" }, null, false, false)).toBe(false)
    expect(
      canUseAppLink({ audience: "owner" }, "other@test.com", false, false)
    ).toBe(false)
    expect(
      canUseAppLink({ audience: "owner" }, "owner@test.com", true, false)
    ).toBe(true)
    expect(
      canUseAppLink({ audience: "owner" }, "wife@test.com", false, true)
    ).toBe(true)
  })
  it("does not let owning the bot bypass another recipient's email restriction", () => {
    const link = { audience: "email", email: "guest@test.com" }
    expect(canUseAppLink(link, "owner@test.com", true, false)).toBe(false)
    expect(canUseAppLink(link, null, false, false)).toBe(false)
    expect(canUseAppLink(link, "GUEST@TEST.COM", false, false)).toBe(true)
  })
  it("allows explicitly created secret links without login but rejects unknown policies", () => {
    expect(canUseAppLink({ audience: "link" }, null, false, false)).toBe(true)
    expect(canUseAppLink({ audience: "corrupt" }, null, true, true)).toBe(false)
  })
  it("expires sessions at the boundary", () => {
    expect(
      canUseAppLink(
        { audience: "session", expiresAt: 1000 },
        null,
        false,
        false,
        999
      )
    ).toBe(true)
    expect(
      canUseAppLink(
        { audience: "session", expiresAt: 1000 },
        null,
        false,
        false,
        1000
      )
    ).toBe(false)
  })
  it("keeps messaging off by default and requires an email for restricted links", () => {
    expect(appSharingSchema.parse({})).toEqual({
      audience: "link",
      canMessage: false,
    })
    expect(appSharingSchema.safeParse({ audience: "email" }).success).toBe(
      false
    )
    expect(appSharingSchema.safeParse({ audience: "owner" }).success).toBe(
      false
    )
  })
})

describe("shared-bot private context boundary", () => {
  it("forces owner approval for writes and never overrides block, even in the background", () => {
    expect(sharedConnectionRule("allow", true, false, false)).toBe("ask")
    expect(sharedConnectionRule("block", true, false, false)).toBe("block")
    expect(sharedConnectionRule("allow", true, false, true)).toBe("block")
    expect(sharedConnectionRule("ask", true, false, true)).toBe("block")
    expect(sharedConnectionRule("allow", true, true, false)).toBe("allow")
    expect(sharedConnectionRule("allow", false, false, false)).toBe("allow")
  })
  it.each([
    "request_secret",
    "secret_request",
    "remember_for_all_bots",
    "set_name",
    "delete_app",
  ])("blocks %s independently of owner rules", (name) => {
    expect(blockedForSharedBot(name)).toBe(true)
  })
  it.each(["bots", "manage", "routines", "email"])(
    "blocks %s actions",
    (cls) => {
      expect(blockedForSharedBot("tool", cls)).toBe(true)
    }
  )
  it("keeps bot-local memory, files, public web reads, and app testing available", () => {
    for (const [name, cls] of [
      ["remember", undefined],
      ["write", "files"],
      ["browser_extract", "browse"],
      ["browser_execute", "browser"],
      ["app_fetch", undefined],
    ])
      expect(blockedForSharedBot(name!, cls)).toBe(false)
  })
})

describe("member computer operations", () => {
  it.each([
    "setBotSharing",
    "provideSecret",
    "answerApproval",
    "setModel",
    "deleteApp",
    "createAppLink",
  ])("does not expose %s", (method) => {
    expect(sharedWorkspaceActionSchema.safeParse({ method }).success).toBe(
      false
    )
  })
  it.each([
    "../secret",
    "/etc/passwd",
    "/workspace/../secret",
    "inbox/../../secret",
    "inbox\\secret",
    "inbox/./secret",
    "\u0000",
  ])("rejects non-workspace paths: %s", (path) => {
    expect(
      sharedWorkspaceActionSchema.safeParse({ method: "readFileText", path })
        .success
    ).toBe(false)
    expect(
      sharedWorkspaceActionSchema.safeParse({ method: "readFileData", path })
        .success
    ).toBe(false)
  })
  it("accepts relative and absolute workspace paths and survives repeated validation", () => {
    for (const path of ["inbox/photo.png", "/workspace/inbox/photo.png"]) {
      const action = sharedWorkspaceActionSchema.parse({
        method: "readFileData",
        path,
      })
      expect(action).toMatchObject({ path: "/workspace/inbox/photo.png" })
      expect(sharedWorkspaceActionSchema.parse(action)).toEqual(action)
    }
  })
  it("bounds activity and command inputs", () => {
    for (const limit of [0, -1, 201, 1.5])
      expect(
        sharedWorkspaceActionSchema.safeParse({ method: "getActivity", limit })
          .success
      ).toBe(false)
    expect(
      sharedWorkspaceActionSchema.parse({ method: "getActivity" })
    ).toEqual({ method: "getActivity", limit: 200 })
    expect(
      sharedWorkspaceActionSchema.safeParse({
        method: "runCommand",
        command: " ",
      }).success
    ).toBe(false)
    expect(
      sharedWorkspaceActionSchema.safeParse({
        method: "runCommand",
        command: "x".repeat(32_001),
      }).success
    ).toBe(false)
    expect(
      sharedWorkspaceActionSchema.safeParse({
        method: "navigateBrowser",
        action: "execute",
      }).success
    ).toBe(false)
  })
})
