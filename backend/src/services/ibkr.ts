import {
  IBApiNext,
  ConnectionState,
  AccountSummaryTagValues,
  Position as IBPosition,
  OpenOrder,
  Bar,
  Contract,
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
import type { ImportedTrade } from "@prisma/client";
import { Subscription } from "rxjs";

export interface ConnectionStatus {
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

export interface HistoricalDataParams {
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

export interface TickerData {
  contract: Contract;
  bid?: number;
  ask?: number;
  last?: number;
  close?: number;
  delta?: number;
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
  private isConnecting = false;

  // Account data
  private accountSummary: Map<string, AccountSummaryTagValues> = new Map();
  private accountSubscription: Subscription | null = null;
  private connectionSubscription: Subscription | null = null;

  constructor() {
    this.connect();
  }

  private connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const host = process.env.IB_HOST || "127.0.0.1";
    const port = parseInt(process.env.IB_PORT || "7497", 10);

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

      // Subscribe to errors
      this.api.error.subscribe({
        next: (err) => {
          // Only log non-fatal errors, don't disconnect
          // Skip error 200 (no security definition) and 10091 (additional subscription required)
          // as these are expected during options scanning and handled gracefully
          const code = Number(err.code);
          if (code && code < 2000 && code !== 200 && code !== 10091) {
            console.error(`TWS Error ${err.code}: ${err.error?.message}`);
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
    for (const listener of this.statusListeners) {
      listener(this.connectionStatus);
    }
  }

  private cleanup() {
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
    return { ...this.connectionStatus };
  }

  subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.connectionStatus);

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
      // Get contract details which includes option chain info
      const details = await this.api.getContractDetails(underlyingContract);

      if (!details || details.length === 0) {
        return [];
      }

      // Get security definitions for options
      const secDefs = await this.api.getSecDefOptParams(
        symbol,
        "",
        SecType.STK,
        details[0].contract.conId!
      );

      if (!secDefs || secDefs.length === 0) {
        return [];
      }

      // Build options chain from security definitions
      // Note: secDefs contains one entry per exchange, so we deduplicate by strike+expiration
      const chainMap = new Map<string, OptionChainEntry>();

      for (const secDef of secDefs) {
        if (!secDef.expirations || !secDef.strikes) continue;

        for (const expiration of secDef.expirations) {
          for (const strike of secDef.strikes) {
            const key = `${expiration}_${strike}`;

            // Skip if we already have this strike+expiration (from another exchange)
            if (chainMap.has(key)) continue;

            const callContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: "SMART", // Use SMART for best routing
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Call,
              multiplier: 100,
            };

            const putContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: "SMART", // Use SMART for best routing
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Put,
              multiplier: 100,
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

  // Get market data for a contract (bid, ask, last)
  async getMarketData(contract: Contract): Promise<TickerData | null> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    try {
      // For options, use SMART routing for market data (per TWS API documentation)
      // This works better than specific exchanges which may be outdated (e.g., AMEX -> NYSE American)
      const mdContract = contract.secType === SecType.OPT
        ? { ...contract, exchange: "SMART" }
        : contract;

      // Request only delayed data (generic tick list empty means delayed for users without real-time subscription)
      const marketData = await this.api.getMarketDataSnapshot(mdContract, "", false);

      if (!marketData) {
        return null;
      }

      // Extract bid, ask, last, close from the market data map
      // TickType values: BID=1, ASK=2, LAST=4, CLOSE=9
      const bidTick = marketData.get(1); // BID
      const askTick = marketData.get(2); // ASK
      const lastTick = marketData.get(4); // LAST
      const closeTick = marketData.get(9); // CLOSE

      // Extract delta for options (IBApiNext tick types)
      // MODEL_OPTION_DELTA=10041, DELAYED_MODEL_OPTION_DELTA=10047
      // BID_OPTION_DELTA=10005, DELAYED_BID_OPTION_DELTA=10011
      let delta: number | undefined;
      if (contract.secType === SecType.OPT) {
        const modelDelta = marketData.get(10041); // MODEL_OPTION_DELTA
        const delayedModelDelta = marketData.get(10047); // DELAYED_MODEL_OPTION_DELTA
        const bidDelta = marketData.get(10005); // BID_OPTION_DELTA
        const delayedBidDelta = marketData.get(10011); // DELAYED_BID_OPTION_DELTA
        delta = modelDelta?.value ?? delayedModelDelta?.value ?? bidDelta?.value ?? delayedBidDelta?.value;
      }

      return {
        contract,
        bid: bidTick?.value,
        ask: askTick?.value,
        last: lastTick?.value,
        close: closeTick?.value,
        delta,
      };
    } catch (err) {
      // Check if it's a subscription error or no security definition error
      const error = err as { code?: number; message?: string };

      if (
        error.code === 10091 || // Subscription required
        error.code === 200 ||    // No security definition found
        error.message?.includes("additional subscription") ||
        error.message?.includes("No security definition")
      ) {
        // Silently skip - these are expected for options without proper subscriptions or invalid contracts
        return null;
      }
      console.error(`Failed to get market data for ${contract.symbol}:`, err);
      return null;
    }
  }

  // Get market data for multiple contracts in parallel
  async getMarketDataBatch(contracts: Contract[]): Promise<Map<string, TickerData>> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const results = new Map<string, TickerData>();
    let successCount = 0;
    let failCount = 0;
    let firstFailure: { contract: Contract; reason: string } | undefined;

    // Process in batches to avoid overwhelming TWS
    // Larger batch size and shorter delay for faster scanning
    const batchSize = 50;
    for (let i = 0; i < contracts.length; i += batchSize) {
      const batch = contracts.slice(i, i + batchSize);
      const promises = batch.map(async (contract) => {
        try {
          const data = await this.getMarketData(contract);
          if (data && data.bid !== undefined && data.ask !== undefined) {
            const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
            results.set(key, data);
            successCount++;
          } else {
            failCount++;
            if (!firstFailure) {
              firstFailure = {
                contract,
                reason: data ? 'missing bid/ask' : 'no data returned (likely error 200/10091)'
              };
            }
          }
        } catch (err) {
          failCount++;
          if (!firstFailure) {
            firstFailure = {
              contract,
              reason: err instanceof Error ? err.message : String(err)
            };
          }
          // Silently skip contracts that fail - just log at debug level
          console.debug(`Skipped contract ${contract.symbol} ${contract.strike} ${contract.right}:`, err);
        }
      });

      await Promise.allSettled(promises);

      // Add small delay between batches to respect rate limits
      if (i + batchSize < contracts.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Log summary
    if (contracts.length > 0) {
      console.log(`Market data batch: ${successCount} succeeded, ${failCount} failed out of ${contracts.length} total`);
      if (firstFailure && failCount > 0) {
        console.log(`First failure example: ${firstFailure.contract.symbol} $${firstFailure.contract.strike} ${firstFailure.contract.lastTradeDateOrContractMonth} - ${firstFailure.reason}`);
      }
    }

    return results;
  }

  // Get today's executions (trades) with commission reports
  async getExecutions(filter?: Partial<ExecutionFilter>): Promise<{
    executions: ExecutionDetail[];
    commissions: Map<string, CommissionReport>;
  }> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const execFilter: ExecutionFilter = {
      ...filter,
    };

    try {
      const [executions, commissionReports] = await Promise.all([
        this.api.getExecutionDetails(execFilter),
        this.api.getCommissionReport(execFilter),
      ]);

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
      return { executions: [], commissions: new Map() };
    }
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

      for (const e of orderExecs) {
        const shares = e.execution.shares || 0;
        const price = e.execution.price || 0;
        totalShares += shares;
        totalValue += shares * price;
        const execId = e.execution.execId || "";
        const commissionReport = commissions.get(execId);
        totalCommission += commissionReport?.commission || 0;
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
        commission: totalCommission,
        buySell: isBuy ? "BUY" : "SELL",
        openClose: null,
        costBasis: null,
        realizedPnl: null,
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

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.cleanup();
  }
}

// Singleton instance
export const ibkrService = new IBKRService();
