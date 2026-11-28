import { useMemo } from "react"
import { Link, useHydrated } from "@tanstack/react-router"
import { ClockIcon } from "@/components/icons"
import { describeCron, nextRun, parseCron } from "@/lib/cron"
import type { Routine } from "@/lib/types"

/** "3:00 PM", "tomorrow 8:00 AM" or "Mon 12 Oct, 8:00 AM". */
function moment(at: number) {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === new Date().toDateString()) return time
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  const day = d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
  return `${day}, ${time}`
}

function when(routine: Routine, hydrated: boolean) {
  // Schedules read in the viewer's zone, so only after hydration.
  if (!hydrated) return routine.kind === "once" ? "Once" : "Repeats"
  if (routine.kind === "once") return moment(new Date(routine.when).getTime())
  const cron = parseCron(routine.when)
  const label = (cron && describeCron(cron)) ?? `Cron ${routine.when}`
  const next = cron ? nextRun(cron, Date.now()) : null
  return next ? `${label} · next ${moment(next)}` : label
}

/** A routine the bot just scheduled or changed, shown in the thread. */
export function RoutineSummary({
  routine,
  updated,
  botId,
}: {
  routine: Routine
  updated: boolean
  botId?: string
}) {
  const hydrated = useHydrated()
  const schedule = useMemo(() => when(routine, hydrated), [routine, hydrated])
  return (
    <div className="flex w-full max-w-[640px] items-center gap-3 rounded-3xl bg-kumo-tint p-3 pr-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-kumo-base text-kumo-subtle outline outline-1 -outline-offset-1 outline-kumo-line">
        <ClockIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-kumo-default">
            {routine.name}
          </span>
          {routine.onlyNew ? (
            <span className="shrink-0 rounded-full bg-(--fill-hover) px-2 py-0.5 text-[11px] text-kumo-subtle">
              Only new
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm text-kumo-subtle tabular-nums">
          {updated ? "Updated · " : ""}
          {schedule}
        </p>
      </div>
      {botId ? (
        <Link
          to="/bots/$botId/settings"
          params={{ botId }}
          className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium text-kumo-default outline outline-1 -outline-offset-1 outline-kumo-line transition-colors hover:bg-(--fill-hover) focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          Open
        </Link>
      ) : null}
    </div>
  )
}
