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

/** Net GEX at current spot for one strike, with the 0DTE portion broken out. */
export interface GexProfileStrike {
  strike: number;
  netGEX: number;
  zeroDteGEX: number;
}

/** Total net GEX if the underlying moved to `price` (IV held fixed). */
export interface GexProfilePoint {
  price: number;
  netGEX: number;
  netGEXExZeroDte: number;
}

export interface GexProfileResponse {
  symbol: string;
  spot: number;
  /** Timestamp of the (delayed) spot quote. */
  spotTime: string;
  fetchedAt: string;
  expirationCount: number;
  zeroDteExpiration: string | null;
  rangePct: number;
  /** Contracts with open interest but no usable IV on either side (excluded). */
  contractsWithoutIV: number;
  stale?: boolean;
  /** Why the live fetch failed when serving a stale profile. */
  staleReason?: string;
  strikes: GexProfileStrike[];
  profile: GexProfilePoint[];
  netAtSpot: { all: number; exZeroDte: number; zeroDte: number };
  flip: { all: number | null; exZeroDte: number | null };
  largestZeroDteStrike: number | null;
}
