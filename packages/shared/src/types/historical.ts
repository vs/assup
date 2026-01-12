/**
 * Historical data types for charts and sparklines
 */

export interface SparklinePoint {
  date: string;
  close: number;
}

export interface SparklineData {
  symbol: string;
  data: SparklinePoint[];
}

export interface SparklineBatchRequest {
  symbols: string[];
}

export type SparklineBatchResponse = Record<string, SparklinePoint[]>;
