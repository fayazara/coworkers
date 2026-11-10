import { useCallback, useEffect, useState } from "react"
import { CopyButton } from "@/components/copy-button"
import {
  EmptyRow,
  Group,
  Row,
  RowAction,
  SectionHeader,
} from "@/components/group"
import { PlugsConnectedIcon, TrashIcon } from "@/components/icons"
import { disconnectAgent, getConnectedAgents } from "@/lib/agent-fns"
import type { ConnectedAgent } from "@/lib/agent-fns"
import type { AccessLevel } from "@/lib/types"

const LEVEL_LABELS: Record<AccessLevel, string> = {
  read: "Read only",
  act: "Works with your bots",
  manage: "Manages your bots",
}

/** Copyable one-liners for the agents people use most. */
function setupCommands(mcpUrl: string) {
  return [
    {
      label: "Claude Code",
      command: `claude mcp add --transport http coworkers ${mcpUrl}`,
    },
    { label: "Codex", command: `codex mcp add coworkers --url ${mcpUrl}` },
  ]
}

/**
 * Outside agents (Claude Code, Codex, ChatGPT) that reach Coworkers over
 * MCP: where to point them, and who is connected, with a way to cut one
 * off.
 */
export function AgentsSettings() {
  const [data, setData] = useState<{
    mcpUrl: string
    agents: ConnectedAgent[]
  } | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    getConnectedAgents().then(setData, () => setFailed(true))
  }, [])
  useEffect(load, [load])

  async function disconnect(grantId: string) {
    setData((current) =>
      current
        ? {
            ...current,
            agents: current.agents.filter((a) => a.grantId !== grantId),
          }
        : current
    )
    try {
      await disconnectAgent({ data: grantId })
    } finally {
      load()
    }
  }

  const mcpUrl = data?.mcpUrl ?? ""

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Agents"
        description="Let Claude Code, Codex and other MCP clients work with your bots: message them, hand them tasks and read their results."
      />
      <Group
        title="Connect an agent"
        hint="The agent opens a page here to sign in, where you choose what it may do. ChatGPT and other MCP clients: add a custom MCP server with this URL and OAuth."
      >
        <Row label="MCP URL" detail={mcpUrl || "…"}>
          {mcpUrl ? <CopyButton text={mcpUrl} label="Copy MCP URL" /> : null}
        </Row>
        {mcpUrl
          ? setupCommands(mcpUrl).map(({ label, command }) => (
              <Row
                key={label}
                label={label}
                detail={
                  <code className="font-mono text-[12px] break-all">
                    {command}
                  </code>
                }
              >
                <CopyButton
                  text={command}
                  label={`Copy the ${label} command`}
                />
              </Row>
            ))
          : null}
      </Group>

      <Group
        title="Connected agents"
        hint="Disconnecting stops an agent at once. A connection lapses after a month without use."
      >
        {failed ? (
          <EmptyRow>Could not load connected agents.</EmptyRow>
        ) : !data ? (
          <EmptyRow>Loading…</EmptyRow>
        ) : data.agents.length === 0 ? (
          <EmptyRow>No agents connected yet.</EmptyRow>
        ) : (
          data.agents.map((agent) => (
            <Row
              key={agent.grantId}
              icon={<PlugsConnectedIcon size={14} />}
              label={agent.label}
              detail={`${LEVEL_LABELS[agent.level]} · since ${new Date(
                agent.connectedAt
              ).toLocaleDateString([], { day: "numeric", month: "short" })}`}
            >
              <RowAction
                label={`Disconnect ${agent.label}`}
                danger
                onClick={() => void disconnect(agent.grantId)}
              >
                <TrashIcon size={16} />
              </RowAction>
            </Row>
          ))
        )}
      </Group>
    </div>
  )
}
