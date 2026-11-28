import { describe, expect, it } from "vitest"
import { attachmentNames, webhookDeliveryId } from "./inbound"

describe("webhookDeliveryId", () => {
  it("reads the common delivery id headers", () => {
    expect(
      webhookDeliveryId(new Headers({ "X-GitHub-Delivery": "72d3162e" }))
    ).toBe("72d3162e")
    expect(webhookDeliveryId(new Headers({ "webhook-id": "msg_2Kx" }))).toBe(
      "msg_2Kx"
    )
    expect(webhookDeliveryId(new Headers({ "Idempotency-Key": "abc" }))).toBe(
      "abc"
    )
  })

  it("is undefined when the sender gives none", () => {
    expect(
      webhookDeliveryId(new Headers({ "Content-Type": "application/json" }))
    ).toBeUndefined()
    expect(
      webhookDeliveryId(new Headers({ "webhook-id": "  " }))
    ).toBeUndefined()
  })
})

describe("attachmentNames", () => {
  it("keeps names in any script", () => {
    expect(
      attachmentNames(["合同.pdf", "Résumé.docx", "отчёт 2026.xlsx"])
    ).toEqual(["合同.pdf", "Résumé.docx", "отчёт 2026.xlsx"])
  })

  it("never reuses a name in the folder", () => {
    expect(attachmentNames(["a.pdf", "A.pdf", "a.pdf"])).toEqual([
      "a.pdf",
      "A-2.pdf",
      "a-3.pdf",
    ])
  })

  it("does not take a reserved name", () => {
    expect(attachmentNames(["message.md"], ["message.md"])).toEqual([
      "message-2.md",
    ])
    expect(attachmentNames(["MESSAGE.md"], ["message.md"])).toEqual([
      "MESSAGE-2.md",
    ])
  })

  it("cannot leave the folder or hide a file", () => {
    const [up, hidden, slash] = attachmentNames([
      "../../secrets.txt",
      ".env",
      "a/b\\c.txt",
    ])
    // No separator is left, so dots in the name cannot climb out.
    expect(up).not.toMatch(/[/\\]/)
    expect(up.startsWith(".")).toBe(false)
    expect(hidden.startsWith(".")).toBe(false)
    expect(slash).toBe("a_b_c.txt")
  })

  it("names a missing or empty file name", () => {
    expect(attachmentNames([undefined, "", "..."])).toEqual([
      "attachment",
      "attachment-2",
      "attachment-3",
    ])
  })

  it("caps long names and keeps the extension", () => {
    const [name] = attachmentNames([`${"x".repeat(300)}.pdf`])
    expect(name.length).toBeLessThan(100)
    expect(name.endsWith(".pdf")).toBe(true)
  })
})
