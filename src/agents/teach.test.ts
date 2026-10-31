import { describe, expect, it } from "vitest"
import { RECORDER } from "./teach"
import type { TeachEvent } from "./teach"

interface FieldSpec {
  tag?: string
  type?: string
  name?: string
  id?: string
  autocomplete?: string
  ariaLabel?: string
  label?: string
}

class Element {}

/** A stand-in for a form field. Like a browser, an input has no innerText. */
function field(spec: FieldSpec, value: string) {
  const attrs: Record<string, string | undefined> = {
    type: spec.type,
    name: spec.name,
    "aria-label": spec.ariaLabel,
  }
  return Object.assign(new Element(), {
    tagName: (spec.tag ?? "input").toUpperCase(),
    type: spec.type ?? "text",
    name: spec.name ?? "",
    id: spec.id ?? "",
    autocomplete: spec.autocomplete ?? "",
    value,
    checked: false,
    innerText: "",
    labels: spec.label ? [{ innerText: spec.label }] : [],
    getAttribute: (name: string) => attrs[name] ?? null,
    closest: () => null,
  })
}

/** Run the real recorder against stand-in page objects. */
function recorder() {
  const listeners: Record<string, (event: unknown) => void> = {}
  const store = new Map<string, string>()
  const page = {
    window: { name: "" } as Record<string, unknown>,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn
    },
    location: { href: "https://shop.test/checkout" },
    document: { title: "Checkout" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    Element,
  }
  new Function(...Object.keys(page), RECORDER)(...Object.values(page))
  return {
    change(target: ReturnType<typeof field>) {
      listeners.change({ target })
    },
    click(target: ReturnType<typeof field>) {
      listeners.click({ target })
    },
    events(): TeachEvent[] {
      return JSON.parse([...store.values()][0])
    },
  }
}

function recorded(spec: FieldSpec, value = "typed-value") {
  const page = recorder()
  page.change(field(spec, value))
  return page.events().at(-1)!
}

describe("teach recorder", () => {
  it.each<[string, FieldSpec]>([
    ["password type", { type: "password", name: "login" }],
    ["new password name", { name: "newpassword" }],
    ["card number by name", { name: "cardnumber" }],
    ["card by autocomplete", { autocomplete: "cc-number" }],
    ["expiry by autocomplete", { autocomplete: "cc-exp" }],
    ["security code by label", { label: "Security code" }],
    ["cvv2", { name: "cvv2" }],
    ["one-time code", { autocomplete: "one-time-code" }],
    ["IBAN", { name: "iban" }],
    ["account number", { name: "accountNumber" }],
    ["routing number", { label: "Routing number" }],
    ["API key", { name: "api_key" }],
    ["API key, run together", { id: "apikey" }],
    ["access token", { name: "accessToken" }],
    ["PIN", { label: "PIN" }],
  ])("hides the value of a %s field", (_, spec) => {
    const event = recorded(spec)
    expect(event.value).toBe("[hidden]")
    expect(JSON.stringify(event)).not.toContain("typed-value")
  })

  it.each<[string, FieldSpec]>([
    ["shipping option", { name: "shipping", label: "Shipping options" }],
    ["postal code", { autocomplete: "postal-code", label: "Postal code" }],
    ["search box", { type: "search", name: "q" }],
    ["first name", { autocomplete: "given-name" }],
  ])("keeps the value of a %s field", (_, spec) => {
    expect(recorded(spec).value).toBe("typed-value")
  })

  it("never copies a field's value into its description", () => {
    const page = recorder()
    const password = field({ type: "password", id: "pw" }, "hunter2")
    page.change(password)
    page.click(password)
    expect(JSON.stringify(page.events())).not.toContain("hunter2")
  })

  it("still describes a button by its label", () => {
    const page = recorder()
    page.click(field({ type: "submit" }, "Place order"))
    expect(page.events().at(-1)!.el?.text).toBe("Place order")
  })
})
