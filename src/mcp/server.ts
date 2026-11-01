import { createMcpHandler } from "agents/mcp/server"
import { McpServer } from "@modelcontextprotocol/server"
import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider"
import { runOperation } from "@/control/access"
import { LEVEL_RANK, isFailure } from "@/control/operation"
import type { Caller, HubPort } from "@/control/operation"
import { visibleTo } from "@/control/operations"
import type { AccessLevel } from "@/lib/types"
import type { UserHub } from "@/agents/user-hub"
import { levelOfScopes } from "./scopes"
import type { McpProps } from "./scopes"

/**
 * `/mcp` for one signed-in outside agent: the shared operations its access
 * level allows, as MCP tools. A read-only agent never even sees a write.
 * Operations run here in the Worker, against the user's hub over DO RPC.
 */
export async function serveMcp(
  request: Request,
  env: Env,
  ctx: OAuthResourceContext<McpProps>
) {
  const { props, auth } = ctx
  // The token can carry less than the grant (a client may narrow scopes).
  const tokenLevel = levelOfScopes(auth.scope) ?? "read"
  const level: AccessLevel =
    LEVEL_RANK[tokenLevel] < LEVEL_RANK[props.level] ? tokenLevel : props.level
  const caller: Caller = {
    kind: "client",
    clientId: auth.clientId ?? "unknown",
    label: props.label,
    level,
  }
  const hub = hubPort(env, props.userId)
  const handler = createMcpHandler(() => toolServer(caller, hub), {
    route: "/mcp",
  })
  return handler(request, env, ctx)
}

function toolServer(caller: Caller, hub: HubPort) {
  const server = new McpServer(
    { name: "coworkers", version: "1.0.0" },
    {
      instructions:
        "Coworkers is the user's team of AI bots, each with its own chat, memory, routines, computer and browser. list_bots shows who does what. Name a bot by the `link` its results carry.",
    }
  )
  for (const op of visibleTo(caller)) {
    server.registerTool(
      op.name,
      {
        description: op.description,
        inputSchema: op.input,
        annotations: {
          readOnlyHint: op.effect === "read",
          destructiveHint: op.effect === "destructive",
        },
      },
      async (input: unknown) => {
        const result = await runOperation(
          op,
          { caller, requestId: null, approved: false, hub },
          input
        )
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          ...(isFailure(result) ? { isError: true } : {}),
        }
      }
    )
  }
  return server
}

/** The user's hub as operations see it. */
function hubPort(env: Env, userId: string): HubPort {
  const hub = () =>
    (env.UserHub as unknown as DurableObjectNamespace<UserHub>).getByName(
      userId
    )
  return {
    hasBot: (botId) => hub().hasBot(botId),
    listBots: () => hub().listBots(),
    readBot: (botId, limit) => hub().readBot(botId, limit),
    addBot: () => hub().addBot(),
    setPaused: (botId, paused) => hub().setPaused(botId, paused),
    removeBot: (botId) => hub().removeBot(botId),
    configureBot: (botId, patch) => hub().configureBot(botId, patch),
    relayMessage: (...args) => hub().relayMessage(...args),
    delegateTask: (...args) => hub().delegateTask(...args),
    messageFromClient: (...args) => hub().messageFromClient(...args),
    delegateFromClient: (...args) => hub().delegateFromClient(...args),
    clientTask: (...args) => hub().clientTask(...args),
    installedFrom: (...args) => hub().installedFrom(...args),
  }
}
