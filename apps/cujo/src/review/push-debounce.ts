/**
 * A push burst is one run (decision 144).
 *
 * Three pushes in a minute used to be three runs: each claimed its row at the
 * delivery, started a turn, and was cancelled by the next one after it had
 * spent its setup and often a check. The row is still claimed at the
 * delivery, because that is what makes a redelivery a no-op (decision 16);
 * only the start waits. A newer push inside the window drops the older
 * pending start, and the run that does start supersedes the rows the dropped
 * ones left behind, exactly as it would have superseded live runs.
 *
 * Timers are unref'd so a pending start never holds the process open, and
 * `flush` fires everything pending at once for the shutdown path: a row
 * left `running` with no turn is an error on the next boot, and a start
 * that got as far as the turn is a run the next boot follows.
 */
export class PushDebounce {
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; fire: () => void }>();

  constructor(private readonly delayMs: number) {}

  /**
   * Run `fire` after the window, unless another `schedule` for the same key
   * arrives first, in which case only the later one runs. Returns whether it
   * waited; with no window it runs at once and says so.
   */
  schedule(key: string, fire: () => void): boolean {
    if (this.delayMs <= 0) {
      fire();
      return false;
    }
    const earlier = this.pending.get(key);
    if (earlier) clearTimeout(earlier.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      fire();
    }, this.delayMs);
    timer.unref?.();
    this.pending.set(key, { timer, fire });
    return true;
  }

  /** Fire every pending start now. */
  flush(): void {
    for (const [key, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(key);
      entry.fire();
    }
  }

  get size(): number {
    return this.pending.size;
  }
}
