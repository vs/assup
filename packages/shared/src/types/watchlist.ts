/**
 * Watchlist types for tracking securities of interest
 */

export interface Watchlist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
}

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  conId: number | null;
  secType: string;
  addedAt: string;
  source: string;
  lastAnalyzedAt: string | null;
  sortOrder: number;
  // Enrichment fields (from backend)
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
  // Research enrichment fields (from backend)
  latestRecommendation?: string | null;
  reportAge?: string | null;
}

export interface WatchlistWithItems extends Watchlist {
  items: WatchlistItem[];
}

