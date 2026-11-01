import { tool } from "ai"
import type { ToolSet } from "ai"
import { runOperation } from "./access"
import {
  createBot,
  delegateTask,
  delegateTaskFromClient,
  deleteBot,
  listBots,
  messageBot,
  messageBotFromClient,
  pauseBot,
  readBot,
  resumeBot,
  taskStatus,
  updateBot,
} from "./bots"
import { installSkill } from "./skills"
import { LEVEL_RANK, isFailure, levelOf } from "./operation"
import type {
  AnyOperation,
  Caller,
  Operation,
  OperationContext,
} from "./operation"

/** Every operation, in the order bots see them as tools. */
export const OPERATIONS = [
  messageBot,
  delegateTask,
  messageBotFromClient,
  delegateTaskFromClient,
  taskStatus,
  listBots,
  readBot,
  createBot,
  updateBot,
  pauseBot,
  resumeBot,
  deleteBot,
  installSkill,
] as const satisfies readonly AnyOperation[]

export type OperationName = (typeof OPERATIONS)[number]["name"]

/**
 * The operations a caller would see: allowed for its kind and level. An
 * outside agent sees no destructive ones: it has no approval card to
 * stop at, so those stay with the user in Coworkers.
 */
export function visibleTo(caller: Caller): AnyOperation[] {
  return (OPERATIONS as readonly AnyOperation[]).filter(
    (op) =>
      (!op.callers || op.callers.includes(caller.kind)) &&
      LEVEL_RANK[levelOf(caller)] >= LEVEL_RANK[op.level] &&
      !(caller.kind === "client" && op.effect === "destructive")
  )
}

/**
 * The operations a bot may call, as AI SDK tools. The context is built per
 * call, since a bot's hops and background state belong to its current
 * turn. Destructive ones always pause for an approval card; the bot's rules
 * add theirs on top (`TOOL_CLASS` in bot-agent.ts).
 */
export function operationTools(
  caller: Caller,
  context: (requestId: string, approved: boolean) => OperationContext
): ToolSet {
  const tools: ToolSet = {}
  for (const op of visibleTo(caller)) {
    const destructive = op.effect === "destructive"
    tools[op.name] = tool({
      description: op.description,
      inputSchema: op.input,
      ...(destructive ? { needsApproval: true } : {}),
      // A destructive call only gets here once it has been approved.
      execute: (input, { toolCallId }) =>
        runOperation(op, context(toolCallId, destructive), input),
    })
  }
  return tools
}

/**
 * Run an operation for the signed-in user, from a browser callable. A
 * refusal becomes an error, as callables reported before.
 */
export async function runAsUser<I, O>(
  op: Operation<I, O>,
  ctx: Omit<OperationContext, "caller" | "requestId" | "approved">,
  input: I
): Promise<O> {
  const result = await runOperation(
    op,
    { ...ctx, caller: { kind: "user" }, requestId: null, approved: false },
    input
  )
  if (isFailure(result)) throw new Error(result.error)
  return result
}

/** The rule each bot-callable operation falls under, for `TOOL_CLASS`. */
export function operationClasses() {
  return Object.fromEntries(
    (OPERATIONS as readonly AnyOperation[])
      .filter((op) => op.actionClass)
      .map((op) => [op.name, op.actionClass!])
  )
}
