import { isBotMember, sharedWorkspaceActionSchema } from "@/lib/sharing"
import type { BotSharing, SharedWorkspaceAction } from "@/lib/sharing"
import type { BotAgent } from "./bot-agent"

type SharedComputerBackend = Pick<BotAgent, SharedWorkspaceAction["method"]>

/** Explicit dispatch, not arbitrary method invocation on an owner's bot. */
export async function runSharedWorkspace(
  bot: SharedComputerBackend,
  sharing: BotSharing,
  email: string,
  input: unknown
) {
  if (!isBotMember(sharing, email))
    throw new Error("Access revoked or not shared with you")
  const action = sharedWorkspaceActionSchema.parse(input)
  switch (action.method) {
    case "getLiveView":
      return bot.getLiveView()
    case "getBrowserFrame":
      return bot.getBrowserFrame(action.toolCallId)
    case "navigateBrowser":
      return bot.navigateBrowser(action.action)
    case "closeBrowser":
      return bot.closeBrowser()
    case "getActivity":
      return bot.getActivity(action.limit)
    case "readFileData":
      return bot.readFileData(action.path)
    case "readFileText":
      return bot.readFileText(action.path)
    case "runCommand":
      return bot.runCommand(action.command)
  }
}
