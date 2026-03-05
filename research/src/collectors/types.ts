export interface CollectedData {
  source: string;
  data: Record<string, unknown>;
  expiresAt: Date;
}

export interface Collector {
  source: string;
  defaultSchedule: string;
  stalenessMinutes: number;
  collect(symbol: string): Promise<CollectedData>;
}
