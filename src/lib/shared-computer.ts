import { listSharedBotFiles, callSharedBotWorkspace } from "./sharing-fns"
import type { ComputerConnection } from "./bot-context"
import type { SharedWorkspaceAction } from "./sharing"

/** Same computer UI, with authenticated, member-scoped RPC instead of an owner socket. */
export function sharedComputerConnection(ref: {
  ownerId: string
  botId: string
}): ComputerConnection {
  type Methods = Omit<ComputerConnection["stub"], "listWorkspace">
  async function call<K extends keyof Methods>(
    action: Extract<SharedWorkspaceAction, { method: K }>
  ): Promise<Awaited<ReturnType<Methods[K]>>> {
    return (await callSharedBotWorkspace({
      data: { ...ref, action },
    })) as Awaited<ReturnType<Methods[K]>>
  }
  return {
    stub: {
      getLiveView: () => call({ method: "getLiveView" }),
      getBrowserFrame: (toolCallId) =>
        call({ method: "getBrowserFrame", toolCallId }),
      navigateBrowser: (action) => call({ method: "navigateBrowser", action }),
      closeBrowser: () => call({ method: "closeBrowser" }),
      getActivity: (limit = 200) => call({ method: "getActivity", limit }),
      readFileData: (path) => call({ method: "readFileData", path }),
      readFileText: (path) => call({ method: "readFileText", path }),
      runCommand: (command) => call({ method: "runCommand", command }),
      listWorkspace: () => listSharedBotFiles({ data: ref }),
    },
  }
}
