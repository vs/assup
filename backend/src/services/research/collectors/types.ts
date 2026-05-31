export interface CollectedData {
  source: string;
  data: Record<string, unknown>;
  expiresAt: Date;
}

export interface SkippedCollection {
  _tag: "skipped";
  source: string;
  reason: string;
  expiresAt: Date;
}

export type CollectionResult = CollectedData | SkippedCollection;

export function isSkipped(r: CollectionResult): r is SkippedCollection {
  return typeof r === "object" && r !== null && "_tag" in r && r._tag === "skipped";
}

export interface Collector {
  source: string;
  defaultSchedule: string;
  stalenessMinutes: number;
  collect(symbol: string): Promise<CollectionResult>;
}
