import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { BotAvatar } from "@/components/bot-avatar"
import { EmptyRow, Group, Row, SectionHeader } from "@/components/group"
import { useHub } from "@/lib/hub-context"
import type { SpendSummary } from "@/lib/types"

/** Dollars, with a floor for amounts that would round to nothing. */
export function formatUsd(amount: number) {
  if (amount > 0 && amount < 0.01) return "<$0.01"
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
}

function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`
  return String(count)
}

function formatAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)}h ago`
}

/** The account's Spend tab: what each bot cost this month, from AI Gateway. */
const SPEND_HEADER = (
  <SectionHeader
    title="Spend"
    description="What each bot's model calls cost, read back from AI Gateway."
  />
)

export function SpendSettings() {
  return (
    <div className="space-y-6">
      {SPEND_HEADER}
      <SpendTable />
    </div>
  )
}

function SpendTable() {
  const hub = useHub()
  const spend = hub.state.spend
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (spend === null) {
    return (
      <Group
        title="Spend"
        hint={
          <>
            Add an API token with <strong>AI Gateway Read</strong> as the{" "}
            <code>AI_GATEWAY_API_TOKEN</code> secret, and redeploy. Every bot's
            model calls are already tagged in AI Gateway; this reads them back.
          </>
        }
      >
        <EmptyRow>Not set up yet</EmptyRow>
      </Group>
    )
  }

  async function refresh() {
    if (!hub.refreshSpend) return
    setRefreshing(true)
    setError(null)
    try {
      await hub.refreshSpend()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh.")
    } finally {
      setRefreshing(false)
    }
  }

  const failure = error ?? spend?.error
  return (
    <Group
      title="This month"
      action={
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          loading={refreshing}
          disabled={!hub.refreshSpend}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      }
      hint={
        <>
          {failure ? (
            <span className="text-kumo-danger">{failure} </span>
          ) : null}
          Priced by AI Gateway. Days are UTC.
          {spend?.syncedAt ? ` Updated ${formatAgo(spend.syncedAt)}.` : ""}
        </>
      }
    >
      {!spend || (spend.syncedAt === null && !spend.bots.length) ? (
        <EmptyRow>Reading AI Gateway logs…</EmptyRow>
      ) : (
        <>
          <Row
            label="All bots"
            detail={`Today ${formatUsd(spend.total.today)}`}
          >
            <Amount value={spend.total.month} strong />
          </Row>
          {spend.bots.map((entry) => (
            <BotSpendRow key={entry.botId} entry={entry} />
          ))}
        </>
      )}
    </Group>
  )
}

function BotSpendRow({ entry }: { entry: SpendSummary["bots"][number] }) {
  const hub = useHub()
  const bot = hub.state.bots.find((b) => b.id === entry.botId)
  const background =
    entry.month.cost > 0
      ? Math.round((entry.background / entry.month.cost) * 100)
      : 0
  return (
    <Row
      icon={bot ? <BotAvatar avatar={bot.avatar} size={28} /> : undefined}
      label={bot?.name ?? "Deleted bot"}
      detail={[
        `Today ${formatUsd(entry.today.cost)}`,
        `${background}% background work`,
        `${formatTokens(entry.month.tokensIn)} tokens in`,
      ].join(" · ")}
    >
      <Amount value={entry.month.cost} />
    </Row>
  )
}

function Amount({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span
      className={`shrink-0 text-sm tabular-nums ${strong ? "font-medium text-kumo-default" : "text-kumo-default"}`}
    >
      {formatUsd(value)}
    </span>
  )
}

/** One bot's spend, for its settings panel. Hidden when spend is not set up. */
export function BotSpend({ botId }: { botId: string }) {
  const hub = useHub()
  const spend = hub.state.spend
  if (!spend) return null
  const entry = spend.bots.find((b) => b.botId === botId)
  return (
    <Group
      title="Spend"
      hint="Model calls priced by AI Gateway. Days are UTC. See every bot in Settings."
    >
      <Row label="This month">
        <Amount value={entry?.month.cost ?? 0} strong />
      </Row>
      <Row label="Today">
        <Amount value={entry?.today.cost ?? 0} />
      </Row>
      <Row
        label="Background work"
        detail="Check-ins, routines and email, this month"
      >
        <Amount value={entry?.background ?? 0} />
      </Row>
    </Group>
  )
}
