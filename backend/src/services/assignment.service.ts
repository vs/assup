/**
 * Service for managing security assignments and building assignment maps
 */

import { prisma } from "../db/index.js";

/**
 * Assignment data with asset class information
 */
export interface AssignmentWithClass {
  id: string;
  symbol: string;
  secType: string;
  assetClassId: string;
  assetClass: {
    id: string;
    name: string;
    color: string;
  };
}

/**
 * Map of symbol:secType -> assignment data
 */
export type AssignmentMap = Map<string, AssignmentWithClass>;

/**
 * Create a unique key for a security based on symbol and type
 */
export function getSecurityKey(symbol: string, secType: string): string {
  return `${symbol}:${secType}`;
}

class AssignmentService {
  /**
   * Build a lookup map for all security assignments
   * Key format: "SYMBOL:SECTYPE"
   */
  async getAssignmentMap(): Promise<AssignmentMap> {
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });

    return new Map(
      assignments.map((a) => [
        getSecurityKey(a.symbol, a.secType),
        {
          id: a.id,
          symbol: a.symbol,
          secType: a.secType,
          assetClassId: a.assetClassId,
          assetClass: {
            id: a.assetClass.id,
            name: a.assetClass.name,
            color: a.assetClass.color,
          },
        },
      ])
    );
  }

  /**
   * Look up assignment for a symbol with option underlying fallback
   * For options, tries to find the underlying stock assignment
   */
  lookupAssignment(
    map: AssignmentMap,
    symbol: string,
    secType: string
  ): AssignmentWithClass | undefined {
    const isOption = secType === "OPT";

    if (isOption) {
      // For options, first try to find the underlying stock assignment
      const stkAssignment = map.get(getSecurityKey(symbol, "STK"));
      if (stkAssignment) return stkAssignment;
    }

    // Fall back to direct lookup
    return map.get(getSecurityKey(symbol, secType));
  }
}

export const assignmentService = new AssignmentService();
