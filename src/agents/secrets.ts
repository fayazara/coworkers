/**
 * Credentials a bot uses without ever seeing them. The value is typed into a
 * masked card, stored in the bot's Durable Object, and only attached to
 * requests to the exact HTTPS origin it was saved for.
 */

import type { SecretMeta } from "@/lib/types"

export type { SecretMeta, SecretScheme } from "@/lib/types"

/** Longest response body handed back to the model, in characters. */
export const MAX_SECRET_RESPONSE_CHARS = 20_000
export const SECRET_REQUEST_TIMEOUT_MS = 30_000

/** `https://host[:port]`, or null for anything that is not plain HTTPS. */
export function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/** A secret name the model can refer to: letters, digits, `_` and `-`. */
export function validSecretName(name: string) {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
}

export function authHeader(meta: SecretMeta, value: string): [string, string] {
  switch (meta.scheme) {
    case "bearer":
      return ["Authorization", `Bearer ${value}`]
    case "basic":
      return ["Authorization", `Basic ${btoa(value)}`]
    case "header":
      return [meta.header, value]
  }
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * The base64 text that always appears when `bytes` sit inside a longer
 * encoded blob, for each of the three byte offsets the value can start at.
 * The characters at either end mix in neighbouring bytes, so they are left
 * out.
 */
function embeddedBase64(bytes: Uint8Array): string[] {
  const out: string[] = []
  for (let offset = 0; offset < 3; offset++) {
    const padded = new Uint8Array(offset + bytes.length)
    padded.set(bytes, offset)
    const start = Math.ceil((offset * 8) / 6)
    const end = Math.floor(((offset + bytes.length) * 8) / 6)
    out.push(base64(padded).slice(start, end))
  }
  return out
}

/** Remove every form of the secret a response could echo back. */
export function redact(text: string, value: string): string {
  if (value.length < 4) return text
  const bytes = new TextEncoder().encode(value)
  const b64 = base64(bytes)
  const forms = new Set([value, encodeURIComponent(value), b64])
  try {
    forms.add(btoa(value))
  } catch {
    // Not Latin-1: btoa cannot encode it, so only the UTF-8 forms apply.
  }
  for (const form of [b64.replace(/=+$/, ""), base64url(b64)]) forms.add(form)
  for (const core of embeddedBase64(bytes)) {
    forms.add(core)
    forms.add(base64url(core))
  }
  // Longest first, so a whole encoded value goes before the shorter core
  // inside it and no stray characters are left behind.
  const ordered = [...forms].filter(Boolean).sort((a, b) => b.length - a.length)
  let out = text
  for (const form of ordered) out = out.split(form).join("[redacted]")
  return out
}
