export interface GexStrikeData {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

export interface GexKeyLevels {
  putWall: { strike: number; oi: number };
  callWall: { strike: number; oi: number };
  gexFlip: number | null;
  maxPositiveGEX: { strike: number; gex: number };
  maxNegativeGEX: { strike: number; gex: number };
}

export interface GexSummary {
  totalPutOI: number;
  totalCallOI: number;
  putCallRatio: number;
  netGEXRegime: "positive" | "negative";
  gexFlipLevel: number | null;
}

export interface GexAnalysisResponse {
  symbol: string;
  spot: number;
  fetchedAt: string;
  expirations: string[];
  analyzedExpiration: string | null;
  isAggregate: boolean;
  stale?: boolean;
  strikes: GexStrikeData[];
  levels: GexKeyLevels;
  summary: GexSummary;
}
