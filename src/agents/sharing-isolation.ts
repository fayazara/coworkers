interface IsolationSteps {
  /** Both context isolation and the persisted browser reset must be complete. */
  ready(): boolean
  assertIdle(): void
  isolate(): void
  closeBrowser(): Promise<void>
  complete(): void
}

/** Coalesce concurrent sharing attempts; durable completion is owned by the bot. */
export class SharingIsolation {
  #pending: Promise<void> | undefined

  constructor(private readonly steps: IsolationSteps) {}

  enable(): Promise<void> {
    if (this.#pending) return this.#pending
    if (this.steps.ready()) return Promise.resolve()
    this.#pending = this.finish().finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  private async finish() {
    this.steps.assertIdle()
    // Keep isolation even if reset fails. No caller may publish a grant until
    // this entire operation succeeds; a retry/restart must repeat the reset.
    this.steps.isolate()
    await this.steps.closeBrowser()
    this.steps.complete()
  }
}
