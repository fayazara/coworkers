import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ExecQueues, execLane } from "./exec-queue"

/** A task that finishes when told to, recording when it starts and ends. */
function gate(log: string[], name: string) {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  const task = async () => {
    log.push(`${name} start`)
    await opened
    log.push(`${name} end`)
    return name
  }
  return { task, open }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("ExecQueues", () => {
  it("runs commands on one backend one at a time, in order", async () => {
    const queues = new ExecQueues()
    const log: string[] = []
    const a = gate(log, "a")
    const b = gate(log, "b")
    const first = queues.run("shell", a.task)
    const second = queues.run("shell", b.task)
    await tick()
    expect(log).toEqual(["a start"])
    a.open()
    b.open()
    expect(await first).toBe("a")
    expect(await second).toBe("b")
    expect(log).toEqual(["a start", "a end", "b start", "b end"])
  })

  it("does not hold the Worker shell behind a slow container command", async () => {
    const queues = new ExecQueues()
    const log: string[] = []
    const install = gate(log, "npm install")
    const pending = queues.run("linux", install.task)
    const curl = await queues.run("shell", async () => "curl")
    expect(curl).toBe("curl")
    expect(log).toEqual(["npm install start"])
    install.open()
    await pending
  })

  it("keeps going after a command fails", async () => {
    const queues = new ExecQueues()
    const failed = queues.run("shell", async () => {
      throw new Error("exit 1")
    })
    const next = queues.run("shell", async () => "ok")
    await expect(failed).rejects.toThrow("exit 1")
    expect(await next).toBe("ok")
  })
})

describe("execLane", () => {
  it("routes only an explicit linux backend to the container", () => {
    expect(execLane({ command: "node -v", backend: "linux" })).toBe("linux")
    expect(execLane({ command: "ls", backend: "shell" })).toBe("shell")
    expect(execLane({ command: "ls" })).toBe("shell")
    expect(execLane(null)).toBe("shell")
  })
})

describe("container image", () => {
  it("pins computerd to the installed @cloudflare/computer version", () => {
    // A mismatched computerd speaks a different sync protocol than the
    // backend in the Worker, and every linux command fails.
    const dockerfile = readFileSync("container/Dockerfile", "utf8")
    const tag = /computer-computerd-linux-x64:(\S+)/.exec(dockerfile)?.[1]
    const { version } = JSON.parse(
      readFileSync("node_modules/@cloudflare/computer/package.json", "utf8")
    ) as { version: string }
    expect(tag).toBe(version)
  })
})
