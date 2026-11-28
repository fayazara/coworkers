/**
 * Runs shell commands one at a time per exec backend. Each backend has a
 * single session, and commands run in it at once mix their output. Lanes
 * are independent: a long `npm install` in the Linux container does not
 * hold up a quick `curl` in the Worker shell.
 */
export class ExecQueues {
  #tails = new Map<string, Promise<unknown>>()

  run<T>(lane: string, task: () => Promise<T>): Promise<T> {
    const tail = this.#tails.get(lane) ?? Promise.resolve()
    const result = tail.then(task)
    // A failed command must not block the ones after it.
    this.#tails.set(
      lane,
      result.catch(() => undefined)
    )
    return result
  }
}

/** The exec backend a model's tool input names; the Worker shell by default. */
export function execLane(input: unknown): "shell" | "linux" {
  return (input as { backend?: unknown } | null)?.backend === "linux"
    ? "linux"
    : "shell"
}
