import { describe, expect, it, vi } from "vitest"
import { DEFAULT_RULES } from "@/lib/types"
import { accessCeiling, capRules, rulesCeiling, runOperation } from "./access"
import {
  createBot,
  deleteBot,
  delegateTask,
  delegateTaskFromClient,
  listBots,
  messageBot,
  messageBotFromClient,
  pauseBot,
  readBot,
  taskStatus,
  updateBot,
} from "./bots"
import { installSkill } from "./skills"
import { runAsUser, visibleTo } from "./operations"
import type { BotPort, Caller, HubPort, OperationContext } from "./operation"

function botCaller(patch: Partial<Extract<Caller, { kind: "bot" }>> = {}) {
  return {
    kind: "bot",
    botId: "b1",
    level: "act",
    rules: { ...DEFAULT_RULES },
    hops: 1,
    background: false,
    ...patch,
  } satisfies Caller
}

function fakeHub(patch: Partial<HubPort> = {}): HubPort {
  return {
    hasBot: vi.fn(async () => true),
    installedFrom: vi.fn(async () => []),
    listBots: vi.fn(async () => []),
    readBot: vi.fn(async () => null),
    addBot: vi.fn(async () => ({
      id: "n1",
      name: "New bot",
      avatar: "coral-circle" as const,
      status: "idle" as const,
      preview: "",
      updatedAt: 0,
      unread: false,
    })),
    setPaused: vi.fn(async () => true),
    messageFromClient: vi.fn(async () => ({
      delivered: true as const,
      to: "Ada",
      botId: "b9",
    })),
    delegateFromClient: vi.fn(async () => ({
      delivered: true as const,
      to: "Ada",
      botId: "b9",
    })),
    clientTask: vi.fn(async () => null),
    removeBot: vi.fn(async () => {}),
    configureBot: vi.fn(async () => true),
    relayMessage: vi.fn(async () => ({
      delivered: true as const,
      to: "Ada",
      botId: "b9",
    })),
    delegateTask: vi.fn(async () => ({
      delivered: true as const,
      to: "Ada",
      botId: "b9",
    })),
    ...patch,
  }
}

function fakeSelf(): BotPort {
  return {
    readAttachments: vi.fn(async () => ({ files: [] })),
    openDelegation: vi.fn(),
    confirmDelegation: vi.fn(),
    dropDelegation: vi.fn(),
  }
}

function ctx(patch: Partial<OperationContext> = {}): OperationContext {
  return {
    caller: botCaller(),
    requestId: "call_1",
    approved: false,
    hub: fakeHub(),
    self: fakeSelf(),
    ...patch,
  }
}

describe("runOperation", () => {
  it("refuses callers the operation is not for", async () => {
    const result = await runOperation(
      messageBot,
      ctx({ caller: { kind: "user" } }),
      { to: "Ada", message: "hi" }
    )
    expect(result).toMatchObject({ ok: false, code: "unavailable" })
  })

  it("refuses callers below the operation's level", async () => {
    const hub = fakeHub()
    const result = await runOperation(updateBot, ctx({ hub }), {
      bot: "b2",
      name: "Ada",
    })
    expect(result).toMatchObject({ ok: false, code: "denied" })
    expect(hub.configureBot).not.toHaveBeenCalled()
  })

  it("refuses input that does not match the schema", async () => {
    const result = await runOperation(messageBot, ctx(), { to: "Ada" })
    expect(result).toMatchObject({ ok: false, code: "invalid" })
  })

  it("asks before destructive operations, except for the user", async () => {
    const manager = botCaller({ level: "manage" })
    const hub = fakeHub()
    expect(
      await runOperation(deleteBot, ctx({ caller: manager, hub }), {
        bot: "b2",
      })
    ).toMatchObject({ ok: false, code: "needs_approval" })
    expect(hub.removeBot).not.toHaveBeenCalled()

    expect(
      await runOperation(
        deleteBot,
        ctx({ caller: manager, hub, approved: true }),
        { bot: "coworkers://bot/b2" }
      )
    ).toEqual({ deleted: true, bot: "b2" })

    await runAsUser(deleteBot, { hub }, { bot: "b3" })
    expect(hub.removeBot).toHaveBeenCalledWith("b3")
  })

  it("holds bots to their own rules", async () => {
    const manager = botCaller({
      level: "manage",
      rules: { ...DEFAULT_RULES, apps: "ask" },
    })
    const hub = fakeHub()
    expect(
      await runOperation(updateBot, ctx({ caller: manager, hub }), {
        bot: "b2",
        rules: { apps: "allow" },
      })
    ).toMatchObject({ ok: false, code: "ceiling" })
    expect(
      await runOperation(updateBot, ctx({ caller: manager, hub }), {
        bot: "b2",
        rules: { apps: "block" },
      })
    ).toEqual({ updated: true, link: "coworkers://bot/b2" })
  })

  it("lets no bot give more access than it has", async () => {
    const reader = botCaller({ level: "act" })
    expect(accessCeiling(reader, "manage")).toMatchObject({ code: "ceiling" })
    expect(accessCeiling(reader, "act")).toBeNull()
    expect(accessCeiling({ kind: "user" }, "manage")).toBeNull()
    expect(
      await runOperation(
        updateBot,
        ctx({ caller: botCaller({ level: "manage" }) }),
        { bot: "b2", access: "manage" }
      )
    ).toEqual({ updated: true, link: "coworkers://bot/b2" })
  })
})

describe("rulesCeiling", () => {
  it("never limits the user", () => {
    expect(rulesCeiling({ kind: "user" }, { shell: "allow" })).toBeNull()
  })

  it("names every looser class", () => {
    const caller = botCaller({
      rules: { ...DEFAULT_RULES, shell: "block", apps: "ask" },
    })
    expect(
      rulesCeiling(caller, { shell: "ask", apps: "allow", files: "allow" })
    ).toMatchObject({
      code: "ceiling",
      error: expect.stringContaining("shell, apps"),
    })
  })
})

describe("runAsUser", () => {
  it("turns a refusal into an error", async () => {
    await expect(
      runAsUser(updateBot, { hub: fakeHub() }, { bot: "b1", model: "nope" })
    ).rejects.toThrow('"nope" is not a model id.')
  })

  it("reports a missing bot", async () => {
    const hub = fakeHub({ configureBot: vi.fn(async () => false) })
    await expect(
      runAsUser(updateBot, { hub }, { bot: "gone", name: "Ada" })
    ).rejects.toThrow('No bot with id "gone".')
  })
})

describe("installSkill", () => {
  const ctx = (hub: HubPort, approved: boolean): OperationContext => ({
    caller: botCaller(),
    requestId: "r1",
    approved,
    hub,
  })
  const input = { source: "owner/repo" }

  it("never runs without the card", async () => {
    const hub = fakeHub()
    expect(
      await runOperation(installSkill, ctx(hub, false), input)
    ).toMatchObject({ code: "needs_approval" })
    expect(hub.installedFrom).not.toHaveBeenCalled()
  })

  it("reports what the user installed, and nothing else", async () => {
    expect(
      await runOperation(
        installSkill,
        ctx(fakeHub({ installedFrom: async () => ["one"] }), true),
        input
      )
    ).toMatchObject({ installed: ["one"] })
    expect(
      await runOperation(installSkill, ctx(fakeHub(), true), input)
    ).toMatchObject({ ok: false, error: "The user did not install it." })
  })

  it("is not offered to outside agents or read-only bots", () => {
    const names = (caller: Caller) => visibleTo(caller).map((op) => op.name)
    expect(
      names({ kind: "client", clientId: "c", label: "c", level: "manage" })
    ).not.toContain("install_skill")
    expect(names(botCaller({ level: "read" }))).not.toContain("install_skill")
  })
})

describe("visibleTo", () => {
  it("shows a bot only what its kind and level allow", () => {
    expect(visibleTo(botCaller()).map((op) => op.name)).toEqual([
      "message_bot",
      "delegate_task",
      "list_bots",
      "read_bot",
      "install_skill",
    ])
    expect(
      visibleTo(botCaller({ level: "manage" })).map((op) => op.name)
    ).toEqual([
      "message_bot",
      "delegate_task",
      "list_bots",
      "read_bot",
      "create_bot",
      "update_bot",
      "pause_bot",
      "resume_bot",
      "delete_bot",
      "install_skill",
    ])
    expect(visibleTo({ kind: "user" }).map((op) => op.name)).toEqual([
      "list_bots",
      "read_bot",
      "create_bot",
      "update_bot",
      "pause_bot",
      "resume_bot",
      "delete_bot",
    ])
  })
})

describe("message_bot", () => {
  it("stops a chain past the hop limit", async () => {
    const hub = fakeHub()
    const result = await runOperation(
      messageBot,
      ctx({ caller: botCaller({ hops: 7 }), hub }),
      { to: "Ada", message: "hi" }
    )
    expect(result).toMatchObject({ ok: false, code: "hop_limit" })
    expect(hub.relayMessage).not.toHaveBeenCalled()
  })

  it("keys the delivery on the request", async () => {
    const hub = fakeHub()
    const result = await runOperation(messageBot, ctx({ hub }), {
      to: "Ada",
      message: "hi",
    })
    expect(hub.relayMessage).toHaveBeenCalledWith("b1", "Ada", "hi", {
      key: "bot:b1:call_1",
      hops: 1,
    })
    expect(result).toEqual({
      delivered: true,
      to: "Ada",
      link: "coworkers://bot/b9",
    })
  })

  it("passes the hub's refusal on with its code", async () => {
    const hub = fakeHub({
      relayMessage: vi.fn(async () => ({
        delivered: false as const,
        code: "not_found" as const,
        error: 'No bot named "Zed".',
      })),
    })
    expect(
      await runOperation(messageBot, ctx({ hub }), { to: "Zed", message: "hi" })
    ).toEqual({ ok: false, code: "not_found", error: 'No bot named "Zed".' })
  })
})

describe("delegate_task", () => {
  it("derives the task id from the request and records it", async () => {
    const self = fakeSelf()
    const result = await runOperation(
      delegateTask,
      ctx({ requestId: "call_abc-123", self }),
      { to: "ada", task: "Find the invoice" }
    )
    expect(result).toMatchObject({
      delegated: true,
      to: "Ada",
      link: "coworkers://bot/b9",
      taskId: "tcallabc123",
    })
    expect(self.openDelegation).toHaveBeenCalledWith({
      taskId: "tcallabc123",
      to: "ada",
      task: "Find the invoice",
      hops: 1,
      background: false,
    })
    expect(self.confirmDelegation).toHaveBeenCalledWith("tcallabc123", "Ada")
  })

  it("forgets the task when the hub refuses it", async () => {
    const self = fakeSelf()
    const hub = fakeHub({
      delegateTask: vi.fn(async () => ({
        delivered: false as const,
        code: "invalid" as const,
        error: "A bot cannot message itself",
      })),
    })
    const result = await runOperation(delegateTask, ctx({ self, hub }), {
      to: "b1",
      task: "Loop",
    })
    expect(result).toMatchObject({ ok: false, code: "invalid" })
    expect(self.dropDelegation).toHaveBeenCalled()
    expect(self.confirmDelegation).not.toHaveBeenCalled()
  })
})

describe("create_bot", () => {
  it("caps a bot-made bot's defaults at its creator's rules", async () => {
    const hub = fakeHub()
    const manager = botCaller({
      level: "manage",
      rules: { ...DEFAULT_RULES, shell: "ask", browser: "block" },
    })
    const result = await runOperation(
      createBot,
      ctx({ caller: manager, hub }),
      { name: "Scout", role: "Finds leads", rules: { files: "ask" } }
    )
    expect(result).toMatchObject({
      created: true,
      bot: { id: "n1", name: "Scout" },
      link: "coworkers://bot/n1",
    })
    expect(hub.configureBot).toHaveBeenCalledWith("n1", {
      name: "Scout",
      role: "Finds leads",
      rules: {
        ...DEFAULT_RULES,
        shell: "ask",
        browser: "block",
        files: "ask",
      },
    })
  })

  it("leaves a user-made bot alone when nothing is set", async () => {
    const hub = fakeHub()
    await runAsUser(createBot, { hub }, {})
    expect(hub.configureBot).not.toHaveBeenCalled()
  })
})

describe("capRules", () => {
  it("keeps the stricter policy per class", () => {
    expect(
      capRules(
        { ...DEFAULT_RULES, shell: "allow", apps: "block" },
        { ...DEFAULT_RULES, shell: "ask", apps: "allow" }
      )
    ).toMatchObject({ shell: "ask", apps: "block" })
  })
})

describe("pause_bot", () => {
  it("will not let a bot pause itself", async () => {
    const hub = fakeHub()
    expect(
      await runOperation(
        pauseBot,
        ctx({ caller: botCaller({ level: "manage" }), hub }),
        { bot: "b1" }
      )
    ).toMatchObject({ ok: false, code: "invalid" })
    expect(hub.setPaused).not.toHaveBeenCalled()
  })

  it("pauses another bot by link", async () => {
    const hub = fakeHub()
    expect(
      await runOperation(
        pauseBot,
        ctx({ caller: botCaller({ level: "manage" }), hub }),
        { bot: "coworkers://bot/b2" }
      )
    ).toEqual({ paused: true, link: "coworkers://bot/b2" })
    expect(hub.setPaused).toHaveBeenCalledWith("b2", true)
  })
})

describe("list_bots and read_bot", () => {
  it("lists bots with links and defaults", async () => {
    const hub = fakeHub({
      listBots: vi.fn(async () => [
        {
          id: "b2",
          name: "Ada",
          avatar: "coral-circle" as const,
          status: "idle" as const,
          preview: "",
          updatedAt: 0,
          unread: false,
          paused: true,
        },
      ]),
    })
    expect(await runOperation(listBots, ctx({ hub }), {})).toEqual({
      bots: [
        {
          name: "Ada",
          link: "coworkers://bot/b2",
          role: "",
          status: "idle",
          paused: true,
          access: "act",
        },
      ],
    })
  })

  it("reports a bot that is not there", async () => {
    expect(await runOperation(readBot, ctx(), { bot: "gone" })).toMatchObject({
      ok: false,
      code: "not_found",
    })
  })
})

describe("outside agents", () => {
  const agent = (level: "read" | "act" | "manage" = "act") =>
    ({ kind: "client", clientId: "cl1", label: "Claude Code", level }) as const

  it("see only their own tools, and nothing destructive", () => {
    expect(visibleTo(agent("read")).map((op) => op.name)).toEqual([
      "list_bots",
      "read_bot",
    ])
    expect(visibleTo(agent("manage")).map((op) => op.name)).toEqual([
      "message_bot",
      "delegate_task",
      "task_status",
      "list_bots",
      "read_bot",
      "create_bot",
      "update_bot",
      "pause_bot",
      "resume_bot",
    ])
  })

  it("cannot loosen rules past the defaults", async () => {
    expect(
      await runOperation(updateBot, ctx({ caller: agent("manage") }), {
        bot: "b2",
        rules: { apps: "allow" },
      })
    ).toMatchObject({ ok: false, code: "ceiling" })
  })

  it("get the same task back on a retry", async () => {
    const hub = fakeHub()
    const input = { to: "Ada", task: "Sum it up", clientRequestId: "r1" }
    const first = await runOperation(
      delegateTaskFromClient,
      ctx({ caller: agent(), hub }),
      input
    )
    const second = await runOperation(
      delegateTaskFromClient,
      ctx({ caller: agent(), hub }),
      input
    )
    expect(first).toMatchObject({ delegated: true, link: "coworkers://bot/b9" })
    expect((first as { taskId: string }).taskId).toBe(
      (second as { taskId: string }).taskId
    )
    expect(hub.delegateFromClient).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "cl1", label: "Claude Code" }),
      "Ada",
      "Sum it up",
      (first as { taskId: string }).taskId
    )
  })

  it("message a bot with a stable key", async () => {
    const hub = fakeHub()
    await runOperation(messageBotFromClient, ctx({ caller: agent(), hub }), {
      to: "Ada",
      message: "hi",
      clientRequestId: "r2",
    })
    expect(hub.messageFromClient).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "cl1" }),
      "Ada",
      "hi",
      "client:cl1:r2"
    )
  })

  it("read a finished task", async () => {
    const hub = fakeHub({
      clientTask: vi.fn(async () => ({
        id: "c1",
        botId: "b9",
        botName: "Ada",
        status: "done" as const,
        result: "Here it is",
        error: null,
        createdAt: 0,
        finishedAt: 1,
      })),
    })
    expect(
      await runOperation(taskStatus, ctx({ caller: agent(), hub }), {
        taskId: "c1",
      })
    ).toEqual({
      taskId: "c1",
      status: "done",
      bot: { name: "Ada", link: "coworkers://bot/b9" },
      result: "Here it is",
    })
  })

  it("are told about a task that is not theirs", async () => {
    expect(
      await runOperation(taskStatus, ctx({ caller: agent() }), {
        taskId: "nope",
      })
    ).toMatchObject({ ok: false, code: "not_found" })
  })
})
