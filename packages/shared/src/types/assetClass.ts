/**
 * Asset class types for organizing securities into investment categories
 */

export interface AssetClass {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  _count?: { securityAssignments: number };
}

