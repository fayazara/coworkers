import { describe, expect, it } from "vitest"
import { authHeader, httpsOrigin, redact, validSecretName } from "./secrets"

describe("httpsOrigin", () => {
  it("accepts plain https and returns the origin", () => {
    expect(httpsOrigin("https://api.github.com/user?x=1")).toBe(
      "https://api.github.com"
    )
  })
  it("rejects http, credentials in the URL and junk", () => {
    expect(httpsOrigin("http://api.github.com")).toBeNull()
    expect(httpsOrigin("https://user:pw@api.github.com")).toBeNull()
    expect(httpsOrigin("not a url")).toBeNull()
  })
  it("treats a different port or subdomain as a different origin", () => {
    expect(httpsOrigin("https://api.github.com:8443/")).not.toBe(
      "https://api.github.com"
    )
    expect(httpsOrigin("https://evil.api.github.com/")).not.toBe(
      "https://api.github.com"
    )
  })
})

describe("redact", () => {
  it("removes plain, URL-encoded and base64 echoes", () => {
    const secret = "s3cr3t/+value"
    const text = `a ${secret} b ${encodeURIComponent(secret)} c ${btoa(secret)}`
    expect(redact(text, secret)).toBe("a [redacted] b [redacted] c [redacted]")
  })
})

describe("authHeader", () => {
  const meta = {
    name: "T",
    origin: "https://x.test",
    header: "X-Key",
    purpose: "",
    createdAt: 0,
  }
  it("builds each scheme", () => {
    expect(authHeader({ ...meta, scheme: "bearer" }, "v")).toEqual([
      "Authorization",
      "Bearer v",
    ])
    expect(authHeader({ ...meta, scheme: "basic" }, "u:p")).toEqual([
      "Authorization",
      `Basic ${btoa("u:p")}`,
    ])
    expect(authHeader({ ...meta, scheme: "header" }, "v")).toEqual([
      "X-Key",
      "v",
    ])
  })
})

describe("validSecretName", () => {
  it("allows simple ids only", () => {
    expect(validSecretName("GITHUB_TOKEN")).toBe(true)
    expect(validSecretName("1BAD")).toBe(false)
    expect(validSecretName("has space")).toBe(false)
  })
})
