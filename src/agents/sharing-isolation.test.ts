import { describe, expect, it, vi } from "vitest"
import { SharingIsolation } from "./sharing-isolation"

function fixture(isolated = false) {
  const persisted = { isolated, resetComplete: false, emails: [] as string[] }
  const browser = { privateSessionOpen: true }
  const closeBrowser = vi.fn(async () => {
    browser.privateSessionOpen = false
  })
  const assertIdle = vi.fn()
  const restart = () =>
    new SharingIsolation({
      ready: () => persisted.isolated && persisted.resetComplete,
      assertIdle,
      isolate: () => {
        persisted.isolated = true
      },
      closeBrowser,
      complete: () => {
        persisted.resetComplete = true
      },
    })
  async function invite(gate: SharingIsolation) {
    await gate.enable()
    persisted.emails.push("member@example.com")
  }
  return { persisted, browser, closeBrowser, assertIdle, restart, invite }
}

describe("sharing browser reset", () => {
  it("keeps context isolated but grants no membership when reset fails, then retries", async () => {
    const f = fixture()
    f.closeBrowser.mockRejectedValueOnce(new Error("Browser unavailable"))
    const gate = f.restart()
    await expect(f.invite(gate)).rejects.toThrow("Browser unavailable")
    expect(f.persisted).toEqual({
      isolated: true,
      resetComplete: false,
      emails: [],
    })
    expect(f.browser.privateSessionOpen).toBe(true)
    await f.invite(gate)
    expect(f.closeBrowser).toHaveBeenCalledTimes(2)
    expect(f.browser.privateSessionOpen).toBe(false)
    expect(f.persisted.resetComplete).toBe(true)
    expect(f.persisted.emails).toEqual(["member@example.com"])
  })
  it("retries an incomplete reset after an object restart", async () => {
    const f = fixture()
    f.closeBrowser.mockRejectedValueOnce(new Error("Connection lost"))
    await expect(f.invite(f.restart())).rejects.toThrow("Connection lost")
    await f.invite(f.restart())
    expect(f.closeBrowser).toHaveBeenCalledTimes(2)
    expect(f.browser.privateSessionOpen).toBe(false)
  })
  it("does not trust the isolated flag from older deployments as reset completion", async () => {
    const f = fixture(true)
    f.closeBrowser.mockRejectedValueOnce(new Error("Still unavailable"))
    await expect(f.invite(f.restart())).rejects.toThrow("Still unavailable")
    expect(f.persisted.emails).toEqual([])
    await f.invite(f.restart())
    expect(f.closeBrowser).toHaveBeenCalledTimes(2)
  })
  it("makes concurrent invitations wait for the same successful reset", async () => {
    const f = fixture()
    let release!: () => void
    f.closeBrowser.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            f.browser.privateSessionOpen = false
            resolve()
          }
        })
    )
    const gate = f.restart()
    const first = f.invite(gate)
    const second = f.invite(gate)
    expect(f.closeBrowser).toHaveBeenCalledTimes(1)
    expect(f.persisted.emails).toEqual([])
    expect(f.persisted.resetComplete).toBe(false)
    release()
    await Promise.all([first, second])
    expect(f.persisted.emails).toHaveLength(2)
    expect(f.browser.privateSessionOpen).toBe(false)
  })
  it("requires idle state on retries and preserves isolation while busy", async () => {
    const f = fixture(true)
    f.assertIdle.mockImplementationOnce(() => {
      throw new Error("Busy")
    })
    await expect(f.invite(f.restart())).rejects.toThrow("Busy")
    expect(f.closeBrowser).not.toHaveBeenCalled()
    expect(f.persisted).toEqual({
      isolated: true,
      resetComplete: false,
      emails: [],
    })
    await f.invite(f.restart())
    expect(f.browser.privateSessionOpen).toBe(false)
  })
  it("preserves a completed reset across restarts without closing the shared browser again", async () => {
    const f = fixture()
    await f.invite(f.restart())
    await f.invite(f.restart())
    expect(f.closeBrowser).toHaveBeenCalledTimes(1)
    expect(f.assertIdle).toHaveBeenCalledTimes(1)
  })
})
