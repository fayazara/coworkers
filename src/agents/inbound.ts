/**
 * Helpers for what arrives from outside: webhook deliveries and email
 * attachments. Pure, so they can be tested without a Durable Object.
 */

/** Headers senders use to mark retries of one delivery. */
const DELIVERY_HEADERS = ["x-github-delivery", "webhook-id", "idempotency-key"]

/** The sender's id for this delivery, so a retry is not handled twice. */
export function webhookDeliveryId(headers: Headers): string | undefined {
  for (const name of DELIVERY_HEADERS) {
    const value = headers.get(name)?.trim()
    if (value) return value.slice(0, 200)
  }
  return undefined
}

const MAX_STEM = 80
const MAX_EXT = 10

/**
 * File names for attachments saved into one folder. Letters and digits in
 * any script are kept; anything else unsafe becomes `_`. No two names are
 * the same, ignoring case, and none is one of `reserved`.
 */
export function attachmentNames(
  names: (string | undefined)[],
  reserved: string[] = []
): string[] {
  const used = new Set(reserved.map((name) => name.toLowerCase()))
  return names.map((original) => {
    const clean = (original ?? "")
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N}._\- ]+/gu, "_")
      .replace(/^[.\s]+|\s+$/g, "")
    const dot = clean.lastIndexOf(".")
    const stem = (dot > 0 ? clean.slice(0, dot) : clean).slice(0, MAX_STEM)
    const ext = dot > 0 ? clean.slice(dot).slice(0, MAX_EXT + 1) : ""
    const base = stem || "attachment"
    let name = base + ext
    for (let n = 2; used.has(name.toLowerCase()); n++)
      name = `${base}-${n}${ext}`
    used.add(name.toLowerCase())
    return name
  })
}
