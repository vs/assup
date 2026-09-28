// Fictional demo data for README screenshots. Nothing here comes from a real account.
const ACCOUNT = "U1234567";
const TODAY = "2026-09-28";

// Deterministic PRNG so screenshots are reproducible
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export const assetClasses = [
  { id: "ac-us", name: "US Equities", description: "Broad US market", color: "#3b82f6" },
  { id: "ac-tech", name: "Stocks: Tech", description: "Large-cap technology", color: "#8b5cf6" },
  { id: "ac-intl", name: "International", description: "Developed + EM ex-US", color: "#06b6d4" },
  { id: "ac-bonds", name: "Bonds", description: "Aggregate + treasuries", color: "#22c55e" },
  { id: "ac-metals", name: "Metals", description: "Gold and silver", color: "#eab308" },
  { id: "ac-re", name: "Real Estate", description: "REITs", color: "#f97316" },
].map((a, i) => ({ ...a, createdAt: "2026-01-02T10:00:00.000Z", updatedAt: "2026-01-02T10:00:00.000Z", _count: { securityAssignments: 2 + (i % 3) } }));
const ac = Object.fromEntries(assetClasses.map((a) => [a.id, a]));

let conId = 400000;
function stock(symbol, qty, avg, last, acId) {
  const mv = qty * last;
  const a = ac[acId];
  return {
    account: ACCOUNT, symbol, conId: conId++, secType: "STK", exchange: "SMART", currency: "USD",
    position: qty, avgCost: avg, costBasis: qty * avg, marketValue: mv, unrealizedPnl: mv - qty * avg,
    assetClassId: a.id, assetClassName: a.name, assetClassColor: a.color,
  };
}
function option(underlying, right, strike, expiry, qty, premium, mark, spot, delta, acId, theta) {
  const a = ac[acId];
  const yymmdd = expiry.slice(2).replaceAll("-", "");
  const mv = qty * mark * 100;
  return {
    account: ACCOUNT, symbol: `${underlying.padEnd(6)}${yymmdd}${right}${String(strike * 1000).padStart(8, "0")}`,
    conId: conId++, secType: "OPT", exchange: "SMART", currency: "USD",
    position: qty, avgCost: premium * 100, costBasis: qty * premium * 100, marketValue: mv,
    unrealizedPnl: mv - qty * premium * 100, strike, expiry: expiry.replaceAll("-", ""), right, underlying,
    notionalValue: Math.abs(qty) * strike * 100, deltaExposure: qty * delta * 100 * spot, theta,
    assetClassId: a.id, assetClassName: a.name, assetClassColor: a.color,
  };
}

const PRICES = { VTI: 312.4, MSFT: 504.9, AAPL: 232.1, NVDA: 228.86, VXUS: 71.2, BND: 74.55, IEF: 95.4, GLD: 338.7, O: 59.3, PFE: 26.4, AMD: 164.2, KO: 69.8, CVX: 152.3 };
export const positions = [
  stock("VTI", 180, 244.8, PRICES.VTI, "ac-us"),
  stock("MSFT", 60, 381.2, PRICES.MSFT, "ac-tech"),
  stock("AAPL", 100, 189.6, PRICES.AAPL, "ac-tech"),
  stock("NVDA", 150, 112.3, PRICES.NVDA, "ac-tech"),
  stock("VXUS", 400, 58.1, PRICES.VXUS, "ac-intl"),
  stock("BND", 300, 72.4, PRICES.BND, "ac-bonds"),
  stock("IEF", 150, 97.2, PRICES.IEF, "ac-bonds"),
  stock("GLD", 60, 241.5, PRICES.GLD, "ac-metals"),
  stock("O", 250, 55.2, PRICES.O, "ac-re"),
  stock("PFE", 200, 25.1, PRICES.PFE, "ac-us"),
  option("AMD", "P", 150, "2026-10-16", -2, 4.1, 1.35, PRICES.AMD, -0.21, "ac-tech", 18.4),
  option("KO", "P", 67.5, "2026-10-23", -3, 1.05, 0.42, PRICES.KO, -0.24, "ac-us", 9.1),
  option("CVX", "P", 145, "2026-11-20", -1, 2.6, 1.9, PRICES.CVX, -0.22, "ac-us", 3.2),
  option("PFE", "C", 28, "2026-10-16", -2, 0.62, 0.21, PRICES.PFE, 0.19, "ac-us", 4.4),
];

function positionsSummary() {
  const stocks = positions.filter((p) => p.secType === "STK");
  const opts = positions.filter((p) => p.secType === "OPT");
  const totalStockValue = stocks.reduce((s, p) => s + p.marketValue, 0);
  const shortPutNotional = opts.filter((o) => o.right === "P").reduce((s, o) => s + o.notionalValue, 0);
  const shortCallNotional = opts.filter((o) => o.right === "C").reduce((s, o) => s + o.notionalValue, 0);
  const putDelta = opts.filter((o) => o.right === "P").reduce((s, o) => s - o.deltaExposure, 0);
  const callDelta = opts.filter((o) => o.right === "C").reduce((s, o) => s - o.deltaExposure, 0);
  const byAc = assetClasses.map((a) => {
    const stockValue = stocks.filter((p) => p.assetClassId === a.id).reduce((s, p) => s + p.marketValue, 0);
    const o = opts.filter((p) => p.assetClassId === a.id);
    const optionsNotional = o.filter((x) => x.right === "P").reduce((s, x) => s + x.notionalValue, 0);
    return { id: a.id, name: a.name, color: a.color, value: stockValue + optionsNotional, stockValue, optionsNotional, optionsDelta: 0, percentage: 0 };
  });
  const totalValue = byAc.reduce((s, x) => s + x.value, 0);
  byAc.forEach((x) => (x.percentage = (x.value / totalValue) * 100));
  const optionsExposure = assetClasses.map((a) => {
    const o = opts.filter((p) => p.assetClassId === a.id);
    const putNotional = o.filter((x) => x.right === "P").reduce((s, x) => s + x.notionalValue, 0);
    const callNotional = o.filter((x) => x.right === "C").reduce((s, x) => s + x.notionalValue, 0);
    const pd = o.filter((x) => x.right === "P").reduce((s, x) => s - x.deltaExposure, 0);
    const cd = o.filter((x) => x.right === "C").reduce((s, x) => s - x.deltaExposure, 0);
    return { assetClassId: a.id, assetClassName: a.name, assetClassColor: a.color, putNotional, callNotional, putDelta: pd, callDelta: cd, netNotional: putNotional - callNotional, netDelta: pd - cd };
  }).filter((x) => x.putNotional || x.callNotional);
  return {
    positions,
    summary: {
      totalPositions: positions.length, totalValue, totalStockValue,
      totalOptionsNotional: shortPutNotional + shortCallNotional, totalOptionsDelta: putDelta + callDelta,
      totalPutNotional: shortPutNotional, totalShortPutNotional: shortPutNotional, totalLongPutNotional: 0,
      totalCallNotional: shortCallNotional, totalShortCallNotional: shortCallNotional, totalLongCallNotional: 0,
      totalPutDelta: putDelta, totalCallDelta: callDelta, totalTheta: opts.reduce((s, o) => s + o.theta, 0) + 61.5,
      unassignedValue: 0, unassignedPercentage: 0, includeOptions: true, optionsWeightMode: "notional",
      byAssetClass: byAc, optionsExposure,
    },
    account: { netLiquidation: totalStockValue + 18420.55 + opts.reduce((s, o) => s + o.marketValue, 0), cashValue: 18420.55, availableFunds: 61230.1 },
  };
}

const macro = {
  regime: "risk_on", confidence: 0.68, summary: "Equities trending above the 200-day SMA with subdued volatility.",
  analyzedAt: `${TODAY}T14:30:00.000Z`,
  details: {
    vix: 15.8, regime: "risk_on", sp500Rsi: 58.4, vixSma20: 16.9, vixTrend: "falling", hygChange: 0.3, tltChange: -0.2, vixChange: -0.6,
    sp500Index: 6605.2, sp500Trend: "up", sp500Change: 0.42, sp500Sma200: 6120.7, putCallRatio: null, safeHavenSpread: 0.5,
    gexLevels: { gexFlip: 6540, putWall: 6450, callWall: 6700, netGEXRegime: "positive", fetchedAt: `${TODAY}T14:25:00.000Z` },
  },
};

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
function dashboardSummary() {
  let cum = 0;
  const chart = months.map((m, i) => {
    const options = Math.round(900 + rnd() * 900);
    const spreads = Math.round(rnd() < 0.2 ? -400 - rnd() * 500 : 350 + rnd() * 700);
    const stocks = Math.round(rnd() < 0.3 ? -200 + rnd() * 300 : rnd() * 900);
    const dividendsInterest = Math.round(180 + rnd() * 160);
    const fees = -Math.round(25 + rnd() * 30);
    const total = options + spreads + stocks + dividendsInterest + fees;
    cum += total;
    return { period: m, options, spreads, stocks, dividendsInterest, fees, total, cumulative: cum };
  });
  const sum = (k) => chart.reduce((s, c) => s + c[k], 0);
  const strat = (k, n) => ({ total: sum(k), tradeCount: n, sparkline: chart.map((c) => c[k]) });
  return {
    currentMonthPace: { realized: 1412.35, projected: 2180.0, estimatedTotal: 2180.0 + 1412.35, daysRemaining: 2 },
    periodTotal: { total: cum, realized: cum, unrealized: 1840.2, projected: null },
    periodIncludesCurrentMonth: true,
    chart,
    strategies: { options: strat("options", 86), spreads: strat("spreads", 31), stocks: strat("stocks", 14), dividendsInterest: strat("dividendsInterest", 57), fees: strat("fees", 131) },
  };
}

function accountHistory() {
  const snapshots = [];
  let v = 214000;
  const d = new Date("2025-09-29T00:00:00Z");
  while (d.toISOString().slice(0, 10) <= TODAY) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      v *= 1 + (rnd() - 0.46) * 0.012;
      snapshots.push({ date: d.toISOString().slice(0, 10), netLiquidation: Math.round(v * 100) / 100 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return {
    snapshots,
    fundFlows: [
      { date: "2025-12-15", type: "DEPOSIT", amount: 10000, currency: "USD", description: "Monthly contribution" },
      { date: "2026-04-10", type: "DEPOSIT", amount: 10000, currency: "USD", description: "Monthly contribution" },
    ],
  };
}

const spreadPositions = {
  spreads: [
    {
      id: "spx-ps-1", type: "put-spread", symbol: "SPX", expiry: "20261016", quantity: 1,
      legs: [
        { conId: 900001, strike: 6350, right: "P", side: "SELL", position: -1, avgCost: 1285, marketValue: -610, unrealizedPnl: 675, midPrice: 6.1, exchange: "CBOE" },
        { conId: 900002, strike: 6300, right: "P", side: "BUY", position: 1, avgCost: 905, marketValue: 420, unrealizedPnl: -485, midPrice: 4.2, exchange: "CBOE" },
      ],
      totalPnl: 190, netPremium: 380, closeMidPrice: 1.9, orphanLegs: [],
    },
    {
      id: "spx-ic-1", type: "iron-condor", symbol: "SPX", expiry: "20261030", quantity: 1,
      legs: [
        { conId: 900011, strike: 6300, right: "P", side: "SELL", position: -1, avgCost: 1840, marketValue: -1210, unrealizedPnl: 630, midPrice: 12.1, exchange: "CBOE" },
        { conId: 900012, strike: 6250, right: "P", side: "BUY", position: 1, avgCost: 1395, marketValue: 905, unrealizedPnl: -490, midPrice: 9.05, exchange: "CBOE" },
        { conId: 900013, strike: 6850, right: "C", side: "SELL", position: -1, avgCost: 1120, marketValue: -890, unrealizedPnl: 230, midPrice: 8.9, exchange: "CBOE" },
        { conId: 900014, strike: 6900, right: "C", side: "BUY", position: 1, avgCost: 690, marketValue: 540, unrealizedPnl: -150, midPrice: 5.4, exchange: "CBOE" },
      ],
      totalPnl: 220, netPremium: 875, closeMidPrice: 6.55, orphanLegs: [],
    },
  ],
};

function wheelTicker(o) {
  return {
    sharePnL: null, _cacheVersion: 3, positionAvgCost: null, sharePnLPercent: null, hasUncoveredShares: false, cycleShareQuantity: 0,
    ...o,
  };
}
const wheel = {
  tickers: [
    wheelTicker({
      symbol: "AMD", totalPnL: 2140.5, breakEven: 146.2, cycleCount: 4, realizedPnL: 1845.5, activePhases: ["csp_open"], currentPhase: "csp_open", currentPrice: PRICES.AMD,
      activeOptions: { putsPnL: 550, callsPnL: null, nearestPut: { dte: 18, expiry: "2026-10-16", strike: 150 }, nearestCall: null, putsPnLPercent: 67.1, callsPnLPercent: null, totalPutContracts: 2, totalCallContracts: 0 },
      livePositions: [{ dte: 18, pnl: 550, type: "PUT", conId: 400010, theta: 18.4, expiry: "2026-10-16", strike: 150, avgCost: 410, quantity: -2, pnlPercent: 67.1, marketPrice: 1.35, projectedProfit: 820 }],
      shareQuantity: 0, totalPremiums: 2960, unrealizedPnL: 550, totalDividends: 0, capitalDeployed: 30000, completedCycles: 3,
      currentPosition: { dte: 18, type: "PUT", expiry: "2026-10-16", strike: 150, quantity: -2, unrealizedPnl: 550 },
      totalPnLPercent: 7.1, adjustedCostBasis: 145.9, percentBelowMarket: 8.6, realizedPnLPercent: 6.2, unrealizedPnLPercent: 1.8,
    }),
    wheelTicker({
      symbol: "PFE", totalPnL: 612.8, breakEven: 23.9, cycleCount: 2, realizedPnL: 318.4, activePhases: ["holding_shares", "cc_open"], currentPhase: "cc_open", currentPrice: PRICES.PFE,
      sharePnL: 260, sharePnLPercent: 5.2, positionAvgCost: 25.1,
      activeOptions: { putsPnL: null, callsPnL: 82, nearestPut: null, nearestCall: { dte: 18, expiry: "2026-10-16", strike: 28 }, putsPnLPercent: null, callsPnLPercent: 66.1, totalPutContracts: 0, totalCallContracts: 2 },
      livePositions: [{ dte: 18, pnl: 82, type: "CALL", conId: 400013, theta: 4.4, expiry: "2026-10-16", strike: 28, avgCost: 62, quantity: -2, pnlPercent: 66.1, marketPrice: 0.21, projectedProfit: 124 }],
      shareQuantity: 200, cycleShareQuantity: 200, totalPremiums: 845, unrealizedPnL: 342, totalDividends: 172, capitalDeployed: 5020, completedCycles: 1,
      currentPosition: { dte: 18, type: "CALL", expiry: "2026-10-16", strike: 28, quantity: -2, unrealizedPnl: 82 },
      totalPnLPercent: 12.2, adjustedCostBasis: 23.9, percentBelowMarket: -6.1, realizedPnLPercent: 6.3, unrealizedPnLPercent: 6.8,
    }),
    wheelTicker({
      symbol: "KO", totalPnL: 894.0, breakEven: 66.3, cycleCount: 5, realizedPnL: 705.0, activePhases: ["csp_open"], currentPhase: "csp_open", currentPrice: PRICES.KO,
      activeOptions: { putsPnL: 189, callsPnL: null, nearestPut: { dte: 25, expiry: "2026-10-23", strike: 67.5 }, nearestCall: null, putsPnLPercent: 60.0, callsPnLPercent: null, totalPutContracts: 3, totalCallContracts: 0 },
      livePositions: [{ dte: 25, pnl: 189, type: "PUT", conId: 400011, theta: 9.1, expiry: "2026-10-23", strike: 67.5, avgCost: 105, quantity: -3, pnlPercent: 60.0, marketPrice: 0.42, projectedProfit: 315 }],
      shareQuantity: 0, totalPremiums: 1290, unrealizedPnL: 189, totalDividends: 0, capitalDeployed: 20250, completedCycles: 4,
      currentPosition: { dte: 25, type: "PUT", expiry: "2026-10-23", strike: 67.5, quantity: -3, unrealizedPnl: 189 },
      totalPnLPercent: 4.4, adjustedCostBasis: 66.3, percentBelowMarket: 3.3, realizedPnLPercent: 3.5, unrealizedPnLPercent: 0.9,
    }),
    wheelTicker({
      symbol: "CVX", totalPnL: 402.0, breakEven: 142.4, cycleCount: 2, realizedPnL: 332.0, activePhases: ["csp_open"], currentPhase: "csp_open", currentPrice: PRICES.CVX,
      activeOptions: { putsPnL: 70, callsPnL: null, nearestPut: { dte: 53, expiry: "2026-11-20", strike: 145 }, nearestCall: null, putsPnLPercent: 26.9, callsPnLPercent: null, totalPutContracts: 1, totalCallContracts: 0 },
      livePositions: [{ dte: 53, pnl: 70, type: "PUT", conId: 400012, theta: 3.2, expiry: "2026-11-20", strike: 145, avgCost: 260, quantity: -1, pnlPercent: 26.9, marketPrice: 1.9, projectedProfit: 260 }],
      shareQuantity: 0, totalPremiums: 592, unrealizedPnL: 70, totalDividends: 0, capitalDeployed: 14500, completedCycles: 1,
      currentPosition: { dte: 53, type: "PUT", expiry: "2026-11-20", strike: 145, quantity: -1, unrealizedPnl: 70 },
      totalPnLPercent: 2.8, adjustedCostBasis: 142.4, percentBelowMarket: 4.8, realizedPnLPercent: 3.2, unrealizedPnLPercent: 0.7,
    }),
  ],
  metrics: {
    capitalDeployed: 69770, totalPremiums: 5687, premiumYieldAnnualized: 11.8, vsBuyAndHold: 2.4, trackedCount: 4, activeWheels: 4, completedCycles: 9,
    totalRealizedPnL: 3200.9, totalUnrealizedPnL: 1151, totalPnL: 4351.9, totalPnLPercent: 6.6,
  },
  suggestions: [],
};

const calendarToday = [
  { id: "c1", eventType: "FOMC", symbol: null, date: "2026-09-29", title: "FOMC Meeting Minutes", details: null, source: "static", sourceId: null, marketWide: true },
  { id: "c2", eventType: "DIVIDEND_EX_DATE", symbol: "O", date: "2026-09-30", title: "O ex-dividend $0.269", details: { amount: 0.269, frequency: "monthly" }, source: "polygon", sourceId: "o-div", marketWide: false },
  { id: "c3", eventType: "JOBS_REPORT", symbol: null, date: "2026-10-02", title: "Nonfarm Payrolls", details: null, source: "static", sourceId: null, marketWide: true },
  { id: "c4", eventType: "OPTION_EXPIRATION", symbol: "SPX", date: "2026-10-02", title: "SPX weekly expiration", details: null, source: "positions", sourceId: null, marketWide: false },
];

// ---- Ticker page (NVDA) ----
function chart(start, days, drift) {
  const out = [];
  let v = start;
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  for (let i = 0; i <= days; i++) {
    if (d.getUTCDay() % 6 !== 0) {
      v *= 1 + (rnd() - 0.5 + drift) * 0.035;
      out.push({ date: d.toISOString().slice(0, 10), close: Math.round(v * 100) / 100 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const k = PRICES.NVDA / out[out.length - 1].close;
  return out.map((p) => ({ ...p, close: Math.round(p.close * k * 100) / 100 }));
}
const nvdaProfile = {
  symbol: "NVDA", companyName: "NVIDIA Corporation",
  description: "NVIDIA designs GPUs, systems-on-chip and networking for gaming, professional visualization, data center and automotive markets, and provides the CUDA software platform used for accelerated computing and AI.",
  sector: "Technology", industry: "Semiconductors", marketPosition: "Dominant supplier of data-center AI accelerators",
  marketCap: 4.42e12, peRatio: 51.3, dividendYield: 0.02, currentPrice: PRICES.NVDA, previousClose: 225.07,
  chart: chart(120, 365, 0.035), recommendation: "wheel", confidence: 0.72,
  ivRank: { ivRank: 34, currentIv: 0.41, iv52wLow: 0.29, iv52wHigh: 0.64, windowDays: 252, asOf: TODAY }, ivRankUnavailableReason: null,
};
const analyses = [
  ["technical", "bullish", 0.74, "Price above 50/200-day SMAs; RSI 61 with room before overbought. Support near $215."],
  ["fundamentals", "bullish", 0.81, "Revenue +56% YoY, gross margin 72%, net cash position. Premium valuation justified by growth."],
  ["options_flow", "neutral", 0.55, "Put/call ratio 0.82; IV rank 34 — moderate premium for put selling."],
  ["earnings", "bullish", 0.7, "Beat EPS estimates in 8 of the last 8 quarters. Next report in 8 weeks."],
  ["sec_filings", "neutral", 0.5, "No material 8-K events in the last 30 days. Routine insider sales under 10b5-1 plans."],
  ["macro", "bullish", 0.62, "Risk-on regime; semiconductors outperforming the broad index this quarter."],
  ["sentiment", "neutral", 0.58, "Mixed retail sentiment; analyst consensus remains Strong Buy."],
  ["valuation", "bearish", 0.6, "Forward P/E ~33x vs sector 22x; downside if growth decelerates."],
].map(([source, signal, confidence, summary], i) => ({ id: `an-${i}`, symbol: "NVDA", source, analyzedAt: `${TODAY}T09:00:00.000Z`, signal, confidence, summary, details: source === "technical" ? { trend: "uptrend", rsi14: 61.2, currentPrice: 228.86, sma50: 221.4, sma200: 201.06, support: 215, resistance: 240 } : {} }));
const nvdaReport = {
  id: "rep-nvda", symbol: "NVDA", createdAt: `${TODAY}T09:05:00.000Z`, recommendation: "wheel", confidence: 0.72,
  summary: "Strong fundamentals and trend, but a stretched multiple. Selling 30–45 DTE puts around the $215 support offers a better entry than buying outright.",
  fullReport: "## Thesis\n\nNVIDIA remains the leading supplier of AI accelerators with expanding margins and a net cash balance sheet.\n\n## Risks\n\n- Valuation premium vs. peers\n- Customer concentration among hyperscalers\n- Export restrictions\n\n## Strategy\n\nWheel: sell cash-secured puts at the 0.20–0.25 delta, roughly $215 strike, 30–45 DTE.",
  analysisIds: analyses.map((a) => a.id),
  companyOverview: { sector: nvdaProfile.sector, industry: nvdaProfile.industry, description: nvdaProfile.description, marketPosition: nvdaProfile.marketPosition },
};
const nvdaActivity = {
  symbol: "NVDA",
  open: [],
  closed: [
    { id: "a1", kind: "OPTION", displayName: "NVDA 165 PUT 2026-08-21", status: "expired", sortDate: "2026-08-21", realizedPnL: 312, unrealizedPnL: null,
      openLeg: { date: "2026-07-17", action: "Sold PUT", price: 3.12, quantity: 1, total: 312 }, closeLeg: { date: "2026-08-21", action: "Expired worthless", price: 0, quantity: 1, total: 0 }, dividend: null },
    { id: "a2", kind: "OPTION", displayName: "NVDA 160 PUT 2026-06-18", status: "closed", sortDate: "2026-06-05", realizedPnL: 228, unrealizedPnL: null,
      openLeg: { date: "2026-05-15", action: "Sold PUT", price: 3.4, quantity: 1, total: 340 }, closeLeg: { date: "2026-06-05", action: "Bought to close", price: 1.12, quantity: 1, total: -112 }, dividend: null },
    { id: "a3", kind: "DIVIDEND", displayName: "Dividend", status: "paid", sortDate: "2026-07-02", realizedPnL: 1.28, unrealizedPnL: null, openLeg: null, closeLeg: null,
      dividend: { perShare: 0.01, shares: 150, gross: 1.5, withholdingTax: -0.22, net: 1.28 } },
  ],
  summary: { optionsPnL: 540, stockPnL: 0, dividends: 1.28, total: 541.28, entryCount: 3, firstDate: "2026-05-15", lastDate: "2026-08-21" },
};
const nvdaCalendar = [
  { id: "n1", eventType: "EARNINGS", symbol: "NVDA", date: "2026-11-18", title: "NVDA Q3 FY27 earnings", details: { hour: "amc", quarter: "Q3", actualEps: null, estimateEps: 1.21, revenueActual: null, revenueEstimate: 5.42e10 }, source: "finnhub", sourceId: "nvda-q3", marketWide: false },
];

const watchlists = [
  { id: "wl-1", name: "Wheel candidates", createdAt: "2026-02-01T10:00:00.000Z", updatedAt: TODAY + "T10:00:00.000Z", _count: { items: 8 } },
  { id: "wl-2", name: "Dividend growth", createdAt: "2026-02-01T10:00:00.000Z", updatedAt: TODAY + "T10:00:00.000Z", _count: { items: 6 } },
];

// ---- Spreads option chain (Black-Scholes-ish synthetic chain) ----
function ncdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function bs(S, K, T, iv, right) {
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)); const d2 = d1 - iv * Math.sqrt(T);
  const call = S * ncdf(d1) - K * ncdf(d2);
  return right === "C" ? { price: call, delta: ncdf(d1) } : { price: call - S + K, delta: ncdf(d1) - 1 };
}
export const SPX = 6605.2;
export const spxExpirations = ["20260929", "20260930", "20261002", "20261009", "20261016", "20261023", "20261030", "20261106", "20261120"];
export function spxChain(expiration) {
  const iso = expiration.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  const dte = Math.max(1, (new Date(iso) - new Date(TODAY)) / 864e5);
  const T = dte / 365;
  const chain = [];
  for (let k = 5900; k <= 7200; k += 5) {
    const m = Math.log(k / SPX);
    const iv = 0.135 - 0.25 * m + 0.6 * m * m; // skew
    const mk = (right) => {
      const { price, delta } = bs(SPX, k, T, iv, right);
      const mid = Math.max(0.05, Math.round(price * 20) / 20);
      const half = Math.max(0.05, Math.round(mid * 0.012 * 20) / 20);
      return { conId: 700000 + k * 2 + (right === "C" ? 1 : 0), bid: Math.max(0, mid - half), ask: mid + half, mid, last: mid, delta: Math.abs(Math.round(delta * 1000) / 1000), iv: Math.round(iv * 1000) / 1000 };
    };
    chain.push({ strike: k, put: mk("P"), call: mk("C") });
  }
  return chain;
}
export function analyze(body) {
  const { legs, quantity = 1, underlyingPrice: S } = body;
  const sign = (l) => (l.side === "SELL" ? 1 : -1);
  const credit = legs.reduce((s, l) => s + sign(l) * (l.bid + l.ask) / 2, 0);
  const pnlAt = (P) => legs.reduce((s, l) => {
    const intrinsic = l.type === "PUT" ? Math.max(0, l.strike - P) : Math.max(0, P - l.strike);
    return s - sign(l) * intrinsic;
  }, credit) * 100 * quantity;
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(...strikes) - 150, hi = Math.max(...strikes) + 150;
  const payoffCurve = [];
  for (let p = lo; p <= hi; p += 5) payoffCurve.push({ price: p, pnl: Math.round(pnlAt(p) * 100) / 100 });
  const maxProfit = Math.max(...payoffCurve.map((x) => x.pnl));
  const puts = legs.filter((l) => l.type === "PUT"), calls = legs.filter((l) => l.type === "CALL");
  const width = (ls) => (ls.length === 2 ? Math.abs(ls[0].strike - ls[1].strike) : null);
  const wp = width(puts), wc = width(calls);
  const shortPut = puts.find((l) => l.side === "SELL"), shortCall = calls.find((l) => l.side === "SELL");
  const beLow = shortPut ? shortPut.strike - credit : null, beHigh = shortCall ? shortCall.strike + credit : null;
  const maxLossPut = wp != null ? -(wp - credit) * 100 * quantity : null, maxLossCall = wc != null ? -(wc - credit) * 100 * quantity : null;
  const maxLoss = Math.min(...[maxLossPut, maxLossCall].filter((x) => x != null));
  return {
    netCredit: { bid: credit - 0.3, ask: credit + 0.3, mid: credit }, maxProfit,
    maxLossPut, maxLossCall, breakEvenLow: beLow, breakEvenHigh: beHigh,
    breakEvenLowPercent: beLow ? ((beLow - S) / S) * 100 : null, breakEvenHighPercent: beHigh ? ((beHigh - S) / S) * 100 : null,
    probabilityOfProfit: calls.length && puts.length ? 91.4 : 95.1, probabilityOfMaxLossPut: puts.length ? 3.2 : null, probabilityOfMaxLossCall: calls.length ? 2.8 : null,
    expectedValue: 38.5, riskRewardRatio: Math.abs(maxLoss / maxProfit), payoffCurve,
  };
}

export const routes = {
  "GET /api/health": { status: "ok" },
  "GET /api/research/macro": macro,
  "GET /api/scanner/jobs": [],
  "GET /api/research/jobs": [],
  "GET /api/dashboard/daily-pnl": { dailyPnL: 1284.6, unrealizedPnL: 912.4, realizedPnL: 372.2 },
  "GET /api/calendar/today": calendarToday,
  "GET /api/settings/spreads": { id: "s1", key: "spreads", value: { symbols: ["SPX", "XSP", "RUT"], updateIntervalMs: 1000 }, updatedAt: TODAY },
  "GET /api/dashboard/account-history": accountHistory(),
  "GET /api/profit/years": { years: [2026, 2025, 2024] },
  "GET /api/dashboard/summary": dashboardSummary(),
  "GET /api/positions/summary": positionsSummary(),
  "GET /api/positions": positions,
  "GET /api/asset-classes": assetClasses,
  "GET /api/spreads/positions": spreadPositions,
  "GET /api/wheel": wheel,
  "GET /api/watchlists": watchlists,
  "GET /api/research/NVDA": nvdaReport,
  "GET /api/research/NVDA/analysis": { symbol: "NVDA", analyses, collectionStatuses: [], lastUpdated: `${TODAY}T09:00:00.000Z` },
  "GET /api/research/NVDA/data": { symbol: "NVDA", collections: [] },
  "GET /api/ticker-profile/NVDA": nvdaProfile,
  "GET /api/ticker-profile/NVDA/quote": { symbol: "NVDA", last: PRICES.NVDA, open: 229.75, close: 225.07, bid: 228.84, ask: 228.9, volume: 184_220_310 },
  "GET /api/calendar/ticker/NVDA": nvdaCalendar,
  "GET /api/profit/ticker/NVDA/activity": nvdaActivity,
  "GET /api/spreads/expirations": { expirations: spxExpirations },
  "GET /api/orders": [],
  "GET /api/scanner/presets": [],
};

const NAMES = { VTI: ["Vanguard Total Stock Market ETF", "ETF", "Broad Market"], MSFT: ["Microsoft Corporation", "Technology", "Software"], AAPL: ["Apple Inc.", "Technology", "Consumer Electronics"],
  VXUS: ["Vanguard Total International Stock ETF", "ETF", "International"], BND: ["Vanguard Total Bond Market ETF", "ETF", "Fixed Income"], IEF: ["iShares 7-10 Year Treasury Bond ETF", "ETF", "Fixed Income"],
  GLD: ["SPDR Gold Shares", "ETF", "Commodities"], O: ["Realty Income Corporation", "Real Estate", "REIT - Retail"], PFE: ["Pfizer Inc.", "Healthcare", "Pharmaceuticals"],
  AMD: ["Advanced Micro Devices, Inc.", "Technology", "Semiconductors"], KO: ["The Coca-Cola Company", "Consumer Defensive", "Beverages"], CVX: ["Chevron Corporation", "Energy", "Oil & Gas"], SPX: ["S&P 500 Index", "Index", "Index"] };
export function sparklines(symbols) {
  const out = {};
  for (const s of symbols) {
    const last = PRICES[s] ?? 100;
    let v = last * (0.93 + rnd() * 0.1);
    const pts = [];
    for (let i = 0; i < 22; i++) { v *= 1 + (rnd() - 0.47) * 0.02; pts.push(v); }
    const k = last / pts[pts.length - 1];
    out[s] = pts.map((c, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, close: Math.round(c * k * 100) / 100 }));
  }
  return out;
}
export function profileBatch(symbols) {
  const out = {};
  for (const s of symbols) {
    if (s === "NVDA") { out[s] = nvdaProfile; continue; }
    const [companyName, sector, industry] = NAMES[s] ?? [s, "Other", "Other"];
    out[s] = { symbol: s, companyName, description: `${companyName}.`, sector, industry, marketPosition: "", marketCap: 1.2e11, peRatio: 21.4, dividendYield: 1.8,
      currentPrice: PRICES[s] ?? SPX, previousClose: (PRICES[s] ?? SPX) * 0.996, chart: [], recommendation: null, confidence: null, ivRank: null, ivRankUnavailableReason: "demo" };
  }
  return out;
}
const TARGETS = { "ac-us": 30, "ac-tech": 25, "ac-intl": 15, "ac-bonds": 15, "ac-metals": 8, "ac-re": 7 };
routes["GET /api/allocation-profiles/active"] = {
  id: "ap-1", name: "Growth 80/20", isActive: true, createdAt: "2026-01-02T10:00:00.000Z", updatedAt: "2026-01-02T10:00:00.000Z",
  targets: assetClasses.map((a) => ({ id: `t-${a.id}`, allocationProfileId: "ap-1", assetClassId: a.id, targetPercentage: TARGETS[a.id], assetClass: a })),
};
routes["GET /api/allocation-profiles"] = [routes["GET /api/allocation-profiles/active"]];
routes["GET /api/settings/dashboard"] = { id: "s2", key: "dashboard", value: { includeOptions: true, optionsWeightMode: "notional" }, updatedAt: TODAY };
