import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { z } from "zod"
import { identify } from "./auth"
import { SHARING_DIRECTORY, sharedWorkspaceActionSchema } from "./sharing"
import { botInstanceName } from "./types"
import type { BotAgent } from "@/agents/bot-agent"
import type { UserHub } from "@/agents/user-hub"
import type { BotState, BotAppSummary } from "./types"

const refSchema = z.object({
  ownerId: z.string().min(1).max(254),
  botId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(100),
})

async function sharedBot(ref: z.infer<typeof refSchema>) {
  const viewer = await identify(getRequest())
  if (!viewer.email)
    throw new Error(
      "Sign in with your own account to use shared bots. Sharing is unavailable in demo mode."
    )
  const directory = await getAgentByName(
    env.UserHub as unknown as DurableObjectNamespace<UserHub>,
    SHARING_DIRECTORY
  )
  if (!(await directory.hasSharedBotRef(ref.ownerId, ref.botId, viewer.email)))
    throw new Error("Access revoked or not shared with you")
  const hub = await getAgentByName(
    env.UserHub as unknown as DurableObjectNamespace<UserHub>,
    ref.ownerId
  )
  if (!(await hub.hasBot(ref.botId))) throw new Error("Bot not found")
  const bot = await getAgentByName(
    env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
    botInstanceName(ref.ownerId, ref.botId)
  )
  if (!(await bot.isSharedWith(viewer.email)))
    throw new Error("Access revoked or not shared with you")
  return { bot, email: viewer.email }
}

export const listSharedBots = createServerFn().handler(async () => {
  const viewer = await identify(getRequest())
  if (!viewer.email) return []
  const directory = await getAgentByName(
    env.UserHub as unknown as DurableObjectNamespace<UserHub>,
    SHARING_DIRECTORY
  )
  const refs = await directory.sharedBotRefs(viewer.email)
  const results = []
  for (const ref of refs) {
    if (ref.ownerId === viewer.id) continue
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      ref.ownerId
    )
    const summary = (await hub.listBots()).find((b) => b.id === ref.botId)
    if (!summary) continue
    const bot = await getAgentByName(
      env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(ref.ownerId, ref.botId)
    )
    if (await bot.isSharedWith(viewer.email)) results.push({ ...ref, summary })
  }
  return results
})

export const getSharedBot = createServerFn()
  .validator((v: unknown) => refSchema.parse(v))
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    const { state, messages, apps, memory } = await bot.sharedSnapshot(email)
    return {
      state: JSON.parse(JSON.stringify(state)) as BotState,
      messagesJson: JSON.stringify(messages),
      apps: JSON.parse(JSON.stringify(apps)) as (BotAppSummary & {
        path: string
      })[],
      memory,
    }
  })

export const messageSharedBot = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    refSchema
      .extend({
        text: z.string().trim().min(1).max(32_000),
        requestId: z.string().uuid(),
      })
      .parse(v)
  )
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    await bot.sharedMessage(email, data.text, data.requestId)
  })

export const callSharedBotWorkspace = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    refSchema.extend({ action: sharedWorkspaceActionSchema }).parse(v)
  )
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    const result = await bot.sharedWorkspace(email, data.action)
    try {
      if (result === undefined) return
      // DO RPC results may carry disposable handles. Only plain data crosses
      // the server-function boundary into a member's browser.
      return JSON.parse(JSON.stringify(result)) as Exclude<
        Awaited<ReturnType<BotAgent["sharedWorkspace"]>>,
        void
      >
    } finally {
      if (result && typeof result === "object") result[Symbol.dispose]?.()
    }
  })

export const uploadSharedBotFile = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    refSchema
      .extend({
        name: z.string().min(1).max(120),
        base64: z.string().max(7_000_000),
      })
      .parse(v)
  )
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    const { path } = await bot.sharedUpload(email, data.name, data.base64)
    return { path }
  })

export const answerSharedBotChoice = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    refSchema
      .extend({
        toolCallId: z.string().min(1).max(200),
        option: z.string().min(1).max(2000),
      })
      .parse(v)
  )
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    await bot.sharedChoice(email, data.toolCallId, data.option)
  })

export const listSharedBotFiles = createServerFn()
  .validator((v: unknown) => refSchema.parse(v))
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    return [...(await bot.sharedFiles(email))]
  })

export const downloadSharedBotFile = createServerFn()
  .validator((v: unknown) =>
    refSchema.extend({ path: z.string().min(1).max(1000) }).parse(v)
  )
  .handler(async ({ data }) => {
    const { bot, email } = await sharedBot(data)
    const { base64 } = await bot.sharedFile(email, data.path)
    return { base64 }
  })
