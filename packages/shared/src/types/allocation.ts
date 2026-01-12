/**
 * Allocation profile and target types
 */

import type { AssetClass } from "./assetClass.js";

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

export interface AllocationBreakdown {
  id: string;
  name: string;
  color: string;
  value: number;
  percentage: number;
}
