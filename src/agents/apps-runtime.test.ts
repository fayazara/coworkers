import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  accessConfigured: vi.fn(),
  bot: {
    appLink: vi.fn(),
    authorizeAppLink: vi.fn(),
    serveApp: vi.fn(),
    appTool: vi.fn(),
    appToolList: vi.fn(),
  },
  hub: { hasBot: vi.fn() },
  live: { fetch: vi.fn() },
}))
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  },
  WorkerEntrypoint: class {
    constructor(
      public ctx: unknown,
      public env: unknown
    ) {}
  },
}))
vi.mock("agents", () => ({
  getAgentByName: (_ns: unknown, name: string) =>
    Promise.resolve(name.includes(":") ? mocks.bot : mocks.hub),
}))
vi.mock("@/lib/auth", () => ({
  accessConfigured: mocks.accessConfigured,
  identify: mocks.identify,
  Unauthorized: class Unauthorized extends Error {},
}))
import { AppBinding, AppLive, handleAppRequest } from "./apps-runtime"
import { Unauthorized } from "@/lib/auth"

const env = {
  UserHub: {},
  BotAgent: {},
  AppLive: { getByName: () => mocks.live },
} as unknown as Env
const entry = "https://coworkers.test/apps/owner/bot/trip/private/"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.accessConfigured.mockReturnValue(true)
  mocks.hub.hasBot.mockResolvedValue(true)
  mocks.bot.appLink.mockResolvedValue({ token: "private", audience: "owner" })
  mocks.identify.mockRejectedValue(new Unauthorized("No token"))
  mocks.bot.authorizeAppLink.mockResolvedValue(null)
  mocks.bot.serveApp.mockResolvedValue(
    new Response("app", { headers: { "Content-Type": "text/html" } })
  )
  mocks.live.fetch.mockResolvedValue(new Response("socket"))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("app HTTP authorization boundary", () => {
  it("fails closed for private entries on an unprotected production deploy", async () => {
    vi.stubEnv("DEV", false)
    mocks.accessConfigured.mockReturnValue(false)
    mocks.identify.mockResolvedValue({ id: "owner", email: null })
    const response = await handleAppRequest(new Request(entry), env)
    expect(response?.status).toBe(401)
    expect(mocks.bot.serveApp).not.toHaveBeenCalled()
  })
  it.each([
    "",
    "index.html",
    "style.css",
    "_coworkers.js",
    "_bdots.js",
    "_data",
    "_data/items",
    "_tell",
    "_error",
    "_live",
    "api/custom",
  ])("protects %s before serving anything", async (path) => {
    const response = await handleAppRequest(new Request(entry + path), env)
    expect(response?.status).toBe(401)
    expect(mocks.bot.serveApp).not.toHaveBeenCalled()
    expect(mocks.live.fetch).not.toHaveBeenCalled()
  })
  it("redirects an authenticated entry to a no-store, short-lived app-scoped session", async () => {
    mocks.identify.mockResolvedValue({ id: "owner", email: "owner@test.com" })
    mocks.bot.authorizeAppLink.mockResolvedValue({
      token: "session",
      path: "/apps/owner/bot/trip/session/",
    })
    const response = await handleAppRequest(
      new Request(entry + "nested/page?q=1"),
      env
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get("Location")).toBe(
      "https://coworkers.test/apps/owner/bot/trip/session/nested/page?q=1"
    )
    expect(response?.headers.get("Cache-Control")).toBe("no-store")
  })
  it("rejects the wrong signed-in identity without serving the helper or app", async () => {
    mocks.identify.mockResolvedValue({
      id: "stranger",
      email: "stranger@test.com",
    })
    expect(
      (await handleAppRequest(new Request(entry + "_coworkers.js"), env))
        ?.status
    ).toBe(404)
    expect(mocks.bot.serveApp).not.toHaveBeenCalled()
  })
  it.each([
    ["annual%20report.html", "annual report.html"],
    ["reports/caf%C3%A9.html", "reports/café.html"],
    ["api/100%25", "api/100%"],
    ["literal%2520name.html", "literal%20name.html"],
    ["api/a%2Fb", "api/a/b"],
  ])(
    "preserves escaping through a private session redirect: %s",
    async (encoded, decoded) => {
      mocks.identify.mockResolvedValue({ id: "owner", email: "owner@test.com" })
      mocks.bot.authorizeAppLink.mockResolvedValue({
        token: "session",
        path: "/apps/owner/bot/trip/session/",
      })
      const response = await handleAppRequest(
        new Request(entry + encoded + "?q=a%20b"),
        env
      )
      const location = response!.headers.get("Location")!
      expect(location).toBe(
        "https://coworkers.test/apps/owner/bot/trip/session/" +
          encoded +
          "?q=a%20b"
      )
      mocks.bot.appLink.mockResolvedValue({
        token: "session",
        audience: "session",
      })
      await handleAppRequest(new Request(location), env)
      expect(mocks.bot.serveApp).toHaveBeenCalledWith(
        "trip",
        "session",
        decoded,
        expect.any(Request)
      )
    }
  )
  it("lets explicit public capabilities work without a human Access login", async () => {
    mocks.bot.appLink.mockResolvedValue({ token: "private", audience: "link" })
    mocks.bot.authorizeAppLink.mockResolvedValue({ token: "private" })
    const response = await handleAppRequest(new Request(entry), env)
    expect(response?.status).toBe(200)
    expect(mocks.identify).not.toHaveBeenCalled()
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(response?.headers.get("Content-Security-Policy")).toContain(
      "sandbox"
    )
  })
  it("denies revoked sessions before a WebSocket upgrade", async () => {
    mocks.bot.appLink.mockResolvedValue({
      token: "private",
      audience: "session",
    })
    expect(
      (
        await handleAppRequest(
          new Request(entry + "_live", { headers: { Upgrade: "websocket" } }),
          env
        )
      )?.status
    ).toBe(404)
    expect(mocks.live.fetch).not.toHaveBeenCalled()
  })
  it("forwards only server-verified capability metadata to AppLive", async () => {
    mocks.bot.appLink.mockResolvedValue({
      token: "private",
      audience: "session",
    })
    mocks.bot.authorizeAppLink.mockResolvedValue({
      token: "private",
      expiresAt: 12345,
    })
    await handleAppRequest(
      new Request(entry + "_live", {
        headers: {
          Upgrade: "websocket",
          "X-Coworkers-User": "attacker",
          "X-Coworkers-Expires": "9999999",
        },
      }),
      env
    )
    const forwarded = mocks.live.fetch.mock.calls[0]![0] as Request
    expect(forwarded.headers.get("X-Coworkers-User")).toBe("owner")
    expect(forwarded.headers.get("X-Coworkers-Expires")).toBe("12345")
  })
})

describe("app server connected-tool binding", () => {
  function binding(owner: boolean) {
    const caller = {
      label: owner ? "You" : "Guest",
      mode: "view" as const,
      token: "session",
      owner,
      canMessage: false,
    }
    const ctx = {
      props: { userId: "owner", botId: "bot", slug: "trip", caller },
    }
    return {
      caller,
      binding: new AppBinding(
        ctx as ConstructorParameters<typeof AppBinding>[0],
        env
      ),
    }
  }
  it.each([true, false])(
    "marks tool calls as server-side while retaining owner=%s and view-only permissions",
    async (owner) => {
      const fixture = binding(owner)
      mocks.bot.appTool.mockImplementation(async (_slug, caller) =>
        caller.server ? { value: ["available"] } : { error: "Access revoked" }
      )
      mocks.bot.appToolList.mockImplementation(async (_slug, caller) => {
        if (!caller.server) throw new Error("Access revoked")
        return [{ name: "calendar_read", allowed: true }]
      })
      await expect(
        fixture.binding.tool("calendar_read", { day: "Monday" })
      ).resolves.toEqual(["available"])
      await expect(fixture.binding.tools()).resolves.toEqual([
        { name: "calendar_read", allowed: true },
      ])
      expect(mocks.bot.appTool).toHaveBeenCalledWith(
        "trip",
        { ...fixture.caller, server: true },
        "calendar_read",
        { day: "Monday" }
      )
      expect(mocks.bot.appToolList).toHaveBeenCalledWith("trip", {
        ...fixture.caller,
        server: true,
      })
      expect(fixture.caller).not.toHaveProperty("server")
      expect(fixture.binding.caller()).toEqual({
        label: fixture.caller.label,
        mode: "view",
        canMessage: false,
      })
    }
  )
  it("propagates revoked access and denied writes from the authorization boundary", async () => {
    const fixture = binding(false)
    mocks.bot.appTool.mockResolvedValue({
      error: "This link is view-only",
      status: 403,
    })
    await expect(fixture.binding.tool("calendar_write")).rejects.toThrow(
      "This link is view-only"
    )
    mocks.bot.appToolList.mockRejectedValue(new Error("Access revoked"))
    await expect(fixture.binding.tools()).rejects.toThrow("Access revoked")
  })
})

describe("live app authorization", () => {
  function liveFixture(expiresAt = Date.now() + 10000) {
    vi.stubGlobal("WebSocketRequestResponsePair", class {})
    const ws = {
      deserializeAttachment: () => ({
        userId: "owner",
        botId: "bot",
        slug: "trip",
        token: "session",
        expiresAt,
      }),
      send: vi.fn(),
      close: vi.fn(),
    }
    const ctx = {
      setWebSocketAutoResponse: vi.fn(),
      getWebSockets: () => [ws],
      storage: { setAlarm: vi.fn(), getAlarm: vi.fn() },
    }
    return {
      live: new AppLive(ctx as unknown as DurableObjectState, env),
      ws,
      ctx,
    }
  }
  it("rechecks the authoritative grant before broadcasting new data", async () => {
    const { live, ws } = liveFixture()
    await live.broadcast({ type: "change", collection: "items" })
    expect(ws.send).not.toHaveBeenCalled()
    expect(ws.close).toHaveBeenCalledWith(4001, "Access revoked")
    mocks.bot.authorizeAppLink.mockResolvedValue({ token: "session" })
    await live.broadcast({ type: "change", collection: "items" })
    expect(ws.send).toHaveBeenCalledOnce()
  })
  it("closes expired sessions even when there are no broadcasts", async () => {
    const { live, ws } = liveFixture(Date.now() - 1)
    await live.alarm()
    expect(ws.close).toHaveBeenCalledWith(
      4001,
      "Session expired; reopen the private app"
    )
  })
  it("retains an alarm for unexpired sessions after waking", async () => {
    const expiry = Date.now() + 10000
    const { live, ctx } = liveFixture(expiry)
    await live.alarm()
    expect(ctx.storage.setAlarm).toHaveBeenCalledWith(expiry)
  })
  it("disconnects only the revoked link's viewers", () => {
    const { live, ws, ctx } = liveFixture()
    const getWebSockets = vi.spyOn(ctx, "getWebSockets")
    live.disconnect("session")
    expect(getWebSockets).toHaveBeenCalledWith("session")
    expect(ws.close).toHaveBeenCalledWith(4001, "Link revoked")
  })
})
