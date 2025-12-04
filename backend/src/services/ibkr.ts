import { Client } from "ib-tws-api";

export interface ConnectionStatus {
  connected: boolean;
  account: string | null;
  serverVersion: number | null;
  serverConnectionTime: string | null;
  error: string | null;
}

class IBKRService {
  private client: Client | null = null;
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
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.connect();
  }

  private async connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const host = process.env.IB_HOST || "127.0.0.1";
    const port = parseInt(process.env.IB_PORT || "7497", 10);

    console.log(`Connecting to TWS at ${host}:${port}...`);

    // Clean up previous client if any
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    try {
      this.client = new Client({
        host,
        port,
        clientId: 1,
      });

      await this.client.connect();
      this.handleConnected();
      this.startHealthCheck();
    } catch (err) {
      console.error("Failed to connect to TWS:", err);
      this.client = null;
      this.handleError(err);
    } finally {
      this.isConnecting = false;
    }
  }

  private handleConnected() {
    if (!this.client) return;

    this.updateStatus({
      connected: true,
      account: null,
      serverVersion: this.client.serverVersion,
      serverConnectionTime: new Date().toISOString(),
      error: null,
    });

    console.log(
      `Connected to TWS. Server version: ${this.client.serverVersion}`
    );
  }

  private startHealthCheck() {
    // Stop any existing health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Check connection health periodically
    this.healthCheckInterval = setInterval(async () => {
      if (!this.client) {
        this.handleDisconnected();
        return;
      }

      try {
        // Try to get current time from TWS to verify connection
        await this.client.getCurrentTime();
      } catch (err) {
        console.error("Health check failed:", err);
        this.handleDisconnected();
      }
    }, 10000); // Check every 10 seconds
  }

  private handleDisconnected() {
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.updateStatus({
      connected: false,
      account: null,
      serverVersion: null,
      serverConnectionTime: null,
      error: "Disconnected from TWS",
    });

    // Schedule reconnection
    this.scheduleReconnect();
  }

  private handleError(err: unknown) {
    let message = "";
    let code: string | null = null;

    if (err instanceof Error) {
      message = err.message;
      // Handle Node.js system errors which have a 'code' property
      if ("code" in err && typeof err.code === "string") {
        code = err.code;
      }
    } else {
      message = String(err);
    }

    // Use code if message is empty (common with AggregateError)
    const errorText = message || code || "Unknown error";

    this.updateStatus({
      connected: false,
      account: null,
      serverVersion: null,
      serverConnectionTime: null,
      error: this.getErrorHelp(code, errorText),
    });

    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      console.log("Attempting to reconnect to TWS...");
      this.connect();
    }, 5000);
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

    // For any unrecognized error, provide a generic helpful message
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

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  subscribe(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    // Immediately send current status
    listener(this.connectionStatus);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getClient(): Client | null {
    return this.client;
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}

// Singleton instance
export const ibkrService = new IBKRService();
