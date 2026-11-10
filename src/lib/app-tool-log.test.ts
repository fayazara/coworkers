import { describe, expect, it } from "vitest"
import { plainReason } from "./app-tool-log"

describe("plainReason", () => {
  it("says why a call was blocked, in plain words", () => {
    expect(plainReason("Too many requests. Try again in 4 min.")).toBe(
      "Blocked: too many from one visitor, try again in 4 min"
    )
    expect(
      plainReason(
        "The user has not allowed this app to use Executor (call) yet. They allow it in the Apps tab."
      )
    ).toBe("Blocked: not allowed yet")
    expect(
      plainReason(
        'calls[].path "tools.gmail.send" is not one the user allowed for this app'
      )
    ).toBe("Blocked: tried something you didn't allow")
    expect(plainReason("calls[].path is missing")).toBe(
      "Blocked: tried something you didn't allow"
    )
    expect(
      plainReason("The user's rules block this bot from using connected apps")
    ).toBe("Blocked by the bot's rules")
    expect(plainReason("Executor is not connected right now")).toBe(
      "Failed: app not connected"
    )
  })

  it("passes the app's own error through, shortened", () => {
    expect(plainReason("403: insufficient permissions")).toBe(
      "Failed: 403: insufficient permissions"
    )
    expect(plainReason("x".repeat(500))).toHaveLength("Failed: ".length + 120)
    expect(plainReason(undefined)).toBe("Failed: unknown error")
  })
})
