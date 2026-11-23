import { describe, expect, it } from "vitest"
import { describeCatalog } from "./describe"
import { normalizeLayout } from "./normalize"
import { getAt, isPointer, progressValue, setAt } from "./pointer"
import {
  actionAt,
  checkActionValues,
  showSurface,
  surfaceEndsStep,
  surfaceForModel,
  surfaceIdFrom,
  updateSurface,
} from "./surface"
import type { EventAction, Surface } from "./types"

const watch = {
  id: "macbook-watch",
  title: "MacBook Air under ₹95,000",
  layout: [
    {
      type: "Stats",
      items: [
        { label: "Lowest now", value: { $bind: "/low" }, tone: "good" },
        { label: "Listings", value: { $bind: "/count" } },
      ],
    },
    { type: "List", title: "Best listings", items: { $bind: "/listings" } },
    {
      type: "Actions",
      items: [{ label: "Watch daily", action: { say: "Watch it daily" } }],
    },
  ],
  data: {
    low: "₹91,500",
    count: "14",
    listings: [{ label: "M4 13-inch", value: "₹91,500" }],
  },
}

function shown(input: object, prev?: Surface): Surface {
  const out = showSurface(input, prev, new Set(), 1000)
  if (!out.ok) throw new Error(JSON.stringify(out.problems))
  return out.surface
}

describe("pointers", () => {
  it("reads and writes without touching the original", () => {
    const data = { a: { b: [1, 2] } }
    expect(getAt(data, "/a/b/1")).toBe(2)
    const next = setAt(data, "/a/b/0", 9)
    expect(next).toEqual({ a: { b: [9, 2] } })
    expect(data.a.b[0]).toBe(1)
    expect(setAt(data, "/a/c/d", "x")).toEqual({
      a: { b: [1, 2], c: { d: "x" } },
    })
    expect(setAt(data, "/a/b/-", 3)).toEqual({ a: { b: [1, 2, 3] } })
    expect(setAt(data, "/a/b/0", null)).toEqual({ a: { b: [2] } })
    expect(setAt({ s: "text" }, "/s/x", 1)).toBeNull()
  })

  it("refuses pointers that reach the prototype", () => {
    expect(isPointer("/price")).toBe(true)
    expect(isPointer("price")).toBe(false)
    expect(isPointer("/__proto__/x")).toBe(false)
    expect(isPointer("/a/constructor")).toBe(false)
  })
})

describe("normalizeLayout", () => {
  it("flattens a tree with stable ids and keeps bindings", () => {
    const { value, problems } = normalizeLayout([
      {
        type: "Section",
        title: "Now",
        children: [
          { type: "Text", text: "hi" },
          { id: "steps", type: "Steps", items: { $bind: "/steps" } },
        ],
      },
    ])
    expect(problems).toEqual([])
    expect(value.root).toEqual(["n0"])
    expect(value.nodes.n0.children).toEqual(["n0-0", "steps"])
    expect(value.nodes.steps.props.items).toEqual({ $bind: "/steps" })
  })

  it("draws what is valid while input is still streaming", () => {
    const { value } = normalizeLayout([
      { type: "Stats", items: [{ label: "Low", value: "₹9" }, { value: "₹" }] },
      { type: "Li" },
      { type: "List", items: [{ label: "One" }, { label: "Tw" }, {}] },
    ])
    expect(value.root).toEqual(["n0", "n2"])
    expect(value.nodes.n0.props.items).toHaveLength(1)
    expect(value.nodes.n2.props.items).toHaveLength(2)
  })

  it("rejects what cannot render, with a path and a fix", () => {
    const { problems } = normalizeLayout([
      { type: "Card", children: [] },
      { type: "List", items: [] },
      { type: "Actions", items: [{ label: "Go", action: { go: 1 } }] },
      { type: "TextField", label: "Name", field: "your name" },
      { type: "Actions", items: [{ label: "Add", action: { say: "Add a task:" } }] },
    ])
    expect(problems.map((p) => p.path)).toEqual([
      "/layout/0/type",
      "/layout/1/items",
      "/layout/2/items/0/action",
      "/layout/2/items",
      "/layout/3/field",
      "/layout/4/items/0/action/say",
      "/layout/4/items",
    ])
    expect(problems[0].message).toContain("Use Section")
  })

  it("reads a bare field name as a pointer", () => {
    const { value, problems, warnings } = normalizeLayout([
      { type: "TextField", label: "Subject", field: "reply.subject" },
    ])
    expect(problems).toEqual([])
    expect(value.nodes.n0.props.field).toBe("/reply/subject")
    expect(warnings[0].path).toBe("/layout/0/field")
  })

  it("drops style props and unsafe links with a warning", () => {
    const { value, warnings, problems } = normalizeLayout([
      {
        type: "List",
        color: "red",
        items: [
          { label: "A", url: "javascript:alert(1)" },
          { label: "B", url: "https://b.example" },
        ],
      },
    ])
    expect(problems).toEqual([])
    expect(warnings.map((w) => w.path)).toEqual([
      "/layout/0/items/0/url",
      "/layout/0/color",
    ])
    const items = value.nodes.n0.props.items as { url?: string }[]
    expect(items[0].url).toBeUndefined()
    expect(items[1].url).toBe("https://b.example")
  })

  it("gives a form's buttons its fields", () => {
    const { value } = normalizeLayout([
      {
        type: "Form",
        submit: { label: "Send", action: { event: "send_reply" } },
        children: [
          { type: "TextField", label: "Subject", field: "/reply/subject" },
          { type: "TextField", label: "Body", field: "/reply/body" },
        ],
      },
      {
        type: "Actions",
        items: [{ label: "Skip", action: { event: "skip" } }],
      },
    ])
    const submit = value.nodes.n0.props.submit as { action: EventAction }
    expect(submit.action.fields).toEqual(["/reply/subject", "/reply/body"])
    const skip = (value.nodes.n1.props.items as { action: EventAction }[])[0]
    expect(skip.action.fields).toEqual([])
  })

  it("caps one callout per surface", () => {
    const { value, warnings } = normalizeLayout([
      { type: "Callout", text: "One" },
      { type: "Callout", text: "Two" },
    ])
    expect(value.root).toEqual(["n0"])
    expect(warnings[0].message).toContain("At most 1 Callout")
  })
})

describe("showSurface and updateSurface", () => {
  it("shows, then updates data in place", () => {
    const first = shown(watch)
    expect(first.version).toBe(1)
    const out = updateSurface(
      {
        id: "macbook-watch",
        data: [
          { path: "/low", value: "₹89,999" },
          { path: "/listings/-", value: { label: "M3", value: "₹80,000" } },
        ],
      },
      first,
      2000
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.surface.version).toBe(2)
    expect(out.surface.data.low).toBe("₹89,999")
    expect(out.surface.data.listings).toHaveLength(2)
    expect(out.surface.nodes).toEqual(first.nodes)
  })

  it("warns about bindings with no data yet", () => {
    const out = showSurface(
      { layout: [{ type: "Text", text: { $bind: "/note" } }] },
      undefined,
      new Set()
    )
    expect(out.ok && out.warnings?.[0].path).toBe("/note")
  })

  it("names surfaces the bot did not name, from the title", () => {
    expect(surfaceIdFrom("Flights to Goa!", new Set())).toBe("flights-to-goa")
    expect(surfaceIdFrom("Flights to Goa", new Set(["flights-to-goa"]))).toBe(
      "flights-to-goa-2"
    )
  })

  it("rejects a bad id and a closed surface", () => {
    expect(showSurface({ ...watch, id: "Big Id" }, undefined, new Set()).ok).toBe(
      false
    )
    const closed = { ...shown(watch), status: "closed" as const }
    expect(updateSurface({ id: closed.id, data: [] }, closed).ok).toBe(false)
  })

  it("tells the model where things went wrong, never the payload", () => {
    const bad = showSurface(
      { layout: [{ type: "Grid" }] },
      undefined,
      new Set()
    )
    const text = surfaceForModel(bad)
    expect(text).toContain("/layout/0/type")
    expect(text).toContain("Use Split")
    const good = surfaceForModel(showSurface(watch, undefined, new Set()))
    expect(good).toContain('update_surface with id "macbook-watch"')
    expect(good).not.toContain("₹91,500")
  })
})

describe("actions", () => {
  const form = shown({
    id: "reply",
    layout: [
      {
        id: "f",
        type: "Form",
        submit: { label: "Send", action: { event: "send_reply" } },
        children: [
          {
            type: "TextField",
            label: "Body",
            field: "/reply/body",
            required: true,
            max: 10,
          },
          {
            type: "Choice",
            label: "Tone",
            field: "/reply/tone",
            options: [
              { label: "Warm", value: "warm" },
              { label: "Brief", value: "brief" },
            ],
          },
          { type: "Toggle", label: "CC me", field: "/reply/cc" },
        ],
      },
    ],
    data: { reply: { body: "Hi" } },
  })

  it("finds buttons by target", () => {
    expect(actionAt(form, "f#submit")?.label).toBe("Send")
    expect(actionAt(form, "f#0")).toBeNull()
    expect(actionAt(form, "nope#submit")).toBeNull()
  })

  it("checks the values a press sends", () => {
    const action = actionAt(form, "f#submit")!.action as EventAction
    const ok = checkActionValues(form, action, {
      "/reply/body": "Sounds good, go ahead",
      "/reply/tone": "warm",
      "/reply/cc": true,
    })
    expect(ok).toEqual({
      values: { reply: { body: "Sounds goo", tone: "warm", cc: true } },
    })
    expect(
      checkActionValues(form, action, { "/reply/tone": "rude" })
    ).toEqual({ error: "Body is required." })
    expect(
      checkActionValues(form, action, { "/secret": "x", "/reply/body": "x" })
    ).toEqual({ error: "That button does not send /secret." })
  })
})

describe("ticking steps", () => {
  const list = shown({
    id: "moving",
    layout: [
      {
        type: "Steps",
        id: "s",
        tick: { event: "tick_step" },
        items: { $bind: "/steps" },
      },
    ],
    data: {
      steps: [
        { label: "Book movers", state: "done" },
        { label: "Pack kitchen", state: "active" },
      ],
    },
  })

  it("sends which step and which way, never other fields", () => {
    const tick = actionAt(list, "s#1")
    expect(tick?.label).toBe("Ticked Pack kitchen")
    expect(tick?.values).toEqual({ step: 1, label: "Pack kitchen", done: true })
    expect((tick?.action as EventAction).fields).toEqual([])
    expect(actionAt(list, "s#0")?.values?.done).toBe(false)
    expect(actionAt(list, "s#2")).toBeNull()
  })

  it("reads a bare event name as the tick", () => {
    const out = showSurface(
      { layout: [{ type: "Steps", tick: "tick_step", items: [{ label: "A", state: "pending" }] }] },
      undefined,
      new Set(),
      1
    )
    expect(out.ok && out.surface.nodes.n0.props.tick).toEqual({
      event: "tick_step",
      fields: [],
    })
  })

  it("is not a button without a tick event", () => {
    const plain = shown({
      layout: [{ type: "Steps", id: "s", items: [{ label: "A", state: "pending" }] }],
    })
    expect(actionAt(plain, "s#0")).toBeNull()
  })
})

describe("hostile input", () => {
  it("never lets a script URL or a prototype key through", () => {
    const out = showSurface(
      {
        layout: [
          { type: "List", items: { $bind: "/rows" } },
          { type: "Actions", items: [{ label: "Go", action: { link: "javascript:alert(1)" } }] },
          { type: "Image", src: "data:text/html,<script>alert(1)</script>", alt: "x" },
          { type: "Text", text: "<img src=x onerror=alert(1)>" },
        ],
        data: {
          rows: [{ label: "A", url: "javascript:alert(1)" }, { label: "B", url: " JaVaScRiPt:alert(1)" }],
          ["__proto__"]: { polluted: true },
        },
      },
      undefined,
      new Set(),
      1
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.problems.map((p) => p.path)).toContain("/layout/1/items/0/action/link")
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(setAt({}, "/__proto__/polluted", true)).toBeNull()
  })
})

describe("surfaceEndsStep", () => {
  const ok = (layout: unknown[]) => ({
    toolName: "show_surface",
    output: showSurface({ layout }, undefined, new Set(), 1),
  })
  const call = { toolName: "show_surface" }
  const answer = [{ type: "Stats", items: [{ label: "Low", value: "1" }] }]

  it("ends after a finished surface", () => {
    expect(surfaceEndsStep({ toolCalls: [call], toolResults: [ok(answer)] })).toBe(true)
  })

  it("still ends when the bot names itself in the same step", () => {
    expect(
      surfaceEndsStep({
        toolCalls: [{ toolName: "set_name" }, call],
        toolResults: [{ toolName: "set_name", output: { ok: true } }, ok(answer)],
      })
    ).toBe(true)
    expect(
      surfaceEndsStep({
        toolCalls: [{ toolName: "set_name" }],
        toolResults: [{ toolName: "set_name", output: { ok: true } }],
      })
    ).toBe(false)
  })

  it("carries on for other tools, rejections and work under way", () => {
    expect(
      surfaceEndsStep({
        toolCalls: [call, { toolName: "exec" }],
        toolResults: [ok(answer), { toolName: "exec" }],
      })
    ).toBe(false)
    expect(
      surfaceEndsStep({ toolCalls: [call], toolResults: [ok([{ type: "Card" }])] })
    ).toBe(false)
    expect(
      surfaceEndsStep({
        toolCalls: [call],
        toolResults: [ok([{ type: "Progress", label: "Checking 5 sites" }])],
      })
    ).toBe(false)
    expect(surfaceEndsStep({ toolCalls: [], toolResults: [] })).toBe(false)
  })

  it("treats a user's checklist as finished, the bot's own steps as work", () => {
    const steps = [{ label: "Pack", state: "active" }]
    expect(
      surfaceEndsStep({
        toolCalls: [call],
        toolResults: [ok([{ type: "Steps", items: steps }])],
      })
    ).toBe(false)
    expect(
      surfaceEndsStep({
        toolCalls: [call],
        toolResults: [ok([{ type: "Steps", tick: { event: "tick" }, items: steps }])],
      })
    ).toBe(true)
  })
})

describe("describeCatalog", () => {
  it("lists every component with its props", () => {
    const text = describeCatalog()
    expect(text).toContain("- Stats:")
    expect(text).toContain("- DateField:")
    expect(text).toContain("label*")
    expect(text).not.toContain("undefined")
  })
})

describe("a Progress that follows its Steps", () => {
  const steps = [
    { label: "Cloudflare", state: "done" },
    { label: "GitHub", state: "skipped" },
    { label: "Stripe", state: "active" },
    { label: "OpenAI", state: "pending" },
  ]

  it("counts the steps done or skipped", () => {
    expect(progressValue(steps)).toBe(0.5)
    expect(progressValue(0.3)).toBe(0.3)
    expect(progressValue(7)).toBe(1)
    expect(progressValue([])).toBeNull()
    expect(progressValue("half")).toBeNull()
  })

  it("warns when the bar is not linked to the steps", () => {
    const out = showSurface(
      {
        layout: [
          { type: "Progress", label: "Checking", value: { $bind: "/pct" } },
          { type: "Steps", items: { $bind: "/steps" } },
        ],
        data: { pct: 0, steps },
      },
      undefined,
      new Set(),
      1
    )
    expect(out.ok && out.warnings?.some((w) => w.message.includes('"/steps"'))).toBe(true)
  })

  it("does not warn when linked, and ends the turn once all are done", () => {
    const layout = [
      { type: "Progress", label: "Checking", value: { $bind: "/steps" } },
      { type: "Steps", items: { $bind: "/steps" } },
    ]
    const running = showSurface({ layout, data: { steps } }, undefined, new Set(), 1)
    expect(running.ok && running.warnings).toBeFalsy()
    const finished = showSurface(
      { layout, data: { steps: steps.map((s) => ({ ...s, state: "done" })) } },
      undefined,
      new Set(),
      1
    )
    const call = { toolName: "show_surface" }
    expect(
      surfaceEndsStep({ toolCalls: [call], toolResults: [{ toolName: "show_surface", output: running }] })
    ).toBe(false)
    expect(
      surfaceEndsStep({ toolCalls: [call], toolResults: [{ toolName: "show_surface", output: finished }] })
    ).toBe(true)
  })
})
