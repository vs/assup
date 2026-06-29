const DEFAULT_MAX_LINES = 100;

export class MarketDataLineRegistry {
  private maxLines: number;
  private reservations = new Map<string, number>();

  constructor(maxLines = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  used(): number {
    let total = 0;
    for (const count of this.reservations.values()) {
      total += count;
    }
    return total;
  }

  available(): number {
    return Math.max(0, this.maxLines - this.used());
  }

  reserve(sessionId: string, requested: number): number {
    const granted = Math.min(requested, this.available());
    if (granted > 0) {
      const existing = this.reservations.get(sessionId) ?? 0;
      this.reservations.set(sessionId, existing + granted);
    }
    if (granted < requested) {
      console.warn(
        `[MarketDataLines] ${sessionId}: requested ${requested}, granted ${granted} (${this.used()}/${this.maxLines} used)`,
      );
    }
    return granted;
  }

  release(sessionId: string): void {
    this.reservations.delete(sessionId);
  }

  /** Dump current reservations for debugging. */
  dump(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, count] of this.reservations) {
      out[id] = count;
    }
    return out;
  }
}

export const marketDataLineRegistry = new MarketDataLineRegistry();
