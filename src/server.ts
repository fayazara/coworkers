import handler from "@tanstack/react-start/server-entry"
import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents"
import { Unauthorized, identify } from "@/lib/auth"
import { botInstanceName } from "@/lib/types"
import { handleAppRequest } from "./agents/apps-runtime"
import { emailDirectory } from "./agents/email-directory"
import { handleOAuthRequest } from "./mcp/oauth"
import type { BotAgent } from "./agents/bot-agent"
import type { UserHub } from "./agents/user-hub"

// Durable Objects and the classes their runtimes load by name.
export { BotAgent, WorkspaceServiceProxy } from "./agents/bot-agent"
export { UserHub } from "./agents/user-hub"
// Apps bots build: live fan-out, and `env.BOT` inside an app's server.js.
export { AppBinding, AppLive } from "./agents/apps-runtime"
// OAuth clients, grants and tokens for outside agents on /mcp.
export { OAuthStore } from "./mcp/oauth-store"
// Short email names (research@...) to the bot that owns them.
export { EmailDirectory } from "./agents/email-directory"
// Backs `browser_execute`: a durable Code Mode runtime in a DO facet.
export { CodemodeRuntime } from "agents/browser"

/** `/agents/<agent>/<instance>/...` → the instance name, URL-decoded. */
function agentInstance(pathname: string) {
  const [, prefix, agent, instance] = pathname.split("/")
  if (prefix !== "agents" || !agent || !instance) return null
  return { agent, instance: decodeURIComponent(instance) }
}

/** A user may only reach their own hub and their own bots. */
function ownsInstance(userId: string, agent: string, instance: string) {
  if (agent === "user-hub") return instance === userId
  if (agent === "bot-agent") return instance.startsWith(`${userId}:`)
  return false
}

export default {
  async fetch(request, env, ctx) {
    // Apps enforce their own authorization, including owner/email login and
    // explicit share capabilities, before the normal UI/agent routing.
    const app = await handleAppRequest(request, env)
    if (app) return app

    // Outside agents: OAuth and /mcp carry their own tokens. The consent
    // page among them checks Access itself.
    const oauth = await handleOAuthRequest(request, env, ctx)
    if (oauth) return oauth

    const target = agentInstance(new URL(request.url).pathname)
    if (target) {
      let userId: string
      try {
        userId = (await identify(request)).id
      } catch (err) {
        if (err instanceof Unauthorized) {
          return new Response("Unauthorized", { status: 401 })
        }
        throw err
      }
      if (!ownsInstance(userId, target.agent, target.instance)) {
        return new Response("Forbidden", { status: 403 })
      }
      // Agent WebSockets and agent HTTP (MCP OAuth callbacks).
      const response = await routeAgentRequest(request, env)
      if (response) return response
    }
    return handler.fetch(request)
  },

  /**
   * Email Routing delivers mail for EMAIL_DOMAIN here. A bot's address is
   * its short name, `research@EMAIL_DOMAIN` (the older
   * `<userId>.<botId>@EMAIL_DOMAIN` still works); anything else is rejected,
   * and so is mail for a bot that does not exist (looking it up would
   * create it).
   */
  async email(message, env) {
    const domain = env.EMAIL_DOMAIN?.trim().toLowerCase()
    const [local, host] = message.to.toLowerCase().split("@")
    if (!domain || host !== domain || !local) {
      message.setReject("Unknown address")
      return
    }
    let userId: string
    let botId: string
    const dot = local.lastIndexOf(".")
    if (dot > 0) {
      userId = local.slice(0, dot)
      botId = local.slice(dot + 1)
    } else {
      const owner = await emailDirectory(env).lookup(local)
      if (!owner) {
        message.setReject("Unknown address")
        return
      }
      ;({ userId, botId } = owner)
    }
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      userId
    )
    if (!(await hub.hasBot(botId))) {
      message.setReject("Unknown address")
      return
    }
    // Email is off for a bot until its owner turns it on. The reply is the
    // same as for an address that does not exist.
    const bot = await getAgentByName(
      env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
      botInstanceName(userId, botId)
    )
    if (!(await bot.acceptsEmail())) {
      message.setReject("Unknown address")
      return
    }
    await routeAgentEmail(message, env, {
      resolver: async () => ({
        agentName: "BotAgent",
        agentId: botInstanceName(userId, botId),
      }),
    })
  },
} satisfies ExportedHandler<Env>
