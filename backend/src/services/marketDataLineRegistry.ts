const DEFAULT_MAX_LINES = 100;

export class MarketDataLineRegistry {
  private maxLines: number;
  private reservations = new Map<string, number>();

  constructor(maxLines = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  available(): number {
    let used = 0;
    for (const count of this.reservations.values()) {
      used += count;
    }
    return Math.max(0, this.maxLines - used);
  }

  reserve(sessionId: string, requested: number): number {
    const granted = Math.min(requested, this.available());
    if (granted > 0) {
      const existing = this.reservations.get(sessionId) ?? 0;
      this.reservations.set(sessionId, existing + granted);
    }
    return granted;
  }

  release(sessionId: string): void {
    this.reservations.delete(sessionId);
  }
}

export const marketDataLineRegistry = new MarketDataLineRegistry();
