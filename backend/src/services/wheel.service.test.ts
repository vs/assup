/**
 * Tests for Wheel Service cycle reconstruction
 * Focus: Position-based cycle detection
 */

import { describe, it, expect } from "vitest";

// Types for test data
interface TestTrade {
  id: string;
  tradeDate: Date;
  symbol: string;
  underlying: string | null;
  secType: string;
  strike: number | null;
  expiry: Date | null;
  right: string | null;
  quantity: number;
  proceeds: number;
  commission: number;
  buySell: string;
  wasAssigned: boolean;
  multiplier: number;
}

// Pure function version of cycle reconstruction for testing
// This mirrors the logic we'll implement in wheel.service.ts
interface CycleResult {
  cycleNumber: number;
  startDate: string;
  endDate: string | null;
  status: string;
  entryType: string;
  entryDescription: string;
  exitType: string;
  exitDescription: string | null;
  totalPremium: number;
  tradeCount: number;
}

function reconstructCyclesFromTrades(trades: TestTrade[]): CycleResult[] {
  const cycles: CycleResult[] = [];
  let currentCycle: CycleResult | null = null;
  let sharePosition = 0;
  let putPosition = 0; // positive = short puts (contracts)
  let callPosition = 0; // positive = short calls (contracts)
  let cycleNumber = 0;

  // Sort trades by date
  const sortedTrades = [...trades].sort(
    (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
  );

  // Group trades by date (for handling rolls as atomic operations)
  const tradesByDate = new Map<string, TestTrade[]>();
  for (const trade of sortedTrades) {
    const dateStr = trade.tradeDate.toISOString().split("T")[0];
    if (!tradesByDate.has(dateStr)) {
      tradesByDate.set(dateStr, []);
    }
    tradesByDate.get(dateStr)!.push(trade);
  }

  // Calculate total position: shares + uncovered puts (puts not offset by shares)
  // Covered calls (shares with short calls) don't add to position since they're hedged
  const calcTotalPosition = () => {
    // Position = shares + (puts * 100) for any puts not covered by short shares
    // Since we're long shares, short puts are cash-secured by our capital
    // Short calls against shares are covered, not adding to position
    const uncoveredPuts = putPosition; // CSPs represent potential share acquisition
    const uncoveredCalls = Math.max(0, callPosition - sharePosition / 100); // calls beyond shares held
    return sharePosition + uncoveredPuts * 100 + uncoveredCalls * 100;
  };

  // Helper to update positions for a single trade
  const applyTrade = (trade: TestTrade) => {
    const isOption = trade.secType === "OPT";
    const isStock = trade.secType === "STK";
    const isSell = trade.buySell === "SELL";
    const isBuy = trade.buySell === "BUY";
    const isPut = trade.right === "P";
    const isCall = trade.right === "C";

    if (isOption && isSell && isPut) {
      putPosition += Math.abs(trade.quantity);
    } else if (isOption && isBuy && isPut) {
      putPosition = Math.max(0, putPosition - Math.abs(trade.quantity));
    } else if (isOption && isSell && isCall) {
      callPosition += Math.abs(trade.quantity);
    } else if (isOption && isBuy && isCall) {
      callPosition = Math.max(0, callPosition - Math.abs(trade.quantity));
    } else if (isStock && isBuy && trade.wasAssigned) {
      sharePosition += Math.abs(trade.quantity);
      putPosition = Math.max(0, putPosition - Math.abs(trade.quantity) / 100);
    } else if (isStock && isBuy && !trade.wasAssigned) {
      sharePosition += Math.abs(trade.quantity);
    } else if (isStock && isSell && trade.wasAssigned) {
      sharePosition -= Math.abs(trade.quantity);
      callPosition = Math.max(0, callPosition - Math.abs(trade.quantity) / 100);
    } else if (isStock && isSell && !trade.wasAssigned) {
      sharePosition -= Math.abs(trade.quantity);
    }
  };

  // Process trades grouped by date
  for (const [dateStr, dayTrades] of tradesByDate) {
    const prevTotalPosition = calcTotalPosition();

    // Apply all trades for this day
    for (const trade of dayTrades) {
      applyTrade(trade);
    }

    const newTotalPosition = calcTotalPosition();

    // Determine entry/exit info from the day's trades
    const firstTrade = dayTrades[0];
    const lastTrade = dayTrades[dayTrades.length - 1];

    // Find the initiating trade (first sell PUT or buy shares)
    const entryTrade = dayTrades.find(t =>
      (t.secType === "OPT" && t.buySell === "SELL" && t.right === "P") ||
      (t.secType === "STK" && t.buySell === "BUY")
    ) || firstTrade;

    // Find the exit trade (sell shares or option expiry)
    const exitTrade = dayTrades.find(t =>
      (t.secType === "STK" && t.buySell === "SELL") ||
      (t.secType === "OPT" && t.buySell === "BUY" && t.proceeds === 0)
    ) || lastTrade;

    // Cycle starts: position went from 0 to non-zero
    if (prevTotalPosition === 0 && newTotalPosition !== 0) {
      cycleNumber++;
      let entryType: string;
      let entryDescription: string;

      const isOption = entryTrade.secType === "OPT";
      const isStock = entryTrade.secType === "STK";
      const isSell = entryTrade.buySell === "SELL";
      const isBuy = entryTrade.buySell === "BUY";
      const isPut = entryTrade.right === "P";

      if (isOption && isSell && isPut) {
        entryType = "sold_put";
        entryDescription = `Sold PUT $${entryTrade.strike}`;
      } else if (isStock && isBuy && entryTrade.wasAssigned) {
        entryType = "assigned";
        entryDescription = `Assigned ${Math.abs(entryTrade.quantity)} @ $${entryTrade.strike || entryTrade.proceeds / Math.abs(entryTrade.quantity)}`;
      } else if (isStock && isBuy) {
        entryType = "bought_shares";
        entryDescription = `Bought ${Math.abs(entryTrade.quantity)} @ $${(Math.abs(entryTrade.proceeds) / Math.abs(entryTrade.quantity)).toFixed(2)}`;
      } else {
        entryType = "sold_put";
        entryDescription = "Unknown entry";
      }

      currentCycle = {
        cycleNumber,
        startDate: dateStr,
        endDate: null,
        status: "in_progress",
        entryType,
        entryDescription,
        exitType: "in_progress",
        exitDescription: null,
        totalPremium: 0,
        tradeCount: 0,
      };
    }

    // Track premium and count for current cycle
    if (currentCycle) {
      for (const trade of dayTrades) {
        currentCycle.tradeCount++;
        if (trade.secType === "OPT") {
          currentCycle.totalPremium += trade.proceeds - trade.commission;
        }
      }
    }

    // Cycle ends: position went from non-zero to 0
    if (prevTotalPosition !== 0 && newTotalPosition === 0 && currentCycle) {
      currentCycle.endDate = dateStr;

      const isStock = exitTrade.secType === "STK";
      const isOption = exitTrade.secType === "OPT";
      const isSell = exitTrade.buySell === "SELL";
      const isBuy = exitTrade.buySell === "BUY";
      const isPut = exitTrade.right === "P";

      if (isStock && isSell && exitTrade.wasAssigned) {
        currentCycle.status = "called_away";
        currentCycle.exitType = "called_away";
        currentCycle.exitDescription = `Called away @ $${(exitTrade.proceeds / Math.abs(exitTrade.quantity)).toFixed(2)}`;
      } else if (isStock && isSell) {
        currentCycle.status = "sold_shares";
        currentCycle.exitType = "sold_shares";
        currentCycle.exitDescription = `Sold @ $${(exitTrade.proceeds / Math.abs(exitTrade.quantity)).toFixed(2)}`;
      } else if (isOption && (isBuy || exitTrade.proceeds === 0)) {
        currentCycle.status = "expired_worthless";
        currentCycle.exitType = isPut ? "put_expired" : "cc_expired";
        currentCycle.exitDescription = isPut ? "PUT expired worthless" : "CC expired worthless";
      }

      cycles.push(currentCycle);
      currentCycle = null;
    }
  }

  // Add in-progress cycle
  if (currentCycle) {
    cycles.push(currentCycle);
  }

  return cycles;
}

describe("Wheel Cycle Reconstruction", () => {
  describe("Position-based cycle detection", () => {
    it("should detect cycle start when selling a CSP", () => {
      const trades: TestTrade[] = [
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: -1,
          proceeds: 250,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(1);
      expect(cycles[0].status).toBe("in_progress");
      expect(cycles[0].entryType).toBe("sold_put");
      expect(cycles[0].entryDescription).toBe("Sold PUT $145");
    });

    it("should detect cycle start when buying shares directly", () => {
      const trades: TestTrade[] = [
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL",
          underlying: null,
          secType: "STK",
          strike: null,
          expiry: null,
          right: null,
          quantity: 100,
          proceeds: -14800,
          commission: 1,
          buySell: "BUY",
          wasAssigned: false,
          multiplier: 1,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(1);
      expect(cycles[0].status).toBe("in_progress");
      expect(cycles[0].entryType).toBe("bought_shares");
      expect(cycles[0].entryDescription).toBe("Bought 100 @ $148.00");
    });

    it("should detect complete cycle: CSP expires worthless", () => {
      const trades: TestTrade[] = [
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: -1,
          proceeds: 250,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        {
          id: "2",
          tradeDate: new Date("2024-01-19"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: 1,
          proceeds: 0, // expired worthless
          commission: 0,
          buySell: "BUY",
          wasAssigned: false,
          multiplier: 100,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(1);
      expect(cycles[0].status).toBe("expired_worthless");
      expect(cycles[0].exitType).toBe("put_expired");
      expect(cycles[0].exitDescription).toBe("PUT expired worthless");
      expect(cycles[0].totalPremium).toBe(249); // 250 - 1 commission
    });

    it("should detect complete classic wheel cycle", () => {
      const trades: TestTrade[] = [
        // Sell PUT
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: -1,
          proceeds: 250,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        // Assigned
        {
          id: "2",
          tradeDate: new Date("2024-01-19"),
          symbol: "AAPL",
          underlying: null,
          secType: "STK",
          strike: 145,
          expiry: null,
          right: null,
          quantity: 100,
          proceeds: -14500,
          commission: 0,
          buySell: "BUY",
          wasAssigned: true,
          multiplier: 1,
        },
        // Sell CC
        {
          id: "3",
          tradeDate: new Date("2024-01-22"),
          symbol: "AAPL 240202C00150000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 150,
          expiry: new Date("2024-02-02"),
          right: "C",
          quantity: -1,
          proceeds: 300,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        // Called away
        {
          id: "4",
          tradeDate: new Date("2024-02-02"),
          symbol: "AAPL",
          underlying: null,
          secType: "STK",
          strike: 150,
          expiry: null,
          right: null,
          quantity: -100,
          proceeds: 15000,
          commission: 0,
          buySell: "SELL",
          wasAssigned: true,
          multiplier: 1,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(1);
      expect(cycles[0].status).toBe("called_away");
      expect(cycles[0].entryType).toBe("sold_put");
      expect(cycles[0].exitType).toBe("called_away");
      expect(cycles[0].exitDescription).toBe("Called away @ $150.00");
      expect(cycles[0].tradeCount).toBe(4);
    });

    it("should detect multiple consecutive cycles", () => {
      const trades: TestTrade[] = [
        // Cycle 1: CSP expires
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: -1,
          proceeds: 250,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        {
          id: "2",
          tradeDate: new Date("2024-01-19"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: 1,
          proceeds: 0,
          commission: 0,
          buySell: "BUY",
          wasAssigned: false,
          multiplier: 100,
        },
        // Cycle 2: New CSP
        {
          id: "3",
          tradeDate: new Date("2024-01-22"),
          symbol: "AAPL 240126P00144000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 144,
          expiry: new Date("2024-01-26"),
          right: "P",
          quantity: -1,
          proceeds: 200,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(2);
      expect(cycles[0].status).toBe("expired_worthless");
      expect(cycles[0].cycleNumber).toBe(1);
      expect(cycles[1].status).toBe("in_progress");
      expect(cycles[1].cycleNumber).toBe(2);
    });

    it("should handle roll as continuation of same cycle", () => {
      const trades: TestTrade[] = [
        // Sell PUT
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: -1,
          proceeds: 250,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        // Buy back PUT (roll - close old)
        {
          id: "2",
          tradeDate: new Date("2024-01-18"),
          symbol: "AAPL 240119P00145000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 145,
          expiry: new Date("2024-01-19"),
          right: "P",
          quantity: 1,
          proceeds: -100,
          commission: 1,
          buySell: "BUY",
          wasAssigned: false,
          multiplier: 100,
        },
        // Sell new PUT (roll - open new)
        {
          id: "3",
          tradeDate: new Date("2024-01-18"),
          symbol: "AAPL 240126P00143000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 143,
          expiry: new Date("2024-01-26"),
          right: "P",
          quantity: -1,
          proceeds: 280,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      // Roll should be 1 cycle (position never went to zero)
      expect(cycles).toHaveLength(1);
      expect(cycles[0].status).toBe("in_progress");
      expect(cycles[0].tradeCount).toBe(3);
    });

    it("should handle buying shares and selling covered calls", () => {
      const trades: TestTrade[] = [
        // Buy shares directly
        {
          id: "1",
          tradeDate: new Date("2024-01-15"),
          symbol: "AAPL",
          underlying: null,
          secType: "STK",
          strike: null,
          expiry: null,
          right: null,
          quantity: 100,
          proceeds: -14800,
          commission: 1,
          buySell: "BUY",
          wasAssigned: false,
          multiplier: 1,
        },
        // Sell CC
        {
          id: "2",
          tradeDate: new Date("2024-01-16"),
          symbol: "AAPL 240202C00155000",
          underlying: "AAPL",
          secType: "OPT",
          strike: 155,
          expiry: new Date("2024-02-02"),
          right: "C",
          quantity: -1,
          proceeds: 200,
          commission: 1,
          buySell: "SELL",
          wasAssigned: false,
          multiplier: 100,
        },
        // Called away
        {
          id: "3",
          tradeDate: new Date("2024-02-02"),
          symbol: "AAPL",
          underlying: null,
          secType: "STK",
          strike: 155,
          expiry: null,
          right: null,
          quantity: -100,
          proceeds: 15500,
          commission: 0,
          buySell: "SELL",
          wasAssigned: true,
          multiplier: 1,
        },
      ];

      const cycles = reconstructCyclesFromTrades(trades);

      expect(cycles).toHaveLength(1);
      expect(cycles[0].entryType).toBe("bought_shares");
      expect(cycles[0].entryDescription).toBe("Bought 100 @ $148.00");
      expect(cycles[0].exitType).toBe("called_away");
      expect(cycles[0].exitDescription).toBe("Called away @ $155.00");
    });
  });
});
