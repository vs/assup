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
} from "@stoqey/ib";
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
          if (err.code && err.code < 2000) {
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
      const chain: OptionChainEntry[] = [];

      for (const secDef of secDefs) {
        if (!secDef.expirations || !secDef.strikes) continue;

        for (const expiration of secDef.expirations) {
          for (const strike of secDef.strikes) {
            const callContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: secDef.exchange || "SMART",
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Call,
            };

            const putContract: Contract = {
              symbol,
              secType: SecType.OPT,
              exchange: secDef.exchange || "SMART",
              currency: "USD",
              lastTradeDateOrContractMonth: expiration,
              strike,
              right: OptionType.Put,
            };

            chain.push({
              strike,
              expiration,
              call: callContract,
              put: putContract,
            });
          }
        }
      }

      return chain;
    } catch (err) {
      console.error(`Failed to get option chain for ${symbol}:`, err);
      return [];
    }
  }

  // Get market data for a contract (bid, ask, last)
  async getMarketData(contract: Contract): Promise<TickerData | null> {
    if (!this.api || !this.api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    try {
      // For options, first resolve the contract to get complete details including conId
      let resolvedContract = contract;
      if (contract.secType === SecType.OPT) {
        const contractDetails = await this.api.getContractDetails(contract);
        if (!contractDetails || contractDetails.length === 0) {
          console.warn(`No contract details found for ${contract.symbol} ${contract.strike} ${contract.right}`);
          return null;
        }
        resolvedContract = contractDetails[0].contract;
      }

      const marketData = await this.api.getMarketDataSnapshot(resolvedContract, "", false);

      if (!marketData) {
        return null;
      }

      // Extract bid, ask, last, close from the market data map
      // TickType values: BID=1, ASK=2, LAST=4, CLOSE=9
      const bidTick = marketData.get(1); // BID
      const askTick = marketData.get(2); // ASK
      const lastTick = marketData.get(4); // LAST
      const closeTick = marketData.get(9); // CLOSE

      return {
        contract: resolvedContract,
        bid: bidTick?.value,
        ask: askTick?.value,
        last: lastTick?.value,
        close: closeTick?.value,
      };
    } catch (err) {
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

    // Process in smaller batches to avoid overwhelming TWS
    // Reduced batch size since we now make 2 API calls per option (getContractDetails + getMarketDataSnapshot)
    const batchSize = 10;
    for (let i = 0; i < contracts.length; i += batchSize) {
      const batch = contracts.slice(i, i + batchSize);
      const promises = batch.map(async (contract) => {
        try {
          const data = await this.getMarketData(contract);
          if (data && data.bid !== undefined && data.ask !== undefined) {
            const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
            results.set(key, data);
          }
        } catch (err) {
          // Silently skip contracts that fail - just log at debug level
          console.debug(`Skipped contract ${contract.symbol} ${contract.strike} ${contract.right}:`, err);
        }
      });

      await Promise.allSettled(promises);

      // Add small delay between batches to respect rate limits
      if (i + batchSize < contracts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
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
