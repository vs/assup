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
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
}

export interface WatchlistWithItems extends Watchlist {
  items: WatchlistItem[];
}

