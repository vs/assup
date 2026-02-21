/**
 * Shared trade matching utilities for grouping open/close trades
 * Used by both profit.service.ts and wheel.service.ts
 */

import type { OptionTradeGroup, StockTradeGroup, OptionTradeDetail, StockTradeDetail } from "@assup/shared";

// Input trade type for option grouping
export interface OptionTradeInput {
  id: string;
  tradeId: string;
  symbol: string;
  description: string | null;
  conId: number | null;
  strike: number | null;
  expiry: Date | null;
  right: string | null;
  underlying: string | null;
  tradeDate: Date;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose: string | null;
  wasAssigned: boolean;
  costBasis: number | null;
  realizedPnl: number | null;
}

// Input trade type for stock grouping
export interface StockTradeInput {
  id: string;
  tradeId: string;
  symbol: string;
  tradeDate: Date;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose: string | null;
  costBasis: number | null;
  realizedPnl: number | null;
}

// Asset class mapping type
export type AssetClassMap = Map<string, {
  assetClassId: string;
  assetClassName: string;
  assetClassColor: string;
}>;

/**
 * Check if an expiry date has passed (is before today, not including today).
 */
export function hasExpiryPassed(expiryDate: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return expiry < today;
}

/**
 * Group option trades by contract (conId or underlying-strike-expiry-right)
 * and pair open/close trades using FIFO matching
 */
export function groupOptionTrades(
  trades: OptionTradeInput[],
  assignmentMap?: AssetClassMap
): OptionTradeGroup[] {
  // First, group by conId if available (most reliable - survives strike adjustments)
  // Fall back to exact key (underlying-strike-expiry-right) when conId not available
  const exactGroups = new Map<string, OptionTradeInput[]>();

  for (const trade of trades) {
    // Prefer conId for grouping (unique contract identifier, never changes)
    // Fall back to composite key when conId not available
    const key = trade.conId
      ? `conId:${trade.conId}`
      : `${trade.underlying || trade.symbol}-${trade.strike}-${
          trade.expiry?.toISOString().split("T")[0]
        }-${trade.right}`;

    if (!exactGroups.has(key)) {
      exactGroups.set(key, []);
    }
    exactGroups.get(key)!.push(trade);
  }

  // Identify groups that might need strike adjustment matching:
  // - Groups with only opens (no closes) might have closes with adjusted strike
  // - Groups with only closes (no opens) might have opens with original strike
  const openOnlyGroups: Array<{ key: string; trades: OptionTradeInput[] }> = [];
  const closeOnlyGroups: Array<{ key: string; trades: OptionTradeInput[] }> = [];
  const completeGroups: Array<{ key: string; trades: OptionTradeInput[] }> = [];

  for (const [key, groupTrades] of exactGroups) {
    const hasOpen = groupTrades.some(t => t.openClose === "O" ||
      (t.openClose === null && groupTrades.indexOf(t) === 0));
    const hasClose = groupTrades.some(t => t.openClose === "C" ||
      (t.openClose === null && groupTrades.some(other =>
        other !== t && (other.openClose === "O" || groupTrades.indexOf(other) < groupTrades.indexOf(t))
      )));

    // Check if group has both opens and closes by looking at trade directions
    const sorted = [...groupTrades].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());
    const hasSells = sorted.some(t => t.buySell === "SELL");
    const hasBuys = sorted.some(t => t.buySell === "BUY");
    const hasBothDirections = hasSells && hasBuys;

    if (hasBothDirections) {
      // Has both opens and closes - complete group, process normally
      completeGroups.push({ key, trades: groupTrades });
    } else if (hasSells) {
      // Only sells - likely opens without closes (may need strike adjustment matching)
      openOnlyGroups.push({ key, trades: groupTrades });
    } else {
      // Only buys - likely closes without opens (may need strike adjustment matching)
      closeOnlyGroups.push({ key, trades: groupTrades });
    }
  }

  // Try to match open-only groups with close-only groups
  // Use conId if both have it, otherwise use relaxed matching with strike tolerance
  const STRIKE_TOLERANCE_PERCENT = 0.02; // 2% tolerance for strike adjustment
  const STRIKE_TOLERANCE_ABS = 1.0; // Max $1 absolute difference

  const matchedCloseGroups = new Set<string>();

  for (const openGroup of openOnlyGroups) {
    // Get trade details from first trade in group
    const openTrade = openGroup.trades[0];
    const openUnderlying = openTrade.underlying || openTrade.symbol.split(" ")[0];
    const openExpiry = openTrade.expiry?.toISOString().split("T")[0];
    const openRight = openTrade.right;
    const openStrike = openTrade.strike || 0;
    const openConId = openTrade.conId;

    // Look for matching close-only group
    for (const closeGroup of closeOnlyGroups) {
      if (matchedCloseGroups.has(closeGroup.key)) continue;

      const closeTrade = closeGroup.trades[0];
      const closeUnderlying = closeTrade.underlying || closeTrade.symbol.split(" ")[0];
      const closeExpiry = closeTrade.expiry?.toISOString().split("T")[0];
      const closeRight = closeTrade.right;
      const closeStrike = closeTrade.strike || 0;
      const closeConId = closeTrade.conId;

      // If both have conId, use that for matching (most reliable)
      if (openConId && closeConId) {
        if (openConId === closeConId) {
          openGroup.trades.push(...closeGroup.trades);
          matchedCloseGroups.add(closeGroup.key);
          break;
        }
        continue; // Different conIds, definitely not the same contract
      }

      // Fall back to relaxed matching: same underlying/expiry/right with strike tolerance
      if (openUnderlying === closeUnderlying && openExpiry === closeExpiry && openRight === closeRight) {
        const strikeDiff = Math.abs(openStrike - closeStrike);
        const percentDiff = openStrike > 0 ? strikeDiff / openStrike : 0;

        if (strikeDiff <= STRIKE_TOLERANCE_ABS || percentDiff <= STRIKE_TOLERANCE_PERCENT) {
          // Merge the groups
          openGroup.trades.push(...closeGroup.trades);
          matchedCloseGroups.add(closeGroup.key);
          break;
        }
      }
    }

    completeGroups.push(openGroup);
  }

  // Add remaining unmatched close-only groups
  for (const closeGroup of closeOnlyGroups) {
    if (!matchedCloseGroups.has(closeGroup.key)) {
      completeGroups.push(closeGroup);
    }
  }

  // Now use the merged groups for processing
  const groups = new Map<string, OptionTradeInput[]>();
  for (const group of completeGroups) {
    groups.set(group.key, group.trades);
  }

  // Create trade groups
  const result: OptionTradeGroup[] = [];

  for (const [, groupTrades] of groups) {
    // Sort by date
    const sorted = groupTrades.sort(
      (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
    );

    // Collect ALL open and close trades (there may be multiple partial fills)
    const openTrades: OptionTradeInput[] = [];
    const closeTrades: OptionTradeInput[] = [];
    let wasAssigned = false;

    for (const trade of sorted) {
      if (trade.wasAssigned) wasAssigned = true;

      if (trade.openClose === "O") {
        // Explicitly marked as open
        openTrades.push(trade);
      } else if (trade.openClose === "C") {
        // Explicitly marked as close
        closeTrades.push(trade);
      } else {
        // openClose not specified - use heuristics
        if (openTrades.length === 0 && closeTrades.length === 0) {
          // First trade in the group is the opening trade
          openTrades.push(trade);
        } else if (openTrades.length > 0 && openTrades[0].buySell === trade.buySell) {
          // Same direction as original open = adding to position
          openTrades.push(trade);
        } else {
          // Opposite direction = closing position
          closeTrades.push(trade);
        }
      }
    }

    // Use first trades for display purposes
    const openTrade = openTrades[0];
    const closeTrade = closeTrades[0];

    // Calculate cost basis and sell price for clearer profit display
    // For short options (selling to open):
    //   - costBasis = premium received (positive proceeds from open) - SUM of all open trades
    //   - sellPrice = cost to close (absolute value of close proceeds, or 0 if expired worthless)
    //   - profit = costBasis - sellPrice - commissions
    // For long options (buying to open):
    //   - costBasis = premium paid (absolute value of negative proceeds from open)
    //   - sellPrice = proceeds from selling (positive proceeds from close)
    //   - profit = sellPrice - costBasis - commissions

    const totalCommission = sorted.reduce((sum, t) => sum + t.commission, 0);

    let costBasis = 0;
    let sellPrice = 0;
    let expiredWorthless = false;

    // Sum proceeds from ALL open trades
    if (openTrades.length > 0) {
      // For SELL to open (short): proceeds is positive (premium received)
      // For BUY to open (long): proceeds is negative (premium paid)
      costBasis = openTrades.reduce((sum, t) => sum + Math.abs(t.proceeds), 0);
    }

    // Sum proceeds from ALL close trades
    if (closeTrades.length > 0) {
      // For BUY to close (closing short): proceeds is negative (cost to close)
      // For SELL to close (closing long): proceeds is positive (received)
      sellPrice = closeTrades.reduce((sum, t) => sum + Math.abs(t.proceeds), 0);

      // Zero proceeds on close can mean either:
      // 1. Assignment/exercise (wasAssigned flag is set by detectAssignments based on stock trade)
      // 2. Expired worthless (no stock trade, TWS sends close event with 0 proceeds)
      // We rely on the wasAssigned database flag (already checked above) instead of guessing.
      // If there's a 0-proceeds close and NOT assigned, it's expired worthless.
      if (closeTrades.some(t => t.proceeds === 0) && !wasAssigned) {
        expiredWorthless = true;
      }
    } else {
      // No close trade - check if option has expired
      // Options expiring today are still open until settlement (next business day)
      const first = sorted[0];
      const expiryDate = first.expiry;
      const hasExpired = expiryDate && hasExpiryPassed(expiryDate);

      if (hasExpired) {
        // Option expired worthless (or was assigned)
        expiredWorthless = !wasAssigned;
      }
      // If not expired, this is an open position - no realized P&L yet
      sellPrice = 0;
    }

    // Calculate profit using FIFO matching for partial closes
    // This matches close trades against open trades in chronological order
    const openQuantity = openTrades.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
    const closeQuantity = closeTrades.reduce((sum, t) => sum + Math.abs(t.quantity), 0);

    // Prepare open trades with per-contract values for FIFO matching
    const openTradesForFifo = openTrades.map(t => ({
      remainingQty: Math.abs(t.quantity),
      pricePerContract: Math.abs(t.proceeds) / Math.abs(t.quantity),
      commissionPerContract: t.commission / Math.abs(t.quantity)
    }));

    // FIFO matching: match close trades against open trades in order
    let fifoCostBasis = 0;
    let fifoOpenCommission = 0;

    for (const closeTradeItem of closeTrades) {
      let closeQtyRemaining = Math.abs(closeTradeItem.quantity);

      for (const openTradeInfo of openTradesForFifo) {
        if (closeQtyRemaining <= 0) break;
        if (openTradeInfo.remainingQty <= 0) continue;

        const matchedQty = Math.min(closeQtyRemaining, openTradeInfo.remainingQty);

        fifoCostBasis += openTradeInfo.pricePerContract * matchedQty;
        fifoOpenCommission += openTradeInfo.commissionPerContract * matchedQty;

        openTradeInfo.remainingQty -= matchedQty;
        closeQtyRemaining -= matchedQty;
      }
    }

    // If no closes yet, use full cost basis (for unrealized/projected calculations)
    const effectiveCostBasis = closeQuantity > 0 ? fifoCostBasis : costBasis;

    // Commission: FIFO-matched portion of open commissions + all close commissions
    const openCommission = openTrades.reduce((sum, t) => sum + t.commission, 0);
    const closeCommission = closeTrades.reduce((sum, t) => sum + t.commission, 0);
    const effectiveCommission = closeQuantity > 0
      ? fifoOpenCommission + closeCommission
      : openCommission;

    let profit: number;
    let finalCostBasis = effectiveCostBasis;

    // Check if we're missing the open trade but have IBKR's realizedPnl
    // This happens when the FLEX report period doesn't include the open trade
    const missingOpenTrade = openTrades.length === 0 && closeTrades.length > 0;
    const hasIbkrPnl = closeTrades.some(t => t.realizedPnl !== null);

    if (missingOpenTrade && hasIbkrPnl) {
      // Use IBKR's authoritative realizedPnl directly
      // Sum up realizedPnl from all close trades (handles partial closes)
      profit = closeTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
      // Derive cost basis from IBKR data: costBasis = closeProceeds - realizedPnl
      // For a BUY to close: proceeds is negative, realizedPnl is negative for loss
      // costBasis = |proceeds| - realizedPnl (e.g., 805 - (-762.68) = 1567.68... wait that's wrong)
      // Actually: realizedPnl = proceeds - costBasis, so costBasis = proceeds - realizedPnl
      // For BUY to close short: proceeds = -805, realizedPnl = -762.68
      // costBasis should be the premium received when opening = -805 - (-762.68) = -42.32? No...
      // Let me think again. IBKR's costBasis field has the answer.
      const ibkrCostBasis = closeTrades.reduce((sum, t) => sum + (t.costBasis || 0), 0);
      if (ibkrCostBasis > 0) {
        finalCostBasis = ibkrCostBasis;
      } else {
        // Fallback: derive from proceeds and P&L
        // For closing short: costBasis (premium received) = -proceeds - realizedPnl
        // proceeds = -805 (paid to close), realizedPnl = -762.68 (loss)
        // costBasis = -(-805) - (-762.68) = 805 - (-762.68) = 805 + 762.68? That's also wrong.
        // Let me reconsider: realizedPnl = proceeds_close + costBasis_open
        // -762.68 = -805 + costBasis_open => costBasis_open = -762.68 + 805 = 42.32
        // So the premium received was only $42.32, which matches the IBKR cost_basis field!
        const closeProceedsTotal = closeTrades.reduce((sum, t) => sum + t.proceeds, 0);
        finalCostBasis = Math.abs(closeProceedsTotal + profit);
      }
    } else if (openTrade?.buySell === "SELL") {
      // Short position: profit = premium received - cost to close - commissions
      profit = effectiveCostBasis - sellPrice - effectiveCommission;
    } else {
      // Long position: profit = sell price - cost basis - commissions
      profit = sellPrice - effectiveCostBasis - effectiveCommission;
    }

    // For assigned options, set profit to 0 (P&L is realized in stock position)
    if (wasAssigned) {
      profit = 0;
    }

    // For open positions (not closed, not expired), no realized P&L yet
    const isOpenPosition = closeQuantity === 0 && !expiredWorthless && !wasAssigned;
    if (isOpenPosition) {
      profit = 0;
    }

    const first = sorted[0];
    const underlying = first.underlying || first.symbol.split(" ")[0];
    const assetClass = assignmentMap?.get(underlying);

    // Aggregate open trades for display (sum quantity and proceeds, average price)
    const openProceeds = openTrades.reduce((sum, t) => sum + t.proceeds, 0);
    const openAvgPrice = openQuantity !== 0 ? Math.abs(openProceeds / openQuantity / 100) : 0;

    // Aggregate close trades for display
    const closeProceeds = closeTrades.reduce((sum, t) => sum + t.proceeds, 0);
    const closeAvgPrice = closeQuantity !== 0 ? Math.abs(closeProceeds / closeQuantity / 100) : 0;

    // Use close trade's strike if available (it has the adjusted value after corporate actions)
    // Otherwise fall back to open trade's strike
    const displayStrike = closeTrade?.strike || openTrade?.strike || first.strike || 0;

    result.push({
      underlying,
      strike: displayStrike,
      expiry: first.expiry?.toISOString().split("T")[0] || "",
      right: (first.right || "C") as "C" | "P",
      openTrade: openTrade
        ? {
            id: openTrade.id,
            symbol: openTrade.symbol,
            underlying: openTrade.underlying || openTrade.symbol.split(" ")[0],
            strike: openTrade.strike || 0,
            expiry: openTrade.expiry?.toISOString().split("T")[0] || "",
            right: (openTrade.right || "C") as "C" | "P",
            tradeDate: openTrade.tradeDate.toISOString().split("T")[0],
            quantity: openQuantity,
            tradePrice: openAvgPrice,
            proceeds: openProceeds,
            commission: openCommission,
            buySell: openTrade.buySell,
            wasAssigned: openTrade.wasAssigned,
          }
        : undefined,
      closeTrade: closeTrade
        ? {
            id: closeTrade.id,
            symbol: closeTrade.symbol,
            underlying: closeTrade.underlying || closeTrade.symbol.split(" ")[0],
            strike: closeTrade.strike || 0,
            expiry: closeTrade.expiry?.toISOString().split("T")[0] || "",
            right: (closeTrade.right || "C") as "C" | "P",
            tradeDate: closeTrade.tradeDate.toISOString().split("T")[0],
            quantity: closeQuantity,
            tradePrice: closeAvgPrice,
            proceeds: closeProceeds,
            commission: closeCommission,
            buySell: closeTrade.buySell,
            wasAssigned: closeTrade.wasAssigned,
          }
        : undefined,
      costBasis: finalCostBasis,
      sellPrice,
      profit,
      wasAssigned,
      expiredWorthless,
      assetClassId: assetClass?.assetClassId,
      assetClassName: assetClass?.assetClassName,
      assetClassColor: assetClass?.assetClassColor,
    });
  }

  return result;
}

/**
 * Group stock trades for display - uses IBKR's realizedPnl directly
 * Returns only sell trades (realized P&L)
 */
export function groupStockTrades(
  trades: StockTradeInput[],
  assignmentMap?: AssetClassMap
): StockTradeGroup[] {
  const result: StockTradeGroup[] = [];

  // Only process sell trades - they have the realized P&L from IBKR
  const sells = trades.filter((t) => t.buySell === "SELL");

  for (const sell of sells) {
    // Skip sells without realized P&L data
    if (sell.realizedPnl === null) continue;

    const assetClass = assignmentMap?.get(sell.symbol);
    const quantity = Math.abs(sell.quantity);
    const sellProceeds = quantity * sell.tradePrice - sell.commission;

    // Use IBKR's cost basis if available, otherwise derive from proceeds and P&L
    const costBasis = sell.costBasis !== null
      ? sell.costBasis
      : sellProceeds - sell.realizedPnl;

    const sellDetail: StockTradeDetail = {
      id: sell.id,
      symbol: sell.symbol,
      tradeDate: sell.tradeDate.toISOString().split("T")[0],
      quantity,
      tradePrice: sell.tradePrice,
      proceeds: quantity * sell.tradePrice,
      commission: sell.commission,
      buySell: sell.buySell,
    };

    result.push({
      symbol: sell.symbol,
      buyTrade: undefined,
      sellTrade: sellDetail,
      costBasis,
      sellProceeds,
      profit: sell.realizedPnl,
      quantity,
      assetClassId: assetClass?.assetClassId,
      assetClassName: assetClass?.assetClassName,
      assetClassColor: assetClass?.assetClassColor,
    });
  }

  return result;
}
