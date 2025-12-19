const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Types
export interface AssetClass {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  _count?: { securityAssignments: number };
}

export interface AllocationTarget {
  id: string;
  assetClassId: string;
  targetPercentage: number;
  assetClass: AssetClass;
}

export interface AllocationProfile {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  targets: AllocationTarget[];
}

export interface SecurityAssignment {
  id: string;
  symbol: string;
  conId: number | null;
  secType: string;
  assetClassId: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  assetClass: AssetClass;
}

export interface Position {
  account: string;
  symbol: string;
  conId: number;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  avgCost: number;
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  // Option-specific fields
  strike?: number;
  expiry?: string;
  right?: "C" | "P";
  underlying?: string;
  notionalValue?: number;
  deltaExposure?: number;
  // Enriched data
  assetClassId: string | null;
  assetClassName: string | null;
  assetClassColor: string | null;
}

export interface AssetClassAllocation {
  id: string;
  name: string;
  color: string;
  value: number;
  stockValue: number;
  optionsNotional: number;
  optionsDelta: number;
  percentage: number;
}

export interface OptionsExposure {
  assetClassId: string;
  assetClassName: string;
  assetClassColor: string;
  putNotional: number;
  callNotional: number;
  putDelta: number;
  callDelta: number;
  netNotional: number;
  netDelta: number;
}

export interface PositionSummary {
  positions: Position[];
  summary: {
    totalPositions: number;
    totalValue: number;
    totalStockValue: number;
    totalOptionsNotional: number;
    totalOptionsDelta: number;
    unassignedValue: number;
    unassignedPercentage: number;
    includeOptions: boolean;
    optionsWeightMode: "notional" | "delta";
    byAssetClass: AssetClassAllocation[];
    optionsExposure: OptionsExposure[];
  };
  account: {
    netLiquidation: number;
    cashValue: number;
  };
}

export interface DashboardSettings {
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
  chartsExpanded: boolean;
}

export interface SparklinePoint {
  date: string;
  close: number;
}

export interface SparklineData {
  symbol: string;
  data: SparklinePoint[];
}

// Asset Classes API
export const assetClasses = {
  list: () => request<AssetClass[]>("/api/asset-classes"),
  get: (id: string) => request<AssetClass>(`/api/asset-classes/${id}`),
  create: (data: { name: string; description?: string; color?: string }) =>
    request<AssetClass>("/api/asset-classes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string; color?: string }) =>
    request<AssetClass>(`/api/asset-classes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/asset-classes/${id}`, { method: "DELETE" }),
};

// Allocation Profiles API
export const allocationProfiles = {
  list: () => request<AllocationProfile[]>("/api/allocation-profiles"),
  getActive: () => request<AllocationProfile>("/api/allocation-profiles/active"),
  get: (id: string) => request<AllocationProfile>(`/api/allocation-profiles/${id}`),
  create: (data: {
    name: string;
    isActive?: boolean;
    targets?: { assetClassId: string; targetPercentage: number }[];
  }) =>
    request<AllocationProfile>("/api/allocation-profiles", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      targets?: { assetClassId: string; targetPercentage: number }[];
    }
  ) =>
    request<AllocationProfile>(`/api/allocation-profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  activate: (id: string) =>
    request<AllocationProfile>(`/api/allocation-profiles/${id}/activate`, {
      method: "POST",
    }),
  delete: (id: string) =>
    request<void>(`/api/allocation-profiles/${id}`, { method: "DELETE" }),
};

// Positions API
export const positions = {
  list: () => request<Position[]>("/api/positions"),
  summary: (options?: { includeOptions?: boolean; optionsWeightMode?: "notional" | "delta" }) => {
    const params = new URLSearchParams();
    if (options?.includeOptions !== undefined) {
      params.set("includeOptions", String(options.includeOptions));
    }
    if (options?.optionsWeightMode) {
      params.set("optionsWeightMode", options.optionsWeightMode);
    }
    const query = params.toString();
    return request<PositionSummary>(`/api/positions/summary${query ? `?${query}` : ""}`);
  },
};

// Settings API
export const settings = {
  get: <T>(key: string) => request<{ key: string; value: T }>(`/api/settings/${key}`),
  set: <T>(key: string, value: T) =>
    request<{ key: string; value: T }>(`/api/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  getDashboard: () =>
    settings.get<DashboardSettings>("dashboard").then((r) => r.value),
  setDashboard: (value: DashboardSettings) =>
    settings.set<DashboardSettings>("dashboard", value).then((r) => r.value),
};

// Security Assignments API
export const securityAssignments = {
  list: () => request<SecurityAssignment[]>("/api/security-assignments"),
  get: (symbol: string, secType = "STK") =>
    request<SecurityAssignment>(`/api/security-assignments/${symbol}?secType=${secType}`),
  create: (data: {
    symbol: string;
    conId?: number;
    secType?: string;
    assetClassId: string;
    source?: string;
  }) =>
    request<SecurityAssignment>("/api/security-assignments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { assetClassId: string }) =>
    request<SecurityAssignment>(`/api/security-assignments/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/security-assignments/${id}`, { method: "DELETE" }),
};

// Watchlist types
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

// Watchlists API
export const watchlists = {
  list: () => request<Watchlist[]>("/api/watchlists"),
  get: (id: string) => request<WatchlistWithItems>(`/api/watchlists/${id}`),
  create: (data: { name: string }) =>
    request<Watchlist>("/api/watchlists", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name: string }) =>
    request<Watchlist>(`/api/watchlists/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/watchlists/${id}`, { method: "DELETE" }),
  addItem: (id: string, data: { symbol: string; conId?: number; secType?: string }) =>
    request<WatchlistItem>(`/api/watchlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeItem: (id: string, itemId: string) =>
    request<void>(`/api/watchlists/${id}/items/${itemId}`, { method: "DELETE" }),
};

// Order types
export interface Order {
  orderId: number;
  symbol: string;
  displayName: string;
  conId: number;
  secType: string;
  right?: "P" | "C";
  action: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  limitPrice?: number;
  status: string;
  filledQuantity: number;
  avgFillPrice: number;
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
  estimatedValue?: number;
}

export interface AllocationBreakdown {
  id: string;
  name: string;
  color: string;
  value: number;
  percentage: number;
}

export interface OrderImpact {
  orders: Order[];
  currentAllocation: AllocationBreakdown[];
  projectedAllocation: AllocationBreakdown[];
  totalCurrentValue: number;
  totalProjectedValue: number;
}

// Orders API
export const orders = {
  list: () => request<Order[]>("/api/orders"),
  impact: () => request<OrderImpact>("/api/orders/impact"),
  simulate: (orders: { symbol: string; secType?: string; action: "BUY" | "SELL"; quantity: number; price: number }[]) =>
    request<OrderImpact>("/api/orders/simulate", {
      method: "POST",
      body: JSON.stringify({ orders }),
    }),
};

// Scanner types
export interface ScannerCriteria {
  minDaysToExpiry: number;
  maxDaysToExpiry: number;
  minDelta: number;
  maxDelta: number;
  minAnnualizedReturn: number;
  minPremiumPercent: number;
  targetAssetClasses?: string[];
}

export interface ScannerPreset {
  id: string;
  name: string;
  criteria: ScannerCriteria;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnderinvestedClass {
  id: string;
  name: string;
  color: string;
  targetPercentage: number;
  currentPercentage: number;
  difference: number;
  currentValue: number;
  targetValue: number;
  shortfall: number;
}

export interface ScanResult {
  criteria: ScannerCriteria;
  targetAssetClasses: string[];
  symbolsScanned: string[];
  opportunities: any[];
  message?: string;
}

// Scanner API
export const scanner = {
  presets: {
    list: () => request<ScannerPreset[]>("/api/scanner/presets"),
    get: (id: string) => request<ScannerPreset>(`/api/scanner/presets/${id}`),
    create: (data: { name: string; criteria: ScannerCriteria; isDefault?: boolean }) =>
      request<ScannerPreset>("/api/scanner/presets", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; criteria?: ScannerCriteria; isDefault?: boolean }) =>
      request<ScannerPreset>(`/api/scanner/presets/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/api/scanner/presets/${id}`, { method: "DELETE" }),
  },
  scan: (criteria: ScannerCriteria) =>
    request<ScanResult>("/api/scanner/scan", {
      method: "POST",
      body: JSON.stringify(criteria),
    }),
  underinvested: () =>
    request<{ underinvested: UnderinvestedClass[]; totalPortfolioValue: number }>("/api/scanner/underinvested"),
};

// Historical Data API
export const historical = {
  getSparkline: (symbol: string) =>
    request<SparklineData>(
      `/api/historical/sparkline/${encodeURIComponent(symbol)}`
    ),
  getBatchSparklines: (symbols: string[]) =>
    request<Record<string, SparklinePoint[]>>("/api/historical/sparklines", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
};

export const api = {
  assetClasses,
  allocationProfiles,
  positions,
  securityAssignments,
  watchlists,
  orders,
  scanner,
  settings,
  historical,
};
