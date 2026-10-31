import { describe, expect, it } from "vitest"
import { authHeader, httpsOrigin, redact, validSecretName } from "./secrets"

describe("httpsOrigin", () => {
  it("accepts plain https and returns the origin", () => {
    expect(httpsOrigin("https://api.github.com/user?x=1")).toBe("https://api.github.com")
  })
  it("rejects http, credentials in the URL and junk", () => {
    expect(httpsOrigin("http://api.github.com")).toBeNull()
    expect(httpsOrigin("https://user:pw@api.github.com")).toBeNull()
    expect(httpsOrigin("not a url")).toBeNull()
  })
  it("treats a different port or subdomain as a different origin", () => {
    expect(httpsOrigin("https://api.github.com:8443/")).not.toBe("https://api.github.com")
    expect(httpsOrigin("https://evil.api.github.com/")).not.toBe("https://api.github.com")
  })
})

describe("redact", () => {
  it("removes plain, URL-encoded and base64 echoes", () => {
    const secret = "s3cr3t/+value"
    const text = `a ${secret} b ${encodeURIComponent(secret)} c ${btoa(secret)}`
    expect(redact(text, secret)).toBe("a [redacted] b [redacted] c [redacted]")
  })

  it("removes base64 without padding and base64url", () => {
    // 13 bytes, so the base64 ends in padding and contains + and /.
    const secret = "s3cr3t/+value"
    const b64 = btoa(secret)
    expect(b64).toMatch(/=$/)
    const unpadded = b64.replace(/=+$/, "")
    const url = unpadded.replace(/\+/g, "-").replace(/\//g, "_")
    expect(redact(`a ${unpadded} b ${url} c`, secret)).toBe(
      "a [redacted] b [redacted] c"
    )
  })

  it("removes base64 of a non-Latin-1 value", () => {
    const secret = "pässwörd-🔑"
    const encoded = btoa(
      String.fromCharCode(...new TextEncoder().encode(secret))
    )
    expect(redact(`x ${encoded} y`, secret)).toBe("x [redacted] y")
  })

  it("removes the value from inside a longer base64 blob", () => {
    const secret = "tok_9f8e7d6c5b4a"
    // One prefix for each byte offset the value can start at.
    for (const prefix of ["", "a", "ab"]) {
      const blob = btoa(`${prefix}${secret}&scope=all`)
      const left = redact(blob, secret).split("[redacted]")
      expect(left).toHaveLength(2)
      // Only the edge characters that mix in neighbouring bytes stay.
      const removed = blob.length - left.join("").length
      expect(removed).toBeGreaterThanOrEqual((secret.length * 4) / 3 - 2)
    }
  })

  it("leaves unrelated text alone", () => {
    expect(redact("nothing to see here", "s3cr3t-value")).toBe(
      "nothing to see here"
    )
  })
})

describe("authHeader", () => {
  const meta = { name: "T", origin: "https://x.test", header: "X-Key", purpose: "", createdAt: 0 }
  it("builds each scheme", () => {
    expect(authHeader({ ...meta, scheme: "bearer" }, "v")).toEqual(["Authorization", "Bearer v"])
    expect(authHeader({ ...meta, scheme: "basic" }, "u:p")).toEqual(["Authorization", `Basic ${btoa("u:p")}`])
    expect(authHeader({ ...meta, scheme: "header" }, "v")).toEqual(["X-Key", "v"])
  })
})

describe("validSecretName", () => {
  it("allows simple ids only", () => {
    expect(validSecretName("GITHUB_TOKEN")).toBe(true)
    expect(validSecretName("1BAD")).toBe(false)
    expect(validSecretName("has space")).toBe(false)
  })
})
