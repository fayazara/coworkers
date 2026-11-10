import { createContext, useContext } from "react"
import type { useAgent } from "agents/react"
import type { BotAgent } from "@/agents/bot-agent"
import type { BotState, MessageMeta } from "@/lib/types"

export type BotConnection = ReturnType<typeof useAgent<BotAgent, BotState>>

interface BotContextValue {
  botId: string
  state: BotState
  /** Null during SSR and until the bot's WebSocket is up. */
  agent: BotConnection | null
  /**
   * Send a chat message as the user, from outside the composer (the
   * product panel's Buy). Absent until the chat is live.
   */
  send?: (text: string, meta?: Omit<MessageMeta, "at">) => void
  /** A turn is in flight, so a new message would have to wait. */
  busy?: boolean
}

export const BotContext = createContext<BotContextValue | null>(null)

export function useBot() {
  const value = useContext(BotContext)
  if (!value) throw new Error("useBot must be used inside a bot route")
  return value
}
