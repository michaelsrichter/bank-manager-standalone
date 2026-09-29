import type { ClientTiming } from "./api";

/** Measures one streamed comparison as seen by the browser. */
export class StreamTimer {
  private readonly started: number;
  private firstEventMs = 0;
  private eventCount = 0;
  outcome: ClientTiming["outcome"] = "done";

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.started = clock();
  }

  event(type: string): void {
    if (this.eventCount === 0) this.firstEventMs = Math.round(this.clock() - this.started);
    this.eventCount += 1;
    if (type === "error") this.outcome = "error";
  }

  finish(modelKey: string): ClientTiming {
    return {
      firstEventMs: this.firstEventMs,
      totalMs: Math.round(this.clock() - this.started),
      eventCount: this.eventCount,
      outcome: this.outcome,
      modelKey,
    };
  }
}
