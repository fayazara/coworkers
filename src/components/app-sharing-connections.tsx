import { useEffect, useRef, useState } from "react"
import { Switch } from "@cloudflare/kumo/components/switch"
import type { BotConnection } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
import type { BotSharing } from "@/lib/sharing"
import { EmptyRow, Group, Row } from "./group"

/** Account access is separate from each app's approved tools. */
export function AppSharingConnections({
  agent,
  willIsolate,
  refreshKey,
}: {
  agent: BotConnection
  willIsolate: boolean
  refreshKey: unknown
}) {
  const { state } = useHub()
  const [sharing, setSharing] = useState<BotSharing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const saving = useRef(false)
  useEffect(() => {
    let cancelled = false
    agent.stub
      .getBotSharing()
      .then((value) => {
        if (!cancelled) setSharing(value)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [agent, refreshKey])

  async function save(connectionId: string, enabled: boolean) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError("")
    try {
      setSharing(
        await agent.stub.setSharingConnection({ connectionId, enabled })
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save account access"
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  if (!willIsolate && !sharing?.isolated && !error) return null
  return (
    <section className="space-y-2" aria-label="App sharing accounts">
      <Group
        title="Connected accounts for sharing"
        hint="Forms and bot messages isolate this bot from private account context. Choose the accounts it and its apps may use. This applies to every app and member of this bot; app tools still need separate approval."
      >
        {!sharing ? (
          <EmptyRow>Loading account access…</EmptyRow>
        ) : state.connections.length ? (
          state.connections.map((connection) => (
            <Row key={connection.id} label={connection.name}>
              <Switch
                aria-label={`Allow ${connection.name} for shared apps`}
                checked={sharing.connectionIds.includes(connection.id)}
                disabled={busy}
                onCheckedChange={(enabled) => void save(connection.id, enabled)}
              />
            </Row>
          ))
        ) : (
          <EmptyRow>No connected accounts.</EmptyRow>
        )}
      </Group>
      {error ? (
        <p role="alert" className="px-1.5 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
