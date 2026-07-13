/**
 * Simple in-process semaphore. Used to bound concurrency of expensive
 * operations (currently: document-agent runs against the Anthropic API)
 * so a flurry of split children doesn't blow through Anthropic's
 * 800K-input-tokens/minute org rate limit and produce a wave of 429s.
 *
 * Per-process only. In a multi-instance deploy this won't help across
 * instances; a Redis-backed bucket would be the right next step. For now
 * the worker runs in one process so this is sufficient.
 */

export class Semaphore {
  private slots: number;
  private waiters: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error(`Semaphore: maxConcurrency must be >= 1, got ${maxConcurrency}`);
    }
    this.slots = maxConcurrency;
  }

  /** Run `fn` while holding a slot. Releases the slot whether `fn`
   *  resolves or rejects. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.slots += 1;
    }
  }
}
