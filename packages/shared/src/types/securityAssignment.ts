/**
 * Security assignment types for mapping securities to asset classes
 */

import type { AssetClass } from "./assetClass.js";

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

