/**
 * Just enough cron to draw a routine's schedule in the browser. Routines run
 * on the Worker, where cron is evaluated in UTC, so matching is done on UTC
 * fields and times are shown in the viewer's zone.
 */

interface Field {
  any: boolean
  values: Set<number>
}

function parseField(spec: string, min: number, max: number): Field | null {
  const values = new Set<number>()
  for (const part of spec.split(",")) {
    const [range, stepText] = part.split("/")
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return null
    let from = min
    let to = max
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number)
      if (!Number.isInteger(a)) return null
      from = a
      to = b === undefined ? (stepText === undefined ? a : max) : b
      if (!Number.isInteger(to)) return null
    }
    if (from < min || to > max || from > to) return null
    for (let v = from; v <= to; v += step) values.add(v)
  }
  return { any: spec === "*", values }
}

export interface Cron {
  minute: Field
  hour: Field
  dom: Field
  month: Field
  dow: Field
  raw: string[]
}

export function parseCron(expr: string): Cron | null {
  const raw = expr.trim().split(/\s+/)
  if (raw.length !== 5) return null
  const minute = parseField(raw[0], 0, 59)
  const hour = parseField(raw[1], 0, 23)
  const dom = parseField(raw[2], 1, 31)
  const month = parseField(raw[3], 1, 12)
  // 7 is Sunday too. Mapped after parsing so ranges like 5-7 still work.
  const dow = parseField(raw[4], 0, 7)
  if (!minute || !hour || !dom || !month || !dow) return null
  if (dow.values.delete(7)) dow.values.add(0)
  return { minute, hour, dom, month, dow, raw }
}

function matches(cron: Cron, d: Date) {
  if (!cron.minute.values.has(d.getUTCMinutes())) return false
  if (!cron.hour.values.has(d.getUTCHours())) return false
  if (!cron.month.values.has(d.getUTCMonth() + 1)) return false
  const domOk = cron.dom.values.has(d.getUTCDate())
  const dowOk = cron.dow.values.has(d.getUTCDay())
  // Standard cron: when both day fields are restricted, either may match.
  if (!cron.dom.any && !cron.dow.any) return domOk || dowOk
  return domOk && dowOk
}

/** Run times (ms) in [from, from + windowMs), at most `limit`. */
export function runsBetween(
  cron: Cron,
  from: number,
  windowMs: number,
  limit = 400
) {
  const runs: number[] = []
  const start = Math.ceil(from / 60_000) * 60_000
  for (let t = start; t < from + windowMs && runs.length < limit; t += 60_000) {
    if (matches(cron, new Date(t))) runs.push(t)
  }
  return runs
}

/** Next run within a year, or null. */
export function nextRun(cron: Cron, from: number) {
  const day = 86_400_000
  for (let i = 0; i < 366; i++) {
    const [first] = runsBetween(cron, from + i * day, day, 1)
    if (first !== undefined) return first
  }
  return null
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function single(field: Field) {
  return field.values.size === 1 ? [...field.values][0] : null
}

function localTime(hourUtc: number, minute: number) {
  const d = new Date()
  d.setUTCHours(hourUtc, minute, 0, 0)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** "Every 10 minutes", "Weekdays at 8:00 AM", or null when it is unusual. */
export function describeCron(cron: Cron): string | null {
  const [m, h, dom, mon, dow] = cron.raw
  const everyDay = dom === "*" && mon === "*"
  if (!everyDay) return null

  if (dow === "*") {
    if (m === "*" && h === "*") return "Every minute"
    const minStep = /^\*\/(\d+)$/.exec(m)
    if (minStep && h === "*") return `Every ${minStep[1]} minutes`
    const minute = single(cron.minute)
    if (minute !== null && h === "*") {
      return minute === 0 ? "Every hour" : `Every hour at :${String(minute).padStart(2, "0")}`
    }
    const hourStep = /^\*\/(\d+)$/.exec(h)
    if (minute !== null && hourStep) return `Every ${hourStep[1]} hours`
  }

  const minute = single(cron.minute)
  if (minute === null || cron.hour.any || cron.hour.values.size > 3) return null
  const times = [...cron.hour.values]
    .map((hour) => localTime(hour, minute))
    .join(", ")

  const days = [...cron.dow.values].sort()
  let when: string
  if (cron.dow.any || days.length === 7) when = "Every day"
  else if (days.join() === "1,2,3,4,5") when = "Weekdays"
  else if (days.join() === "0,6") when = "Weekends"
  else if (days.length === 1) when = `Every ${DAYS[days[0]]}`
  else when = days.map((d) => DAYS[d].slice(0, 3)).join(", ")
  return `${when} at ${times}`
}
