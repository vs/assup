import {
  IBApiNext,
  ConnectionState,
  AccountSummaryTagValues,
  Position as IBPosition,
  OpenOrder,
  Bar,
  Contract,
  ContractDescription,
  ContractDetails,
  BarSizeSetting,
  WhatToShow,
  OptionType,
  SecType,
  ExecutionFilter,
  ExecutionDetail,
  CommissionReport,
  Order,
  OrderAction,
  OrderType,
  TimeInForce,
} from "@stoqey/ib";
import type { ScannerSubscription } from "@stoqey/ib";
import { ScanCode, Instrument, LocationCode } from "@stoqey/ib";
import type { ImportedTrade } from "@prisma/client";
import { Subscription, lastValueFrom } from "rxjs";
import { BadRequestError } from "../errors/index.js";
import { isMarketOpen } from "../utils/market.js";

interface ConnectionStatus {
  connected: boolean;
  account: string | null;
  serverVersion: number | null;
  serverConnectionTime: string | null;
  error: string | null;
}

export interface AccountData {
  netLiquidation: number;
  totalCashValue: number;
  availableFunds: number;
}

export interface Position {
  account: string;
  contract: Contract;
  pos: number;
  avgCost: number;
  marketPrice?: number;
  marketValue?: number;
  unrealizedPnl?: number;
}

interface HistoricalDataParams {
  contract: Contract;
  endDateTime?: string;
  duration: string;
  barSizeSetting: BarSizeSetting;
  whatToShow: WhatToShow;
  useRth: number | boolean;
  formatDate: number;
}

export interface OptionChainEntry {
  strike: number;
  expiration: string;
  call: Contract;
  put: Contract;
}

interface TickerData {
  contract: Contract;
  bid?: number;
  ask?: number;
  last?: number;
  open?: number;
  close?: number;
  delta?: number;
  volume?: number;
  impliedVolatility?: number;
}

export interface StreamTickData {
  bid?: number;
  ask?: number;
  last?: number;
  close?: number;
  delta?: number;
  impliedVolatility?: number;
}

export type FundamentalReportType = "ReportSnapshot" | "ReportRatios" | "RESC";

export interface EnhancedMarketData extends TickerData {
  historicalVolatility?: number;
  impliedVolatility?: number;
  shortableShares?: number;
  shortableIndicator?: number; // >2.5 = available, 1.5-2.5 = limited, <1.5 = not available
  fundamentalRatios?: string; // pipe-delimited string from tick 258
  ibDividends?: string; // tick 456 string
  callVolume?: number;
  putVolume?: number;
  callOpenInterest?: number;
  putOpenInterest?: number;
}

export interface MarketScannerParams {
  scanCode: string;
  instrument?: string;        // default "STK"
  locationCode?: string;      // default "STK.US.MAJOR"
  numberOfRows?: number;      // default 50
  abovePrice?: number;
  belowPrice?: number;
  aboveVolume?: number;
  marketCapAbove?: number;
  marketCapBelow?: number;
  averageOptionVolumeAbove?: number;
  stockTypeFilter?: string;   // "CORP", "ADR", "ETF", "REIT"
}

export interface ScannerResult {
  rank: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  longName?: string;
  industry?: string;
  category?: string;
  subcategory?: string;
}

/** Standard normal CDF using Abramowitz & Stegun approximation */
function normcdf(x: number): number {
  const a = 0.2316419;
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937;
  const b4 = -1.821255978, b5 = 1.330274429;
  const ax = Math.abs(x);
  const t = 1 / (1 + a * ax);
  const pdf = Math.exp(-0.5 * ax * ax) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * Black-Scholes daily theta (per-share).
 * Returns negative value (time decay erodes option value).
 */
function bsTheta(
  S: number, K: number, T: number,
  sigma: number, isPut: boolean, r = 0.05,
): number {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf_d1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const timeDecay = -(S * pdf_d1 * sigma) / (2 * sqrtT);
  const annualTheta = isPut
    ? timeDecay + r * K * Math.exp(-r * T) * normcdf(-d2)
    : timeDecay - r * K * Math.exp(-r * T) * normcdf(d2);
  return annualTheta / 365;
}

/** Days from today to YYYYMMDD expiry string */
function daysToExpiry(expiry: string): number {
  const y = parseInt(expiry.slice(0, 4));
  const m = parseInt(expiry.slice(4, 6)) - 1;
  const d = parseInt(expiry.slice(6, 8));
  const exp = new Date(y, m, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 86400000));
}

class IBKRService {
  private api: IBApiNext | null = null;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    account: null,
    serverVersion: null,
    serverConnectionTime: null,
    error: null,
  };
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusWatchdog: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;

  // Account data
  private accountSummary: Map<string, AccountSummaryTagValues> = new Map();
  private accountSubscription: Subscription | null = null;
  private pnlSubscription: Subscription | null = null;
  private dailyPnlData: { dailyPnL: number; unrealizedPnL: number; realizedPnL: number } = {
    dailyPnL: 0, unrealizedPnL: 0, realizedPnL: 0,
  };
  private connectionSubscription: Subscription | null = null;

  // Deduplication cache for getExecutions() — concurrent callers share one TWS request
  private _executionsInflight: Promise<{ executions: ExecutionDetail[]; commissions: Map<string, CommissionReport> }> | null = null;
  private _executionsCacheTs = 0;

  // Track TWS API timeouts so callers can surface warnings
  private _executionsTimedOut = false;

  /** Returns true if the most recent getExecutions() call timed out. */
  get executionsTimedOut(): boolean {
    return this._executionsTimedOut;
  }

  constructor() {
    this.connect();
    this.startStatusWatchdog();
  }

  /**
   * Periodically reconcile connectionStatus with api.isConnected.
   * The connectionState observable can miss transitions during auto-reconnect
   * or terminate after an error, leaving the tracked status stale.
   */
  private startStatusWatchdog() {
    this.statusWatchdog = setInterval(() => {
      const actual = this.api?.isConnected ?? false;
      if (actual !== this.connectionStatus.connected) {
        console.log(
          `Connection status drift detected: tracked=${this.connectionStatus.connected}, actual=${actual}`,
        );
        if (actual) {
          this.handleConnected();
        } else {
          this.handleDisconnected();
        }
      }
    }, 2000);
  }

  private connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const host = process.env.IB_HOST || "127.0.0.1";
    const port = parseInt(process.env.IB_PORT || "7496", 10);

    console.log(`Connecting to TWS at ${host}:${port}...`);

    // Clean up previous instance if any
    this.cleanup();

    try {
      this.api = new IBApiNext({
        host,
        port,
        reconnectInterval: 5000, // Auto-reconnect every 5 seconds
        connectionWatchdogInterval: 10, // 10 second watchdog
      });

      // Subscribe to connection state changes
      this.connectionSubscription = this.api.connectionState.subscribe({
        next: (state) => {
          console.log(`TWS connection state: ${ConnectionState[state]}`);
          if (state === ConnectionState.Connected) {
            this.handleConnected();
          } else if (state === ConnectionState.Disconnected) {
            this.handleDisconnected();
          }
        },
        error: (err) => {
          console.error("Connection state error:", err);
          this.handleError(err);
        },
      });

      // Subscribe to errors — surface TWS messages, suppress noisy expected ones
      this.api.error.subscribe({
        next: (err) => {
          const code = Number(err.code);
          // Suppress high-volume expected errors:
          // 200: No security definition found (during scanning)
          // 300: Can't find EId with tickerId (stale cancel after reconnect)
          // 321: Error validating request (during scanning)
          // 10185: Failed to cancel PNL (unsubscribe when not subscribed)
          if (code === 200 || code === 300 || code === 321 || code === 10185) return;
          if (code && err.error?.message) {
            console.error(`TWS Error ${err.code}: ${err.error.message}`);
          }
        },
      });

      this.api.connect(1);
    } catch (err) {
      console.error("Failed to connect to TWS:", err);
      this.handleError(err);
    } finally {
      this.isConnecting = false;
    }
  }

  private handleConnected() {
    this.updateStatus({
      connected: true,
      account: null,
      serverVersion: null,
      serverConnectionTime: new Date().toISOString(),
      error: null,
    });

    console.log("Connected to TWS");

    // Set market data type to delayed (3) to avoid subscription errors
    // Market data types: 1=Live, 2=Frozen, 3=Delayed, 4=Delayed-Frozen
    if (this.api) {
      this.api.setMarketDataType(3);
      console.log("Set market data type to: Delayed (3)");
    }

    // Subscribe to account summary for cash balance
    this.subscribeToAccountSummary();
    this.subscribeToPnL();
  }

  private subscribeToAccountSummary() {
    if (!this.api) return;

    // Cancel existing subscription if any
    if (this.accountSubscription) {
      this.accountSubscription.unsubscribe();
    }

    this.accountSubscription = this.api
      .getAccountSummary("All", "NetLiquidation,TotalCashValue,AvailableFunds")
      .subscribe({
        next: (update) => {
          // update.all is a Map<account, AccountSummaryTagValues>
          if (update.all) {
            update.all.forEach((values, account) => {
              this.accountSummary.set(account, values);
              // Update connection status with account
              if (!this.connectionStatus.account) {
                this.updateStatus({ account });
              }
            });
          }
        },
        error: (err) => {
          console.error("Account summary error:", err);
        },
      });
  }

  private subscribeToPnL() {
    if (!this.api) return;

    if (this.pnlSubscription) {
      this.pnlSubscription.unsubscribe();
    }

    const account = this.connectionStatus.account;
    if (!account) {
      // Retry once account is known (subscribeToAccountSummary will set it)
      const checkInterval = setInterval(() => {
        if (this.connectionStatus.account) {
          clearInterval(checkInterval);
          this.subscribeToPnL();
        }
      }, 1000);
      setTimeout(() => clearInterval(checkInterval), 30000);
      return;
    }

    this.pnlSubscription = this.api.getPnL(account).subscribe({
      next: (pnl) => {
        this.dailyPnlData = {
          dailyPnL: pnl.dailyPnL ?? 0,
          unrealizedPnL: pnl.unrealizedPnL ?? 0,
          realizedPnL: pnl.realizedPnL ?? 0,
        };
      },
      error: (err) => {
        console.error("PnL subscription error:", err);
      },
    });
  }

  getDailyPnL(): { dailyPnL: number; unrealizedPnL: number; realizedPnL: number } {
    return { ...this.dailyPnlData };
  }

  private handleDisconnected() {
    this.updateStatus({
      connected: false,
      account: null,
      serverVersion: null,
      serverConnectionTime: null,
      error: "Disconnected from TWS",
    });

    // Clear account data
    this.accountSummary.clear();
    this.dailyPnlData = { dailyPnL: 0, unrealizedPnL: 0, realizedPnL: 0 };
    if (this.pnlSubscription) {
      this.pnlSubscription.unsubscribe();
      this.pnlSubscription = null;
    }
  }

  private handleError(err: unknown) {
    let message = "";
    let code: string | null = null;

    if (err instanceof Error) {
      message = err.message;
      if ("code" in err && typeof err.code === "string") {
        code = err.code;
      }
    } else {
      message = String(err);
    }

    const errorText = message || code || "Unknown error";

    this.updateStatus({
      connected: false,
      account: null,
      serverVersion: null,
      serverConnectionTime: null,
      error: this.getErrorHelp(code, errorText),
    });
  }

  private getErrorHelp(code: string | null, message: string): string {
    const lowerMessage = message.toLowerCase();
    const lowerCode = code?.toLowerCase() || "";

    if (
      lowerCode === "econnrefused" ||
      lowerMessage.includes("econnrefused") ||
      lowerMessage.includes("connection refused")
    ) {
      return "Connection refused. TWS is not running or not accepting connections on the configured port.";
    }

    if (lowerMessage.includes("couldn't connect")) {
      return "Cannot connect to TWS. Please ensure: (1) TWS or IB Gateway is running, (2) API connections are enabled in TWS Configuration > API > Settings, (3) Socket port matches (default: 7497 for paper, 7496 for live).";
    }

    if (lowerMessage.includes("not connected")) {
      return "Not connected to TWS. The connection was lost or never established.";
    }

    if (
      lowerCode === "etimedout" ||
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out")
    ) {
      return "Connection timed out. Check network connectivity and TWS status.";
    }

    if (
      lowerCode === "enotfound" ||
      lowerMessage.includes("enotfound") ||
      lowerMessage.includes("getaddrinfo")
    ) {
      return "Cannot resolve TWS host. Check the IB_HOST environment variable.";
    }

    if (
      lowerCode === "enetunreach" ||
      lowerMessage.includes("enetunreach")
    ) {
      return "Network unreachable. Check your network connection and TWS host configuration.";
    }

    if (message && message.length > 0) {
      return `Connection error: ${message}`;
    }

    return "Cannot connect to TWS. Please ensure TWS or IB Gateway is running and API connections are enabled.";
  }

  private updateStatus(partial: Partial<ConnectionStatus>) {
    this.connectionStatus = { ...this.connectionStatus, ...partial };
    this.notifyListeners();
  }

  private notifyListeners() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private cleanup() {
    if (this.statusWatchdog) {
      clearInterval(this.statusWatchdog);
      this.statusWatchdog = null;
    }
    if (this.accountSubscription) {
      this.accountSubscription.unsubscribe();
      this.accountSubscription = null;
    }
    if (this.connectionSubscription) {
      this.connectionSubscription.unsubscribe();
      this.connectionSubscription = null;
    }
    if (this.api) {
      try {
        this.api.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.api = null;
    }
  }

  // Public API

  getStatus(): ConnectionStatus {
    // Use api.isConnected as the source of truth — the cached
    // connectionStatus.connected can lag behind after auto-reconnect.
    const connected = this.api?.isConnected ?? false;
    return { ...this.connectionStatus, connected };
  }

  getApi(): IBApiNext | null {
    return this.api;
  }

  subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return this.api?.isConnected ?? false;
  }

  // Account data methods
  getAccountData(): AccountData {
    let netLiquidation = 0;
    let totalCashValue = 0;
    let availableFunds = 0;

    // Sum across all accounts
    // AccountSummaryTagValues is Map<tagName, Map<currency, {value, ingressTm}>>
    this.accountSummary.forEach((tagValues) => {
      // Get NetLiquidation (try USD first, then any currency)
      const netLiqValues = tagValues.get("NetLiquidation");
      if (netLiqValues) {
        const usdValue = netLiqValues.get("USD") || netLiqValues.values().next().value;
        if (usdValue) {
          netLiquidation += parseFloat(usdValue.value) || 0;
        }
      }

      // Get TotalCashValue
      const cashValues = tagValues.get("TotalCashValue");
      if (cashValues) {
        const usdValue = cashValues.get("USD") || cashValues.values().next().value;
        if (usdValue) {
          totalCashValue += parseFloat(usdValue.value) || 0;
        }
      }

      // Get AvailableFunds
      const fundsValues = tagValues.get("AvailableFunds");
      if (fundsValues) {
        const usdValue = fundsValues.get("USD") || fundsValues.values().next().value;
        if (usdValue) {
          availableFunds += parseFloat(usdValue.value) || 0;
        }
      }
    });

    return { netLiquidation, totalCashValue, availableFunds };
  }

  getCashBalance(): number {
    return this.getAccountData().totalCashValue;
  }

  getNetLiquidation(): number {
    return this.getAccountData().netLiquidation;
  }

  // Positions - uses getAccountUpdates to get portfolio with market values
  async getPositions(): Promise<Position[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    return new Promise((resolve, reject) => {
      const positions: Position[] = [];
      let resolved = false;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimeoutId: ReturnType<typeof setTimeout>;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        clearTimeout(maxTimeoutId);
        subscription.unsubscribe();
        resolve(positions);
      };

      // Use getAccountUpdates instead of getPositions to get market values
      const subscription = this.api!.getAccountUpdates().subscribe({
        next: (update) => {
          // update.all is an AccountUpdate with portfolio (Map<account, Position[]>)
          if (update.all?.portfolio) {
            positions.length = 0; // Clear to avoid duplicates on updates
            update.all.portfolio.forEach((accountPositions, account) => {
              accountPositions.forEach((pos) => {
                positions.push({
                  account,
                  contract: pos.contract,
                  pos: pos.pos,
                  avgCost: pos.avgCost ?? 0,
                  marketPrice: pos.marketPrice,
                  marketValue: pos.marketValue,
                  unrealizedPnl: pos.unrealizedPNL,
                });
              });
            });

            // Debounce: resolve 200ms after last update (batch complete)
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(finish, 200);
          }
        },
        error: (err) => {
          if (!resolved) {
            resolved = true;
            if (debounceTimer) clearTimeout(debounceTimer);
            clearTimeout(maxTimeoutId);
            subscription.unsubscribe();
            reject(err);
          }
        },
        complete: finish,
      });

      // Max timeout - safety net if no updates come at all
      maxTimeoutId = setTimeout(finish, 3000);
    });
  }

  // Orders
  async getAllOpenOrders(): Promise<OpenOrder[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    return this.api.getAllOpenOrders();
  }

  // Historical data
  async getHistoricalData(params: HistoricalDataParams): Promise<Bar[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    return this.api.getHistoricalData(
      params.contract,
      params.endDateTime || "",
      params.duration,
      params.barSizeSetting,
      params.whatToShow,
      params.useRth,
      params.formatDate
    );
  }

  // For health checks
  async getCurrentTime(): Promise<number> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }
    return this.api.getCurrentTime();
  }

  // Options chain
  async getOptionChain(symbol: string, exchange = "SMART"): Promise<OptionChainEntry[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const underlyingContract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange,
      currency: "USD",
    };

    try {
      // IBApiNext uses lastValueFrom with no timeout — wrap both calls so
      // a stuck TWS response doesn't hang the scan job indefinitely.
      const CHAIN_TIMEOUT_MS = 30_000;
      const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${CHAIN_TIMEOUT_MS}ms for ${symbol}`)), CHAIN_TIMEOUT_MS),
          ),
        ]);

      // Get contract details which includes option chain info
      const details = await withTimeout(
        this.api.getContractDetails(underlyingContract),
        "getContractDetails",
      );

      if (!details || details.length === 0) {
        console.debug(`[getOptionChain] ${symbol}: no contract details found`);
        return [];
      }

      // Get security definitions for options
      const secDefs = await withTimeout(
        this.api.getSecDefOptParams(
          symbol,
          "",
          SecType.STK,
          details[0].contract.conId!
        ),
        "getSecDefOptParams",
      );

      if (!secDefs || secDefs.length === 0) {
        console.debug(`[getOptionChain] ${symbol}: no options listed (getSecDefOptParams returned empty)`);
        return [];
      }

      // Build options chain from security definitions.
      // secDefs contains one entry per (exchange, tradingClass) combination.
      // Prefer the standard trading class matching the symbol name — non-standard
      // classes (e.g. "GTLB1" after a corporate action) have adjusted deliverables
      // and strike/expiration sets that often fail to resolve via SMART routing.
      const standardDefs = secDefs.filter(d => d.tradingClass === symbol);
      const activeDefs = standardDefs.length > 0 ? standardDefs : secDefs;
      const tradingClass = standardDefs.length > 0 ? symbol : activeDefs[0]?.tradingClass;
      const multiplier = activeDefs[0]?.multiplier ?? 100;

      const chainMap = new Map<string, OptionChainEntry>();

      for (const secDef of activeDefs) {
        if (!secDef.expirations || !secDef.strikes) continue;

        for (const expiration of secDef.expirations) {
          for (const strike of secDef.strikes) {
            const key = `${expiration}_${strike}`;

            // Skip if we already have this strike+expiration (from another exchange)
            if (chainMap.has(key)) continue;

            const callContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: "SMART",
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Call,
              multiplier,
              tradingClass,
            };

            const putContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: "SMART",
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Put,
              multiplier,
              tradingClass,
            };

            chainMap.set(key, {
              strike,
              expiration,
              call: callContract,
              put: putContract,
            });
          }
        }
      }

      return Array.from(chainMap.values());
    } catch (err) {
      console.error(`Failed to get option chain for ${symbol}:`, err);
      return [];
    }
  }

  // Set market data type: 1=Live, 2=Frozen, 3=Delayed, 4=Delayed-Frozen
  setMarketDataType(type: 1 | 2 | 3 | 4) {
    if (!this.api) {
      throw new Error("Not connected to TWS");
    }
    const typeNames = { 1: "Live", 2: "Frozen", 3: "Delayed", 4: "Delayed-Frozen" };
    this.api.setMarketDataType(type);
    console.log(`Set market data type to: ${typeNames[type]} (${type})`);
  }

  private liveMarketDataRefCount = 0;

  async acquireLiveMarketData(): Promise<void> {
    this.liveMarketDataRefCount++;
    if (this.liveMarketDataRefCount === 1) {
      const type = isMarketOpen() ? 1 : 2;
      try {
        this.setMarketDataType(type as 1 | 2);
        // TWS processes setMarketDataType asynchronously — snapshots that
        // fire before the switch completes will fail with error 10091
        // ("subscription required"). A short settle lets TWS finish.
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // continue with whatever type is active
      }
    }
  }

  releaseLiveMarketData(): void {
    this.liveMarketDataRefCount = Math.max(0, this.liveMarketDataRefCount - 1);
    if (this.liveMarketDataRefCount === 0) {
      try {
        this.setMarketDataType(3);
      } catch {
        // ignore
      }
    }
  }

  // Get market data for a contract (bid, ask, last).
  // snapshotOnly=true skips the Observable fallback — use for batch calls where
  // the Observable path would hang on frozen/unavailable contracts.
  // timeoutMs controls the per-contract deadline (default 5s; use shorter in batch mode).
  async getMarketData(contract: Contract, snapshotOnly = false, timeoutMs = 5000): Promise<TickerData | null> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    // For options, use SMART routing for market data (per TWS API documentation)
    // This works better than specific exchanges which may be outdated (e.g., AMEX -> NYSE American)
    const mdContract = contract.secType === SecType.OPT
      ? { ...contract, exchange: "SMART" }
      : contract;

    // IBKR uses -1 as a sentinel for "no data available"; treat as undefined
    const validPrice = (v: number | undefined) => v != null && v >= 0 ? v : undefined;

    // Try snapshot first (fast), then fall back to Observable-based streaming.
    // Wrap in a timeout — when TWS is unresponsive, snapshot can hang 11s+.
    // snapshotOnly skips the Observable fallback to avoid per-contract hangs in batch mode.
    const MD_TIMEOUT_MS = timeoutMs;
    let result: Omit<TickerData, "contract"> | null = null;
    try {
      const mdPromise = snapshotOnly
        ? this.trySnapshotMarketData(mdContract, validPrice)
        : (async () =>
            await this.trySnapshotMarketData(mdContract, validPrice)
              ?? await this.tryObservableMarketData(mdContract, validPrice))();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`getMarketData timed out after ${MD_TIMEOUT_MS}ms for ${contract.symbol}`)), MD_TIMEOUT_MS),
      );
      result = await Promise.race([mdPromise, timeoutPromise]);
    } catch {
      // Timeout or unexpected error — return null (no data)
      return null;
    }

    if (result) {
      return { contract, ...result };
    }
    return null;
  }

  private async trySnapshotMarketData(
    mdContract: Contract,
    validPrice: (v: number | undefined) => number | undefined,
  ): Promise<Omit<TickerData, "contract"> | null> {
    try {
      const marketData = await this.api!.getMarketDataSnapshot(mdContract, "", false);
      if (!marketData) return null;

      const bidTick = marketData.get(1) ?? marketData.get(66);       // BID / DELAYED_BID
      const askTick = marketData.get(2) ?? marketData.get(67);       // ASK / DELAYED_ASK
      const lastTick = marketData.get(4) ?? marketData.get(68);      // LAST / DELAYED_LAST
      const volumeTick = marketData.get(8) ?? marketData.get(74);    // VOLUME / DELAYED_VOLUME
      const closeTick = marketData.get(9) ?? marketData.get(75);     // CLOSE / DELAYED_CLOSE
      const openTick = marketData.get(14) ?? marketData.get(76);     // OPEN / DELAYED_OPEN

      const bid = validPrice(bidTick?.value);
      const ask = validPrice(askTick?.value);
      const last = validPrice(lastTick?.value);
      const close = validPrice(closeTick?.value);

      // If no usable price data at all, return null to trigger fallback
      if (last == null && bid == null && ask == null && close == null) {
        return null;
      }

      let delta: number | undefined;
      let impliedVolatility: number | undefined;
      if (mdContract.secType === SecType.OPT) {
        const modelDelta = marketData.get(10041);
        const delayedModelDelta = marketData.get(10047);
        const bidDelta = marketData.get(10005);
        const delayedBidDelta = marketData.get(10011);
        delta = modelDelta?.value ?? delayedModelDelta?.value ?? bidDelta?.value ?? delayedBidDelta?.value;

        const modelIV = marketData.get(10039);
        const delayedModelIV = marketData.get(10045);
        const optionIV = marketData.get(24);
        impliedVolatility = modelIV?.value ?? delayedModelIV?.value ?? optionIV?.value;
      }

      return {
        bid, ask, last,
        open: validPrice(openTick?.value),
        close,
        volume: volumeTick?.value,
        delta,
        impliedVolatility,
      };
    } catch (err) {
      const error = err as { code?: number; message?: string };
      if (
        error.code === 10089 || // Snapshot not available for contract type
        error.code === 10091 || // Subscription required
        error.code === 200 ||    // No security definition found
        error.code === 321 ||    // Snapshot not applicable to generic ticks
        error.message?.includes("additional subscription") ||
        error.message?.includes("No security definition") ||
        error.message?.includes("not applicable to generic ticks")
      ) {
        return null;
      }
      console.error(`Snapshot market data failed for ${mdContract.symbol}:`, err);
      return null;
    }
  }

  private async tryObservableMarketData(
    mdContract: Contract,
    validPrice: (v: number | undefined) => number | undefined,
  ): Promise<Omit<TickerData, "contract"> | null> {
    try {
      const update = await lastValueFrom(
        this.api!.getMarketData(mdContract, "", true, false),
      );
      const marketData = update.all;
      if (!marketData || marketData.size === 0) return null;

      const last = validPrice(marketData.get(4)?.value ?? marketData.get(68)?.value);
      const bid = validPrice(marketData.get(1)?.value ?? marketData.get(66)?.value);
      const ask = validPrice(marketData.get(2)?.value ?? marketData.get(67)?.value);
      const close = validPrice(marketData.get(9)?.value ?? marketData.get(75)?.value);

      if (last == null && bid == null && ask == null && close == null) {
        return null;
      }

      let delta: number | undefined;
      let impliedVolatility: number | undefined;
      if (mdContract.secType === SecType.OPT) {
        delta = marketData.get(10041)?.value ?? marketData.get(10047)?.value
          ?? marketData.get(10005)?.value ?? marketData.get(10011)?.value;
        impliedVolatility = marketData.get(10039)?.value ?? marketData.get(10045)?.value
          ?? marketData.get(24)?.value;
      }

      return {
        bid, ask, last, close,
        open: validPrice(marketData.get(14)?.value ?? marketData.get(76)?.value),
        volume: marketData.get(8)?.value ?? marketData.get(74)?.value,
        delta,
        impliedVolatility,
      };
    } catch (err) {
      const error = err as { code?: number; message?: string };
      // Silently ignore expected failures:
      // - code 200/10089/10091: IBKR contract/subscription errors
      // - "no elements in sequence": rxjs EmptyError when observable completes
      //   without emitting (e.g. outside market hours, no subscription)
      if (error.code === 200 || error.code === 10089 || error.code === 10091) {
        return null;
      }
      if (error.message === "no elements in sequence") {
        return null;
      }
      console.error(`Observable market data failed for ${mdContract.symbol}:`, err);
      return null;
    }
  }

  // Get market data for multiple contracts in parallel.
  // Snapshots are short-lived (TWS auto-cancels after responding) so they
  // don't need to be tracked in the line registry. We just cap concurrency
  // to avoid flooding TWS with too many simultaneous requests.
  async getMarketDataBatch(contracts: Contract[], signal?: AbortSignal): Promise<Map<string, TickerData>> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const results = new Map<string, TickerData>();
    const failedContracts: Contract[] = [];

    const batchSize = 10;
    const initialTimeoutMs = 2000;

    for (let i = 0; i < contracts.length; i += batchSize) {
      if (signal?.aborted) {
        console.log(`Market data batch: aborted by client (${i}/${contracts.length} processed)`);
        break;
      }

      const batch = contracts.slice(i, i + batchSize);

      const promises = batch.map(async (contract) => {
        try {
          const data = await this.getMarketData(contract, true, initialTimeoutMs);
          if (data && data.bid !== undefined && data.ask !== undefined) {
            const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
            results.set(key, data);
          } else {
            failedContracts.push(contract);
          }
        } catch {
          failedContracts.push(contract);
        }
      });

      await Promise.allSettled(promises);

      if (i + batchSize < contracts.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Retry failed contracts once with a longer timeout — TWS often needs
    // extra time to resolve option contracts on first request (contract
    // definition lookup + exchange data subscription).
    if (failedContracts.length > 0 && !signal?.aborted) {
      const retryTimeoutMs = 5000;
      console.log(`Market data batch: ${results.size}/${contracts.length} on first pass, retrying ${failedContracts.length} failed contracts (${retryTimeoutMs}ms timeout)…`);

      // Small pause before retry so TWS can finish resolving contracts
      await new Promise(resolve => setTimeout(resolve, 500));

      let retrySuccess = 0;
      for (let i = 0; i < failedContracts.length; i += batchSize) {
        if (signal?.aborted) break;
        const batch = failedContracts.slice(i, i + batchSize);

        const promises = batch.map(async (contract) => {
          try {
            const data = await this.getMarketData(contract, true, retryTimeoutMs);
            if (data && data.bid !== undefined && data.ask !== undefined) {
              const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
              results.set(key, data);
              retrySuccess++;
            }
          } catch {
            // Give up on this contract
          }
        });

        await Promise.allSettled(promises);

        if (i + batchSize < failedContracts.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      const finalFail = failedContracts.length - retrySuccess;
      if (finalFail > 0) {
        console.log(`Market data batch: ${results.size}/${contracts.length} total (${retrySuccess} recovered on retry, ${finalFail} still failed)`);
      } else {
        console.log(`Market data batch: ${results.size}/${contracts.length} total (all ${retrySuccess} failures recovered on retry)`);
      }
    }

    return results;
  }

  /**
   * Fetch option greeks (delta + theta) for multiple contracts.
   * Uses streaming subscriptions and resolves once all deltas arrive (or timeout).
   * When TWS doesn't provide theta (common for equity options where BID computation
   * sends theta=-2 "not yet computed"), computes it from IV via Black-Scholes.
   */
  async getOptionGreeks(
    contracts: Contract[],
    timeoutMs = 4000
  ): Promise<Map<number, { delta: number; theta: number | null }>> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const results = new Map<number, { delta: number; theta: number | null }>();
    if (contracts.length === 0) return results;

    const contractMap = new Map<number, Contract>();
    const pending = new Set<number>();
    const partials = new Map<number, {
      delta?: number; theta?: number;
      iv?: number; undPrice?: number;
    }>();
    const subscriptions: Subscription[] = [];

    for (const contract of contracts) {
      if (!contract.conId) continue;
      pending.add(contract.conId);
      partials.set(contract.conId, {});
      contractMap.set(contract.conId, contract);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => cleanup(), timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        for (const sub of subscriptions) sub.unsubscribe();
        // Flush partials: use TWS theta when available, else compute from IV
        for (const [conId, p] of partials) {
          if (p.delta != null && !results.has(conId)) {
            let theta = p.theta ?? null;
            if (theta == null && p.iv != null && p.iv > 0 && p.undPrice != null) {
              const c = contractMap.get(conId);
              if (c?.strike && c.lastTradeDateOrContractMonth) {
                const T = daysToExpiry(c.lastTradeDateOrContractMonth) / 365;
                if (T > 0) {
                  theta = bsTheta(p.undPrice, c.strike, T, p.iv, c.right === "P");
                }
              }
            }
            results.set(conId, { delta: p.delta, theta });
          }
        }
        resolve(results);
      };

      for (const contract of contracts) {
        if (!contract.conId) continue;
        const conId = contract.conId;

        const mdContract = contract.secType === SecType.OPT
          ? { ...contract, exchange: "SMART" }
          : contract;

        const genericTick = mdContract.secType === SecType.OPT ? "106" : "13";
        const sub = this.api!
          .getMarketData(mdContract, genericTick, false, false)
          .subscribe({
            next: (update) => {
              const all = update.all;
              if (!all) return;

              const partial = partials.get(conId) ?? {};

              const delta =
                all.get(10041)?.value ??  // MODEL_OPTION_DELTA
                all.get(10047)?.value ??  // DELAYED_MODEL_OPTION_DELTA
                all.get(10005)?.value ??  // BID_OPTION_DELTA
                all.get(10011)?.value;    // DELAYED_BID_OPTION_DELTA

              const theta =
                all.get(10044)?.value ??  // MODEL_OPTION_THETA
                all.get(10050)?.value ??  // DELAYED_MODEL_OPTION_THETA
                all.get(10008)?.value ??  // BID_OPTION_THETA
                all.get(10014)?.value;    // DELAYED_BID_OPTION_THETA

              const iv =
                all.get(10039)?.value ??  // MODEL_OPTION_IV
                all.get(10045)?.value ??  // DELAYED_MODEL_OPTION_IV
                all.get(10003)?.value ??  // BID_OPTION_IV
                all.get(10009)?.value;    // DELAYED_BID_OPTION_IV

              const undPrice = all.get(10002)?.value;  // OPTION_UNDERLYING

              if (delta != null) partial.delta = delta;
              if (theta != null) partial.theta = theta;
              if (iv != null) partial.iv = iv;
              if (undPrice != null) partial.undPrice = undPrice;
              partials.set(conId, partial);

              if (partial.delta != null && partial.theta != null) {
                results.set(conId, { delta: partial.delta, theta: partial.theta });
                pending.delete(conId);
                if (pending.size === 0) cleanup();
              }
            },
            error: () => {
              pending.delete(conId);
              if (pending.size === 0) cleanup();
            },
          });

        subscriptions.push(sub);
      }
    });
  }

  // Get today's executions (trades) with commission reports
  async getExecutions(filter?: Partial<ExecutionFilter>): Promise<{
    executions: ExecutionDetail[];
    commissions: Map<string, CommissionReport>;
  }> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    // Deduplicate concurrent calls — reuse in-flight or recently cached result
    // so parallel API endpoints don't race on the TWS socket.
    const now = Date.now();
    const hasFilter = filter && Object.keys(filter).length > 0;
    // Cache TTL must exceed EXEC_TIMEOUT_MS so that a timed-out empty result
    // is reused by subsequent calls in the same request chain.
    if (!hasFilter && this._executionsInflight && now - this._executionsCacheTs < 30_000) {
      return this._executionsInflight;
    }

    const execFilter: ExecutionFilter = {
      ...filter,
    };

    const EXEC_TIMEOUT_MS = 5000;
    const promise = (async () => {
      try {
        const dataPromise = Promise.all([
          this.api!.getExecutionDetails(execFilter),
          this.api!.getCommissionReport(execFilter),
        ]);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("getExecutions timed out after 5s")), EXEC_TIMEOUT_MS),
        );
        const [executions, commissionReports] = await Promise.race([dataPromise, timeoutPromise]);

        this._executionsTimedOut = false;

        // Map commission reports by execId for easy lookup
        const commissions = new Map<string, CommissionReport>();
        for (const report of commissionReports) {
          if (report.execId) {
            commissions.set(report.execId, report);
          }
        }

        return { executions, commissions };
      } catch (err) {
        console.error("Failed to get executions:", err);
        this._executionsTimedOut = true;
        // Keep the resolved empty result in cache so callers within the same
        // request chain don't trigger a new TWS call that will also time out.
        return { executions: [] as ExecutionDetail[], commissions: new Map<string, CommissionReport>() };
      }
    })();

    if (!hasFilter) {
      this._executionsInflight = promise;
      this._executionsCacheTs = now;
    }

    return promise;
  }

  /**
   * Place a new order with TWS
   * @param contract The contract to trade
   * @param orderParams Order parameters (action, quantity, limit price)
   * @returns Order ID assigned by TWS
   */
  async placeOrder(
    contract: Contract,
    orderParams: {
      action: "BUY" | "SELL";
      quantity: number;
      limitPrice: number;
      orderType?: "LMT" | "MKT";
      tif?: "DAY" | "GTC";
    }
  ): Promise<number> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const order: Order = {
      action: orderParams.action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      totalQuantity: orderParams.quantity,
      orderType: orderParams.orderType === "MKT" ? OrderType.MKT : OrderType.LMT,
      lmtPrice: orderParams.limitPrice,
      tif: orderParams.tif === "GTC" ? TimeInForce.GTC : TimeInForce.DAY,
      transmit: true,
    };

    console.log(`Placing order: ${orderParams.action} ${orderParams.quantity} @ $${orderParams.limitPrice}`);
    console.log(`Contract: ${contract.symbol} ${contract.secType} ${contract.strike} ${contract.right} ${contract.lastTradeDateOrContractMonth}`);

    const orderId = await this.api.placeNewOrder(contract, order);
    console.log(`Order submitted, orderId: ${orderId}`);

    // Wait briefly and check order status to catch immediate rejections
    // TWS sends async error messages for rejected orders
    await this.waitForOrderConfirmation(orderId);

    return orderId;
  }

  /**
   * Wait for order confirmation or rejection from TWS
   * Polls open orders briefly to check if order was accepted or cancelled
   */
  private async waitForOrderConfirmation(orderId: number): Promise<void> {
    const maxWaitMs = 3000;
    const pollIntervalMs = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const orders = await this.getAllOpenOrders();
        const order = orders.find((o) => o.orderId === orderId);

        if (order) {
          const status = order.orderStatus?.status || order.orderState?.status;
          console.log(`Order ${orderId} status: ${status}`);

          if (status === "Cancelled" || status === "Inactive") {
            throw new Error(`Order was ${status.toLowerCase()} by TWS`);
          }

          // Order exists and is not cancelled - consider it confirmed
          if (status === "PreSubmitted" || status === "Submitted" || status === "Filled") {
            console.log(`Order ${orderId} confirmed with status: ${status}`);
            return;
          }
        }
      } catch (err) {
        // If error is our own rejection, rethrow it
        if (err instanceof Error && err.message.includes("Order was")) {
          throw err;
        }
        // Otherwise log and continue polling
        console.debug(`Error checking order status: ${err}`);
      }
    }

    // After timeout, assume order is ok if we didn't see rejection
    console.log(`Order ${orderId} confirmation timeout - assuming submitted`);
  }

  /**
   * Parse expiry from IBKR contract format (YYYYMMDD) to Date
   */
  private parseContractExpiry(expiryStr: string): Date | null {
    if (!expiryStr || expiryStr.length < 8) return null;
    const year = parseInt(expiryStr.slice(0, 4));
    const month = parseInt(expiryStr.slice(4, 6)) - 1;
    const day = parseInt(expiryStr.slice(6, 8));
    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Convert TWS ExecutionDetail objects to ImportedTrade-like objects
   */
  private convertExecutionsToTrades(
    executions: ExecutionDetail[],
    commissions: Map<string, CommissionReport>,
    secTypeFilter?: "OPT" | "STK"
  ): ImportedTrade[] {
    const trades: ImportedTrade[] = [];

    // Group executions by order (same order fills get merged)
    // execId format: "0000e0d5.67576f4f.01.01" - last part is fill number
    const groupedByOrder = new Map<string, ExecutionDetail[]>();

    for (const exec of executions) {
      // Filter by security type if specified
      if (secTypeFilter && exec.contract.secType !== secTypeFilter) continue;
      if (!secTypeFilter && exec.contract.secType !== "OPT" && exec.contract.secType !== "STK") continue;

      const execId = exec.execution.execId || "";
      const orderKey = execId.split(".").slice(0, -1).join(".") || execId;

      if (!groupedByOrder.has(orderKey)) {
        groupedByOrder.set(orderKey, []);
      }
      groupedByOrder.get(orderKey)!.push(exec);
    }

    // Convert grouped executions to trades
    for (const [, orderExecs] of groupedByOrder) {
      if (orderExecs.length === 0) continue;

      const first = orderExecs[0];
      const contract = first.contract;
      const exec = first.execution;
      const isOption = contract.secType === "OPT";

      // Aggregate quantity and calculate average price for partial fills
      let totalShares = 0;
      let totalValue = 0;
      let totalCommission = 0;
      // realizedPNL from commission report: IBKR sets this for closing trades.
      // Opening trades receive the sentinel value ~1.797e308 (Double.MAX_VALUE).
      let totalRealizedPnl: number | null = null;

      for (const e of orderExecs) {
        const shares = e.execution.shares || 0;
        const price = e.execution.price || 0;
        totalShares += shares;
        totalValue += shares * price;
        const execId = e.execution.execId || "";
        const commissionReport = commissions.get(execId);
        totalCommission += commissionReport?.commission || 0;
        // Extract realizedPNL — ignore sentinel value (> 1e15) used for opening trades
        const pnl = commissionReport?.realizedPNL;
        if (pnl != null && Math.abs(pnl) < 1e15) {
          if (totalRealizedPnl === null) totalRealizedPnl = 0;
          totalRealizedPnl += pnl;
        }
      }

      const avgPrice = totalShares > 0 ? totalValue / totalShares : 0;
      const quantity = totalShares;

      // Determine buy/sell
      const side = exec.side || "";
      const isBuy = side === "BOT";

      // Parse execution time (format: "YYYYMMDD HH:MM:SS timezone")
      const execTime = exec.time || "";
      let tradeDate = new Date();
      if (execTime) {
        const match = execTime.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          tradeDate = new Date(
            parseInt(match[1]),
            parseInt(match[2]) - 1,
            parseInt(match[3]),
            parseInt(match[4]),
            parseInt(match[5]),
            parseInt(match[6])
          );
        }
      }

      // Parse expiry from contract (only for options)
      const expiryStr = contract.lastTradeDateOrContractMonth || "";
      const expiry = isOption ? this.parseContractExpiry(expiryStr) : null;

      // Calculate proceeds (positive for selling, negative for buying)
      const multiplier = isOption
        ? (contract.multiplier ? parseInt(String(contract.multiplier)) : 100)
        : 1;
      const proceeds = isBuy
        ? -(quantity * avgPrice * multiplier)
        : (quantity * avgPrice * multiplier);

      // Create synthetic ImportedTrade with tws- prefix
      const syntheticId = `tws-${exec.execId || Date.now()}`;

      const trade: ImportedTrade = {
        id: syntheticId,
        importBatchId: "tws-live",
        tradeId: exec.execId || syntheticId,
        symbol: isOption
          ? (contract.localSymbol || contract.symbol || "")
          : (contract.symbol || ""),
        description: null,
        conId: contract.conId || null,
        secType: contract.secType as string,
        strike: isOption ? (contract.strike || null) : null,
        expiry,
        right: isOption
          ? ((contract.right?.charAt(0).toUpperCase() || null) as "C" | "P" | null)
          : null,
        underlying: isOption ? (contract.symbol || null) : null,
        multiplier,
        tradeDate,
        quantity: isBuy ? quantity : -quantity,
        tradePrice: avgPrice,
        proceeds,
        commission: -Math.abs(totalCommission),
        buySell: isBuy ? "BUY" : "SELL",
        // IBKR uses a large sentinel value for opening trades' realizedPNL;
        // a valid (non-sentinel) value means this is a closing trade.
        openClose: totalRealizedPnl !== null ? "C" : "O",
        costBasis: null,
        realizedPnl: totalRealizedPnl,
        wasAssigned: false,
        assignmentDate: null,
        currency: contract.currency || "USD",
      };

      trades.push(trade);
    }

    return trades;
  }

  /**
   * Fetch today's executions from TWS and convert to ImportedTrade objects
   * @param secTypeFilter Optional filter: "OPT" for options only, "STK" for stocks only
   */
  async getTodayTrades(secTypeFilter?: "OPT" | "STK"): Promise<ImportedTrade[]> {
    if (!this.isConnected()) {
      return [];
    }

    try {
      const { executions, commissions } = await this.getExecutions();
      return this.convertExecutionsToTrades(executions, commissions, secTypeFilter);
    } catch (err) {
      console.error("Failed to fetch today's trades:", err);
      return [];
    }
  }

  /**
   * Modify an existing order
   * @param orderId The order ID to modify
   * @param contract The contract for the order
   * @param orderParams Updated order parameters
   */
  async modifyOrder(
    orderId: number,
    contract: Contract,
    orderParams: {
      action: "BUY" | "SELL";
      quantity: number;
      limitPrice: number;
      tif?: "DAY" | "GTC";
    }
  ): Promise<void> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const order: Order = {
      action: orderParams.action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      totalQuantity: orderParams.quantity,
      orderType: OrderType.LMT,
      lmtPrice: orderParams.limitPrice,
      tif: orderParams.tif === "GTC" ? TimeInForce.GTC : TimeInForce.DAY,
      transmit: true,
    };

    console.log(`Modifying order ${orderId}: ${orderParams.action} ${orderParams.quantity} @ $${orderParams.limitPrice}`);
    this.api.modifyOrder(orderId, contract, order);

    // Wait for confirmation like placeOrder does
    await this.waitForOrderConfirmation(orderId);
  }

  /**
   * Cancel an existing order
   * @param orderId The order ID to cancel
   */
  async cancelOrder(orderId: number): Promise<void> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    console.log(`Cancelling order ${orderId}`);
    this.api.cancelOrder(orderId);

    // Wait briefly for cancellation confirmation
    const maxWaitMs = 3000;
    const pollIntervalMs = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const orders = await this.getAllOpenOrders();
        const order = orders.find((o) => o.orderId === orderId);

        if (!order) {
          console.log(`Order ${orderId} cancelled successfully`);
          return;
        }

        const status = order.orderStatus?.status || order.orderState?.status;
        if (status === "Cancelled" || status === "Inactive") {
          console.log(`Order ${orderId} confirmed cancelled`);
          return;
        }
      } catch (err) {
        console.debug(`Error checking cancel status: ${err}`);
      }
    }

    console.log(`Order ${orderId} cancel confirmation timeout - assuming cancelled`);
  }

  /**
   * Get fundamental data (XML) from IBKR Thomson Reuters feed.
   * Requires market data subscription. Returns raw XML string.
   * @param symbol Stock ticker
   * @param reportType ReportSnapshot | ReportRatios | RESC (analyst estimates)
   */
  async getFundamentalData(symbol: string, reportType: FundamentalReportType): Promise<string> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      currency: "USD",
    };

    try {
      const xml = await this.api.getFundamentalData(contract, reportType);
      return xml;
    } catch (err) {
      const error = err as { code?: number; message?: string };
      if (error.code === 200 || error.message?.includes("No security definition")) {
        return "";
      }
      // Error 430 = no fundamental data available, 10358 = fundamentals not allowed
      if (error.code === 430 || error.code === 10358 || error.message?.includes("No data of type") || error.message?.includes("not allowed")) {
        return "";
      }
      throw err;
    }
  }

  /**
   * Get enhanced market data with generic tick types for extended info.
   * Generic ticks: 104=HV, 106=IV, 236=shortable, 258=fundamental ratios, 456=dividends
   * Additional: 100=call volume/OI, 101=put volume/OI
   */
  async getEnhancedMarketData(
    contract: Contract,
    genericTickList = "104,106,236,258,456"
  ): Promise<EnhancedMarketData | null> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    try {
      const mdContract = contract.secType === SecType.OPT
        ? { ...contract, exchange: "SMART" }
        : contract;

      // Use Observable-based getMarketData with snapshot=true instead of
      // getMarketDataSnapshot — the latter does NOT support generic ticks
      // (TWS error 321). The Observable API supports them and completes
      // after collecting data (up to 11s).
      const update = await lastValueFrom(
        this.api.getMarketData(mdContract, genericTickList, true, false)
      );
      const marketData = update.all;

      if (!marketData || marketData.size === 0) return null;

      // Standard ticks
      const bidTick = marketData.get(1);
      const askTick = marketData.get(2);
      const lastTick = marketData.get(4);
      const closeTick = marketData.get(9);

      // Generic ticks — use TickType enum values
      // 104 → tick type 23 (OPTION_HISTORICAL_VOL)
      const hv = marketData.get(23)?.value;
      // 106 → tick type 24 (OPTION_IMPLIED_VOL)
      const iv = marketData.get(24)?.value;
      // 236 → tick type 46 (SHORTABLE) and type 89 (SHORTABLE_SHARES)
      const shortableIndicator = marketData.get(46)?.value;
      const shortableShares = marketData.get(89)?.value;
      // 258 → tick type 47 (FUNDAMENTAL_RATIOS) — string value
      const fundamentalRatiosTick = marketData.get(47);
      // 456 → tick type 59 (IB_DIVIDENDS) — string value
      const dividendsTick = marketData.get(59);
      // 100/101 → call/put volume and OI
      const callVolume = marketData.get(29)?.value;  // OPTION_CALL_VOLUME
      const putVolume = marketData.get(30)?.value;   // OPTION_PUT_VOLUME
      const callOI = marketData.get(27)?.value;      // OPTION_CALL_OPEN_INTEREST
      const putOI = marketData.get(28)?.value;       // OPTION_PUT_OPEN_INTEREST

      let delta: number | undefined;
      if (contract.secType === SecType.OPT) {
        const modelDelta = marketData.get(10041);
        const delayedModelDelta = marketData.get(10047);
        delta = modelDelta?.value ?? delayedModelDelta?.value;
      }

      return {
        contract,
        bid: bidTick?.value,
        ask: askTick?.value,
        last: lastTick?.value,
        close: closeTick?.value,
        delta,
        historicalVolatility: typeof hv === "number" ? hv : undefined,
        impliedVolatility: typeof iv === "number" ? iv : undefined,
        shortableShares: typeof shortableShares === "number" ? shortableShares : undefined,
        shortableIndicator: typeof shortableIndicator === "number" ? shortableIndicator : undefined,
        fundamentalRatios: typeof fundamentalRatiosTick?.value === "string" ? fundamentalRatiosTick.value : undefined,
        ibDividends: typeof dividendsTick?.value === "string" ? dividendsTick.value : undefined,
        callVolume: typeof callVolume === "number" ? callVolume : undefined,
        putVolume: typeof putVolume === "number" ? putVolume : undefined,
        callOpenInterest: typeof callOI === "number" ? callOI : undefined,
        putOpenInterest: typeof putOI === "number" ? putOI : undefined,
      };
    } catch (err) {
      const error = err as { code?: number; message?: string };

      // If fundamentals tick (258) caused the error, retry without it
      // so we still get volatility, option activity, and shortable data
      if (
        (error.code === 10358 || error.message?.includes("not allowed")) &&
        genericTickList.includes("258")
      ) {
        const ticksWithoutFundamentals = genericTickList
          .split(",")
          .filter((t) => t.trim() !== "258")
          .join(",");
        console.log(`Retrying enhanced market data for ${contract.symbol} without tick 258 (fundamentals not allowed)`);
        return this.getEnhancedMarketData(contract, ticksWithoutFundamentals);
      }

      if (
        error.code === 10091 ||  // Subscription required
        error.code === 200 ||    // No security definition
        error.code === 321 ||    // Snapshot not applicable to generic ticks
        error.message?.includes("additional subscription") ||
        error.message?.includes("No security definition") ||
        error.message?.includes("not applicable to generic ticks")
      ) {
        return null;
      }
      console.error(`Failed to get enhanced market data for ${contract.symbol}:`, err);
      return null;
    }
  }

  /**
   * Search for symbols matching a pattern.
   * Returns matching contract descriptions.
   */
  async searchSymbols(pattern: string): Promise<ContractDescription[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    try {
      const results = await this.api.getMatchingSymbols(pattern);
      return results;
    } catch (err) {
      console.error(`Failed to search symbols for "${pattern}":`, err);
      return [];
    }
  }

  /**
   * Get contract details including sector/industry classification.
   * Returns full ContractDetails array for the given symbol.
   */
  async getContractInfo(symbol: string, secType: SecType = SecType.STK): Promise<ContractDetails[]> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const contract: Contract = {
      symbol,
      secType,
      exchange: "SMART",
      currency: "USD",
    };

    try {
      return await this.api.getContractDetails(contract);
    } catch (err) {
      const error = err as { code?: number; message?: string };
      if (error.code === 200 || error.message?.includes("No security definition")) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Resolve conIds for option contracts at a given expiration.
   * getOptionChain builds contracts from getSecDefOptParams which doesn't include
   * conIds — this lookup is needed before placing combo orders.
   * Returns a map keyed by "${strike}:${right}" (e.g. "62:C").
   */
  async resolveOptionConIds(
    symbol: string,
    expiration: string,
    tradingClass: string,
    multiplier: number,
  ): Promise<Map<string, number>> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }
    const conIdMap = new Map<string, number>();
    try {
      const detailsPromise = this.api.getContractDetails({
        symbol,
        secType: SecType.OPT,
        exchange: "SMART",
        currency: "USD",
        lastTradeDateOrContractMonth: expiration,
        tradingClass,
        multiplier,
      });
      const details = await Promise.race([
        detailsPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`resolveOptionConIds timed out for ${symbol} ${expiration}`)), 10_000),
        ),
      ]);
      for (const d of details) {
        const c = d.contract;
        if (c.conId && c.strike != null && c.right) {
          const rightKey = c.right === OptionType.Put ? "P" : "C";
          conIdMap.set(`${c.strike}:${rightKey}`, c.conId);
        }
      }
    } catch (err) {
      console.error(`[resolveOptionConIds] ${symbol} ${expiration}:`, err);
    }
    return conIdMap;
  }

  /**
   * Run a TWS market scanner to discover symbols matching criteria.
   * Uses the IBKR scanner subscription API to find stocks by various metrics
   * (most active, high option volume, top gainers, etc.)
   */
  async runMarketScanner(params: MarketScannerParams): Promise<ScannerResult[]> {
    if (!this.isConnected()) {
      throw new Error("Not connected to TWS");
    }

    // Resolve scanCode string to the numeric ScanCode enum.
    // ScanCode is a numeric enum where keys are the string names (e.g., HOT_BY_OPT_VOLUME = 40).
    const scanCodeValue = ScanCode[params.scanCode as keyof typeof ScanCode];
    if (scanCodeValue === undefined) {
      throw new Error(
        `Invalid scanCode "${params.scanCode}". Valid values include: ${Object.keys(ScanCode).filter((k) => isNaN(Number(k))).join(", ")}`
      );
    }

    // Instrument and LocationCode are string enums - cast directly
    const instrumentValue = (params.instrument ?? "STK") as unknown as Instrument;
    const locationValue = (params.locationCode ?? "STK.US.MAJOR") as unknown as LocationCode;

    const subscription: ScannerSubscription = {
      scanCode: scanCodeValue,
      instrument: instrumentValue,
      locationCode: locationValue,
      numberOfRows: params.numberOfRows ?? 50,
      abovePrice: params.abovePrice,
      belowPrice: params.belowPrice,
      aboveVolume: params.aboveVolume,
      marketCapAbove: params.marketCapAbove,
      marketCapBelow: params.marketCapBelow,
      averageOptionVolumeAbove: params.averageOptionVolumeAbove,
      stockTypeFilter: params.stockTypeFilter,
    };

    return new Promise<ScannerResult[]>((resolve, reject) => {
      let results: ScannerResult[] = [];
      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout>;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        sub.unsubscribe();
        resolve(results);
      };

      const sub = this.api!.getMarketScanner(subscription).subscribe({
        next: (update) => {
          const rows = update.all;
          if (!rows || rows.size === 0) return;

          results = [];
          rows.forEach((item) => {
            const details = item.contract;
            const contract = details.contract;
            results.push({
              rank: item.rank,
              symbol: contract.symbol ?? "",
              conId: contract.conId ?? 0,
              exchange: contract.primaryExch ?? contract.exchange ?? "",
              secType: typeof contract.secType === "string"
                ? contract.secType
                : String(contract.secType ?? ""),
              longName: details.longName,
              industry: details.industry,
              category: details.category,
              subcategory: details.subcategory,
            });
          });

          // Scanner emits updates; resolve after first complete emission
          finish();
        },
        error: (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            sub.unsubscribe();
            // TWS error 165 = "no items retrieved" — normal empty result, not a failure
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("no items retrieved")) {
              resolve([]);
            } else if (errMsg.toLowerCase().includes("not allowed")) {
              reject(new BadRequestError(
                `Scan code "${params.scanCode}" is not available with your current TWS market data subscriptions. ` +
                `Check your IBKR account subscriptions in Account Management.`
              ));
            } else {
              reject(err);
            }
          }
        },
        complete: finish,
      });

      // 30-second timeout safety net
      timeoutId = setTimeout(() => {
        if (!resolved) {
          console.warn("Market scanner timed out after 30s");
          finish();
        }
      }, 30_000);
    });
  }

  subscribeMarketData(
    contract: Contract,
    onUpdate: (data: StreamTickData) => void,
    onError?: (error: Error) => void,
  ): () => void {
    if (!this.api) throw new Error("Not connected to TWS");

    const mdContract =
      contract.secType === SecType.OPT
        ? { ...contract, exchange: "SMART" }
        : contract;

    const subscription = this.api
      .getMarketData(mdContract, "", false, false)
      .subscribe({
        next: (update) => {
          const data: StreamTickData = {};

          const all = update.all;
          if (!all) return;

          // Standard ticks (same tick types as existing getMarketData)
          if (all.has(1)) data.bid = all.get(1)!.value;
          else if (all.has(66)) data.bid = all.get(66)!.value;
          if (all.has(2)) data.ask = all.get(2)!.value;
          else if (all.has(67)) data.ask = all.get(67)!.value;
          if (all.has(4)) data.last = all.get(4)!.value;
          else if (all.has(68)) data.last = all.get(68)!.value;

          // Option greeks
          if (contract.secType === SecType.OPT) {
            const deltaVal =
              all.get(10041)?.value ??
              all.get(10047)?.value ??
              all.get(10005)?.value;
            if (deltaVal !== undefined) data.delta = deltaVal;

            const ivVal =
              all.get(10039)?.value ?? // MODEL_OPTION_IV
              all.get(10045)?.value ?? // DELAYED_MODEL_OPTION_IV
              all.get(24)?.value;      // OPTION_IMPLIED_VOL
            if (ivVal !== undefined) data.impliedVolatility = ivVal;
          }

          onUpdate(data);
        },
        error: (err) => {
          if (onError) onError(err);
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.cleanup();
  }
}

// Singleton instance
export const ibkrService = new IBKRService();
