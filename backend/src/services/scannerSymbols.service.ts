/**
 * Shared symbol resolution for option scanning.
 * Collects symbols from positions and watchlists, resolves asset class assignments.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { isIgnorablePositionError } from "../utils/errorUtils.js";

export interface SymbolAssignment {
  symbol: string;
  assetClass: { name: string; color: string };
}

/**
 * Collect unique stock symbols from IBKR positions and watchlists,
 * filter by target asset classes, and return symbol-to-asset-class mappings.
 */
export async function resolveSymbolAssignments(options: {
  specificSymbol?: string;
  targetAssetClasses?: string[];
}): Promise<SymbolAssignment[]> {
  let uniqueSymbols: string[];

  if (options.specificSymbol) {
    uniqueSymbols = [options.specificSymbol.toUpperCase()];
  } else {
    const symbolsSet = new Set<string>();

    try {
      const positions = await ibkrService.getPositions();
      positions.forEach((pos) => {
        if (pos.contract.secType === "STK" && pos.contract.symbol) {
          symbolsSet.add(pos.contract.symbol);
        }
      });
    } catch (err: unknown) {
      if (!isIgnorablePositionError(err)) {
        throw err;
      }
    }

    const watchlistItems = await prisma.watchlistItem.findMany({
      where: { secType: "STK" },
      select: { symbol: true },
    });
    watchlistItems.forEach((item) => symbolsSet.add(item.symbol));

    uniqueSymbols = Array.from(symbolsSet);
  }

  if (uniqueSymbols.length === 0) {
    return [];
  }

  const assignmentWhere: Prisma.SecurityAssignmentWhereInput = {
    symbol: { in: uniqueSymbols },
    secType: "STK",
    ...(options.targetAssetClasses && options.targetAssetClasses.length > 0
      ? { assetClassId: { in: options.targetAssetClasses } }
      : {}),
  };

  const assignments = await prisma.securityAssignment.findMany({
    where: assignmentWhere,
    include: { assetClass: true },
  });

  const filteredSymbols =
    options.targetAssetClasses && options.targetAssetClasses.length > 0
      ? assignments.map((a) => a.symbol)
      : uniqueSymbols;

  if (filteredSymbols.length === 0) {
    return [];
  }

  return filteredSymbols.map((symbol) => {
    const assignment = assignments.find((a) => a.symbol === symbol);
    return {
      symbol,
      assetClass: assignment
        ? { name: assignment.assetClass.name, color: assignment.assetClass.color }
        : { name: "Unassigned", color: "#6b7280" },
    };
  });
}
