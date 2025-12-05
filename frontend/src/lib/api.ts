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
  marketValue?: number;
  assetClassId: string | null;
  assetClassName: string | null;
  assetClassColor: string | null;
}

export interface PositionSummary {
  positions: Position[];
  summary: {
    totalPositions: number;
    totalValue: number;
    unassignedValue: number;
    unassignedPercentage: number;
    byAssetClass: {
      id: string;
      name: string;
      color: string;
      value: number;
      percentage: number;
    }[];
  };
  account: {
    netLiquidation: number;
    cashValue: number;
  };
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
  summary: () => request<PositionSummary>("/api/positions/summary"),
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

export const api = {
  assetClasses,
  allocationProfiles,
  positions,
  securityAssignments,
};
