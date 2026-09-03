/**
 * Shared trade matching utilities for grouping open/close trades
 * Used by both profit.service.ts and wheel.service.ts
 */

import { formatDisplayName, type OptionTradeGroup, type StockTradeGroup, type OptionTradeDetail, type StockTradeDetail, type WheelMatchedTrade } from "@assup/shared";

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
        // Different conIds: could be an adjusted contract (e.g., special dividend changed the
        // strike, creating a new non-standard contract with a different conId). Fall through
        // to composite key matching with strike tolerance to handle this case.
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
  const mergedGroups = new Map<string, OptionTradeInput[]>();
  for (const group of completeGroups) {
    mergedGroups.set(group.key, group.trades);
  }

  // Split groups that contain multiple open/close cycles into separate groups.
  // This ensures each sell/buy cycle gets its own OptionTradeGroup for correct month attribution.
  // Example: sell Feb 12, buy Feb 24, sell Mar 6, buy Mar 9 on the same contract
  // must produce two separate groups (one per cycle), not one combined group.
  const groups = new Map<string, OptionTradeInput[]>();

  for (const [key, groupTrades] of mergedGroups) {
    const sorted = [...groupTrades].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());

    // Classify trades into opens and closes
    const opens: OptionTradeInput[] = [];
    const closes: OptionTradeInput[] = [];
    for (const trade of sorted) {
      if (trade.openClose === "O") {
        opens.push(trade);
      } else if (trade.openClose === "C") {
        closes.push(trade);
      } else {
        if (opens.length === 0 && closes.length === 0) {
          opens.push(trade);
        } else if (opens.length > 0 && opens[0].buySell === trade.buySell) {
          opens.push(trade);
        } else {
          closes.push(trade);
        }
      }
    }

    const openQtyTotal = opens.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
    const closeQtyTotal = closes.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
    const needsSplit = closes.length > 1 || (closes.length === 1 && openQtyTotal > closeQtyTotal + 0.001);

    if (!needsSplit || opens.length === 0) {
      // Single cycle or no cycles - keep as is
      groups.set(key, groupTrades);
      continue;
    }

    // Multiple cycles - FIFO match each close against opens, emit separate groups
    const openSlots = opens.map(t => ({ trade: t, remaining: Math.abs(t.quantity) }));
    let cycleIdx = 0;

    for (const close of closes) {
      let remaining = Math.abs(close.quantity);
      const cycleOpens: OptionTradeInput[] = [];

      for (const slot of openSlots) {
        if (remaining <= 0.001) break;
        if (slot.remaining <= 0.001) continue;

        const matched = Math.min(remaining, slot.remaining);
        const fraction = matched / Math.abs(slot.trade.quantity);

        if (Math.abs(fraction - 1) < 0.001) {
          // Whole open trade consumed
          cycleOpens.push(slot.trade);
        } else {
          // Partial - create virtual trade with prorated values
          cycleOpens.push({
            ...slot.trade,
            id: `${slot.trade.id}:split:${cycleIdx}`,
            quantity: slot.trade.quantity > 0 ? matched : -matched,
            proceeds: slot.trade.proceeds * fraction,
            commission: slot.trade.commission * fraction,
            costBasis: slot.trade.costBasis !== null ? slot.trade.costBasis * fraction : null,
            realizedPnl: slot.trade.realizedPnl !== null ? slot.trade.realizedPnl * fraction : null,
          });
        }

        slot.remaining -= matched;
        remaining -= matched;
      }

      groups.set(`${key}:cycle:${cycleIdx}`, [...cycleOpens, close]);
      cycleIdx++;
    }

    // Remaining unmatched opens become an open position group
    const remainingOpens: OptionTradeInput[] = [];
    for (const slot of openSlots) {
      if (slot.remaining <= 0.001) continue;
      const fraction = slot.remaining / Math.abs(slot.trade.quantity);
      if (Math.abs(fraction - 1) < 0.001) {
        remainingOpens.push(slot.trade);
      } else {
        remainingOpens.push({
          ...slot.trade,
          id: `${slot.trade.id}:split:remain`,
          quantity: slot.trade.quantity > 0 ? slot.remaining : -slot.remaining,
          proceeds: slot.trade.proceeds * fraction,
          commission: slot.trade.commission * fraction,
          costBasis: slot.trade.costBasis !== null ? slot.trade.costBasis * fraction : null,
          realizedPnl: slot.trade.realizedPnl !== null ? slot.trade.realizedPnl * fraction : null,
        });
      }
    }
    if (remainingOpens.length > 0) {
      groups.set(`${key}:remain`, remainingOpens);
    }
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
    const openTradesForFifo = openTrades.filter(t => t.quantity !== 0).map(t => ({
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
      const ibkrCostBasis = closeTrades.reduce((sum, t) => sum + (t.costBasis || 0), 0);
      if (ibkrCostBasis > 0) {
        finalCostBasis = ibkrCostBasis;
      } else {
        // Derive original open premium from realizedPnl = proceeds_open + proceeds_close.
        // proceeds_open = realizedPnl - proceeds_close; costBasis is its magnitude.
        // Works for both directions:
        //   SHORT close: proceeds_close=-4980, pnl=-4795 → |−4795−(−4980)|=185 (premium received)
        //   LONG  close: proceeds_close=+3980, pnl=+3866 → |+3866−(+3980)|=114 (premium paid)
        const closeProceedsTotal = closeTrades.reduce((sum, t) => sum + t.proceeds, 0);
        finalCostBasis = Math.abs(profit - closeProceedsTotal);
      }
    } else if (openTrade?.buySell === "SELL") {
      // Short position: profit = premium received - cost to close - commissions
      // Note: commission is already negative (money paid), so we add it to subtract
      profit = effectiveCostBasis - sellPrice + effectiveCommission;
    } else {
      // Long position: profit = sell price - cost basis - commissions
      // Note: commission is already negative (money paid), so we add it to subtract
      profit = sellPrice - effectiveCostBasis + effectiveCommission;
    }

    // For open positions (not closed, not expired), no realized P&L yet
    const isOpenPosition = closeQuantity === 0 && !expiredWorthless && !wasAssigned;
    if (isOpenPosition) {
      profit = 0;
    }

    // Skip groups where we have close trades but no matching open and no IBKR P&L.
    // Without an open trade or IBKR's realizedPnl, the P&L calculation is meaningless
    // (it would use sellPrice - 0 = positive, a false profit). These arise from
    // partial FLEX imports or roll trades that haven't been reconciled yet.
    if (missingOpenTrade && !hasIbkrPnl && !expiredWorthless && !wasAssigned) {
      continue;
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
 *
 * NOTE: This is for the profit page. For wheel page, use groupStockTradesForWheel()
 */
export function groupStockTrades(
  trades: StockTradeInput[],
  assignmentMap?: AssetClassMap
): StockTradeGroup[] {
  const result: StockTradeGroup[] = [];

  // Only process sell trades - they have the realized P&L from IBKR
  const sells = trades.filter((t) => t.buySell === "SELL");

  for (const sell of sells) {
    // Skip sells without realized P&L data (null or undefined)
    if (sell.realizedPnl == null) continue;

    const assetClass = assignmentMap?.get(sell.symbol);
    const quantity = Math.abs(sell.quantity);
    // Note: commission is already negative (money paid), so we add it to subtract
    const sellProceeds = quantity * sell.tradePrice + sell.commission;

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

/**
 * Group stock trades for wheel display - matches BUY and SELL trades using FIFO
 * Unlike groupStockTrades(), this tracks buy trades so we can show acquisition dates
 */
export function groupStockTradesForWheel(
  trades: StockTradeInput[]
): StockTradeGroup[] {
  const result: StockTradeGroup[] = [];

  // Separate buys and sells, sorted by date
  const buys = trades
    .filter((t) => t.buySell === "BUY")
    .sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());
  const sells = trades
    .filter((t) => t.buySell === "SELL")
    .sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());

  // Track remaining quantity for each buy lot (FIFO matching)
  const buyLots = buys.map((buy) => ({
    trade: buy,
    remainingQty: Math.abs(buy.quantity),
  }));

  // Match each sell against buy lots using FIFO
  for (const sell of sells) {
    let sellQtyRemaining = Math.abs(sell.quantity);
    let matchedCostBasis = 0;
    let matchedBuyTrade: StockTradeInput | undefined;
    let matchedBuyQty = 0;
    let matchedBuyPrice = 0;

    for (const lot of buyLots) {
      if (sellQtyRemaining <= 0) break;
      if (lot.remainingQty <= 0) continue;

      const matchQty = Math.min(sellQtyRemaining, lot.remainingQty);
      const lotCostPerShare = lot.trade.tradePrice;
      matchedCostBasis += matchQty * lotCostPerShare;

      // Track the first matching buy trade for display
      if (!matchedBuyTrade) {
        matchedBuyTrade = lot.trade;
      }
      matchedBuyQty += matchQty;
      matchedBuyPrice = (matchedBuyPrice * (matchedBuyQty - matchQty) + lotCostPerShare * matchQty) / matchedBuyQty;

      lot.remainingQty -= matchQty;
      sellQtyRemaining -= matchQty;
    }

    const quantity = Math.abs(sell.quantity);
    const sellProceeds = quantity * sell.tradePrice + sell.commission;

    // IBKR signs costBasis on a SELL as the negative of the original cash outflow;
    // take its magnitude so per-share buyPrice (costBasis/quantity) is positive.
    const costBasis = sell.costBasis !== null
      ? Math.abs(sell.costBasis)
      : matchedCostBasis;

    // Stock-level P&L from displayed cost basis. We don't use IBKR's realizedPnl
    // directly: for called-away shares it bakes the assigned-CALL premium into the
    // stock P&L (Section 1234), which is already shown on the option's own row —
    // using it here would double-count the premium and mismatch the buy→sell prices.
    const profit = sellProceeds - costBasis;

    const buyDetail: StockTradeDetail | undefined = matchedBuyTrade
      ? {
          id: matchedBuyTrade.id,
          symbol: matchedBuyTrade.symbol,
          tradeDate: matchedBuyTrade.tradeDate.toISOString().split("T")[0],
          quantity: matchedBuyQty,
          tradePrice: matchedBuyPrice,
          proceeds: -matchedCostBasis,
          commission: matchedBuyTrade.commission,
          buySell: matchedBuyTrade.buySell,
        }
      : undefined;

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
      buyTrade: buyDetail,
      sellTrade: sellDetail,
      costBasis,
      sellProceeds,
      profit,
      quantity,
    });
  }

  // Add any remaining open buy positions (not yet sold)
  for (const lot of buyLots) {
    if (lot.remainingQty > 0) {
      const buyDetail: StockTradeDetail = {
        id: lot.trade.id,
        symbol: lot.trade.symbol,
        tradeDate: lot.trade.tradeDate.toISOString().split("T")[0],
        quantity: lot.remainingQty,
        tradePrice: lot.trade.tradePrice,
        proceeds: -lot.remainingQty * lot.trade.tradePrice,
        commission: lot.trade.commission,
        buySell: lot.trade.buySell,
      };

      result.push({
        symbol: lot.trade.symbol,
        buyTrade: buyDetail,
        sellTrade: undefined,
        costBasis: lot.remainingQty * lot.trade.tradePrice,
        sellProceeds: 0,
        profit: 0,
        quantity: lot.remainingQty,
      });
    }
  }

  return result;
}

/**
 * Convert an OptionTradeGroup to WheelMatchedTrade for display
 */
export function optionGroupToWheelMatchedTrade(
  group: OptionTradeGroup,
  symbol: string
): WheelMatchedTrade {
  const { openTrade, closeTrade, wasAssigned, expiredWorthless, profit, costBasis } = group;

  // Determine status
  let status: WheelMatchedTrade["status"];
  if (!closeTrade && !expiredWorthless && !wasAssigned) {
    status = "open";
  } else if (wasAssigned) {
    status = "assigned";
  } else if (expiredWorthless) {
    status = "expired";
  } else {
    status = "closed";
  }

  // Build display name
  const displayName = formatDisplayName({
    symbol,
    secType: "OPT",
    strike: group.strike,
    right: group.right,
    lastTradeDateOrContractMonth: group.expiry.replace(/-/g, ""),
  });

  // Determine if this was a short (sold to open) or long (bought to open) position
  // When openTrade exists, use its direction; otherwise infer from closeTrade direction
  const wasShortPosition = openTrade
    ? openTrade.buySell === "SELL"
    : closeTrade?.buySell === "BUY"; // BUY to close means was short

  // Determine open action
  const openAction = wasShortPosition
    ? `Sold ${group.right === "P" ? "PUT" : "CALL"}`
    : `Bought ${group.right === "P" ? "PUT" : "CALL"}`;

  // Determine close action
  let closeAction: string | null = null;
  if (closeTrade) {
    if (wasAssigned) {
      closeAction = group.right === "P" ? "Assigned" : "Called away";
    } else if (expiredWorthless) {
      closeAction = "Expired worthless";
    } else {
      closeAction = closeTrade.buySell === "BUY" ? "Bought back" : "Sold";
    }
  } else if (expiredWorthless) {
    closeAction = "Expired worthless";
  } else if (wasAssigned) {
    // Assignment detected but no close trade in DB (e.g., FLEX report missing the close record)
    closeAction = group.right === "P" ? "Assigned" : "Called away";
  }

  // Build open leg - synthesize from costBasis if openTrade is missing
  let openLeg: WheelMatchedTrade["openLeg"] = null;
  if (openTrade) {
    openLeg = {
      date: openTrade.tradeDate,
      action: openAction,
      price: openTrade.tradePrice,
      quantity: openTrade.quantity,
      total: openTrade.proceeds,
    };
  } else if (closeTrade && costBasis > 0) {
    // Synthesize open leg from IBKR cost basis data
    // The open trade happened before our FLEX report period
    const quantity = closeTrade.quantity;
    const pricePerContract = costBasis / quantity / 100; // costBasis is total, convert to per-share
    openLeg = {
      date: "(before report period)",
      action: openAction,
      price: pricePerContract,
      quantity: quantity,
      total: wasShortPosition ? costBasis : -costBasis,
    };
  }

  return {
    id: openTrade?.id || closeTrade?.id || `opt-${group.underlying}-${group.strike}-${group.expiry}`,
    type: "OPTION",
    displayName,
    status,
    netPnL: status === "open" ? null : profit,
    openLeg,
    closeLeg: closeTrade || expiredWorthless || wasAssigned
      ? {
          date: closeTrade?.tradeDate || group.expiry,
          action: closeAction!,
          price: closeTrade?.tradePrice || 0,
          quantity: closeTrade?.quantity || openTrade?.quantity || 0,
          total: closeTrade?.proceeds || 0,
        }
      : null,
  };
}

/**
 * Convert a StockTradeGroup to WheelMatchedTrade for display
 */
export function stockGroupToWheelMatchedTrade(
  group: StockTradeGroup
): WheelMatchedTrade {
  const { buyTrade, sellTrade, profit, quantity, symbol, costBasis } = group;

  // Derive buy price from cost basis
  const buyPrice = costBasis / quantity;

  return {
    id: sellTrade?.id || buyTrade?.id || `stk-${symbol}-${Date.now()}`,
    type: "STOCK",
    displayName: `${quantity} ${symbol}`,
    status: sellTrade ? "closed" : "open",
    netPnL: sellTrade ? profit : null,
    openLeg: {
      date: buyTrade?.tradeDate || "Unknown",
      action: `Bought ${quantity} shares`,
      price: buyPrice,
      quantity,
      total: -costBasis, // Negative = cash outflow
    },
    closeLeg: sellTrade
      ? {
          date: sellTrade.tradeDate,
          action: `Sold ${quantity} shares`,
          price: sellTrade.tradePrice,
          quantity: sellTrade.quantity,
          total: group.sellProceeds,
        }
      : null,
  };
}
