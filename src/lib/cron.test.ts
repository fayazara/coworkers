import { describe, expect, it } from "vitest"
import { describeCron, nextRun, parseCron, runsBetween } from "./cron"

// Mon 26 Oct 2026, 00:00 UTC.
const MONDAY = Date.UTC(2026, 9, 26)
const DAY = 86_400_000

function days(expr: string) {
  return [...parseCron(expr)!.dow.values].sort()
}

// describeCron shows times in the viewer's zone.
function at(hourUtc: number, minute = 0) {
  const d = new Date()
  d.setUTCHours(hourUtc, minute, 0, 0)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

describe("parseCron", () => {
  it("needs five fields", () => {
    expect(parseCron("0 9 * *")).toBeNull()
    expect(parseCron("0 9 * * * *")).toBeNull()
  })

  it("parses lists, ranges and steps", () => {
    const cron = parseCron("*/15 9-11 1,15 * *")!
    expect([...cron.minute.values]).toEqual([0, 15, 30, 45])
    expect([...cron.hour.values]).toEqual([9, 10, 11])
    expect([...cron.dom.values]).toEqual([1, 15])
    expect(cron.month.any).toBe(true)
  })

  it("treats 7 as Sunday, also inside ranges", () => {
    expect(days("0 9 * * 7")).toEqual([0])
    expect(days("0 9 * * 5-7")).toEqual([0, 5, 6])
    expect(days("0 9 * * 1-7")).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days("0 9 * * 0-7")).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days("0 9 * * 6,7")).toEqual([0, 6])
  })

  it("rejects values out of range and reversed ranges", () => {
    expect(parseCron("70 * * * *")).toBeNull()
    expect(parseCron("0 25 * * *")).toBeNull()
    expect(parseCron("0 9 0 * *")).toBeNull()
    expect(parseCron("0 9 * 13 *")).toBeNull()
    expect(parseCron("0 9 * * 8")).toBeNull()
    expect(parseCron("0 9 * * 5-2")).toBeNull()
    expect(parseCron("0 9 * * */0")).toBeNull()
  })
})

describe("runsBetween and nextRun", () => {
  it("finds every run in a window", () => {
    const runs = runsBetween(parseCron("0 */6 * * *")!, MONDAY, DAY)
    expect(runs.map((t) => new Date(t).getUTCHours())).toEqual([0, 6, 12, 18])
  })

  it("runs a 5-7 schedule on Friday, Saturday and Sunday", () => {
    const cron = parseCron("0 9 * * 5-7")!
    const runs = runsBetween(cron, MONDAY, 7 * DAY)
    expect(runs.map((t) => new Date(t).getUTCDay())).toEqual([5, 6, 0])
    expect(nextRun(cron, MONDAY)).toBe(Date.UTC(2026, 9, 30, 9))
  })

  it("matches either day field when both are restricted", () => {
    // The 1st of the month or any Monday.
    const cron = parseCron("0 9 1 * 1")!
    const runs = runsBetween(cron, MONDAY, 10 * DAY)
    expect(runs.map((t) => new Date(t).getUTCDate())).toEqual([26, 1, 2])
  })

  it("returns null for a date that never comes", () => {
    expect(nextRun(parseCron("0 9 31 2 *")!, MONDAY)).toBeNull()
  })
})

describe("describeCron", () => {
  const describe_ = (expr: string) => describeCron(parseCron(expr)!)

  it("names common schedules", () => {
    expect(describe_("* * * * *")).toBe("Every minute")
    expect(describe_("*/10 * * * *")).toBe("Every 10 minutes")
    expect(describe_("0 * * * *")).toBe("Every hour")
    expect(describe_("30 * * * *")).toBe("Every hour at :30")
    expect(describe_("0 */4 * * *")).toBe("Every 4 hours")
    expect(describe_("0 9 * * *")).toBe(`Every day at ${at(9)}`)
    expect(describe_("0 9 * * 1-5")).toBe(`Weekdays at ${at(9)}`)
    expect(describe_("0 9 * * 6,7")).toBe(`Weekends at ${at(9)}`)
    expect(describe_("0 9 * * 7")).toBe(`Every Sunday at ${at(9)}`)
    expect(describe_("0 9 * * 1-7")).toBe(`Every day at ${at(9)}`)
    expect(describe_("0 9 * * 5-7")).toBe(`Sun, Fri, Sat at ${at(9)}`)
  })

  it("gives up on unusual schedules", () => {
    expect(describe_("0 9 1 * *")).toBeNull()
    expect(describe_("*/5 9 * * *")).toBeNull()
  })
})
