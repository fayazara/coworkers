import { useEffect, useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { useBot } from "@/lib/bot-context"
import { useHub } from "@/lib/hub-context"
import type { BotSharing } from "@/lib/sharing"
import { CopyButton } from "./copy-button"
import { EmptyRow, FIELD, Group, Row } from "./group"

export function BotSharingSettings() {
  const { agent, botId } = useBot()
  const hub = useHub()
  const [sharing, setSharing] = useState<BotSharing | null>(null)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const saving = useRef(false)

  useEffect(() => {
    if (!agent) return
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
  }, [agent])

  async function save(next: BotSharing) {
    if (!agent || !sharing || saving.current) return false
    const previous = sharing
    saving.current = true
    setSharing(next)
    setBusy(true)
    setError("")
    try {
      setSharing(
        await agent.stub.setBotSharing({
          emails: next.emails,
          workspace: next.workspace,
          connectionIds: next.connectionIds,
        })
      )
      return true
    } catch (err) {
      setSharing(previous)
      setError(err instanceof Error ? err.message : "Could not save sharing")
      return false
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const disabled = !agent || !hub.viewer.email || !sharing || busy
  const path = `/shared/${encodeURIComponent(hub.viewer.id)}/${encodeURIComponent(botId)}`
  return (
    <section className="space-y-3" aria-label="Bot sharing">
      <Group
        title="Sharing"
        hint="Members share this bot’s chat, memory, browser, terminal, and files. They can edit its apps and message the bot. Only you manage settings and approvals."
        action={
          sharing && (sharing.emails.length > 0 || sharing.workspace) ? (
            <CopyButton
              text={
                typeof window === "undefined"
                  ? path
                  : `${window.location.origin}${path}`
              }
              label="Copy bot link"
            />
          ) : undefined
        }
      >
        <Row
          label="Everyone who can sign in"
          detail="Or add specific people below."
        >
          <Switch
            aria-label="Share with everyone who can sign in"
            checked={sharing?.workspace ?? false}
            disabled={disabled}
            onCheckedChange={(workspace) => {
              if (sharing) void save({ ...sharing, workspace })
            }}
          />
        </Row>
        {sharing?.emails.map((person) => (
          <Row key={person} label={person}>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                void save({
                  ...sharing,
                  emails: sharing.emails.filter((value) => value !== person),
                })
              }
            >
              Remove
            </Button>
          </Row>
        ))}
        {sharing ? (
          <li className="border-t border-kumo-line px-4 py-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const clean = email.trim().toLowerCase()
                if (clean)
                  void save({
                    ...sharing,
                    emails: [...new Set([...sharing.emails, clean])],
                  }).then((saved) => {
                    if (saved) setEmail("")
                  })
              }}
            >
              <input
                type="email"
                aria-label="Email to share with"
                placeholder="Add an email address"
                required
                maxLength={254}
                disabled={disabled}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`${FIELD} h-9 min-w-0 flex-1`}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={disabled || !email.trim()}
              >
                Add
              </Button>
            </form>
          </li>
        ) : (
          <EmptyRow>Loading sharing settings…</EmptyRow>
        )}
      </Group>
      {sharing?.isolated && hub.state.connections.length ? (
        <Group
          title="Connected accounts"
          hint="Members can use enabled accounts. Changes still need your approval."
        >
          {hub.state.connections.map((connection) => (
            <Row key={connection.id} label={connection.name}>
              <Switch
                aria-label={`Share ${connection.name} with this bot`}
                checked={sharing.connectionIds.includes(connection.id)}
                disabled={disabled}
                onCheckedChange={(enabled) =>
                  void save({
                    ...sharing,
                    connectionIds: enabled
                      ? [...sharing.connectionIds, connection.id]
                      : sharing.connectionIds.filter(
                          (id) => id !== connection.id
                        ),
                  })
                }
              />
            </Row>
          ))}
        </Group>
      ) : null}
      {!hub.viewer.email ? (
        <p className="px-1.5 text-xs text-kumo-subtle">
          Sign in to share bots.
        </p>
      ) : null}
      {sharing?.isolated ? (
        <p className="px-1.5 text-xs text-kumo-subtle">
          Private account memory, other bots, and saved credentials stay
          isolated. The previous browser session is closed when sharing starts.
          Any new browser session is shared with members, including sites signed
          into there.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-1.5 text-sm text-kumo-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
