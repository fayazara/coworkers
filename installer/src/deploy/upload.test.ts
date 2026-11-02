import { describe, expect, it } from "vitest"
import { migrationsFor, vapidKeys } from "./upload"

describe("vapidKeys", () => {
  it("makes a P-256 pair in web-push's base64url format", async () => {
    const { publicKey, privateKey } = await vapidKeys()
    // 65-byte uncompressed point and a 32-byte scalar.
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("migrationsFor", () => {
  const classes = [
    "UserHub",
    "BotAgent",
    "AppLive",
    "OAuthStore",
    "EmailDirectory",
  ]

  it("creates every class on a first install", () => {
    expect(migrationsFor(classes, { fresh: true })).toEqual({
      new_tag: "v3",
      steps: [{ new_sqlite_classes: classes }],
    })
  })

  it("adds only the classes an older install lacks", () => {
    expect(
      migrationsFor(classes, { fresh: false, migrationTag: "v1" })
    ).toEqual({
      old_tag: "v1",
      new_tag: "v3",
      steps: [
        { new_sqlite_classes: ["OAuthStore"] },
        { new_sqlite_classes: ["EmailDirectory"] },
      ],
    })
  })

  it("sends nothing to an install that is up to date", () => {
    expect(
      migrationsFor(classes, { fresh: false, migrationTag: "v3" })
    ).toBeNull()
  })

  it("refuses a class the history does not list", () => {
    expect(() =>
      migrationsFor([...classes, "NewThing"], { fresh: true })
    ).toThrow("CLASS_HISTORY does not list NewThing")
  })
})
