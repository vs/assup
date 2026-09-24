import { useEffect, useRef, useState } from "react";
import { getApiBase } from "@/lib/apiConfig";

type SSEEventType = "position" | "order" | "allocation" | "connection" | "connected" | "scanner_job" | "wheel_scanner" | "research_job" | "wheel_strategy" | "macro" | "quote" | "roll_progress";

// Singleton SSE connection manager
// Pauses when tab is hidden to avoid exhausting Chrome's 6-connection-per-origin
// limit on HTTP/1.1 (each EventSource holds an open connection).
class SSEManager {
  private eventSource: EventSource | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<SSEEventType, Set<(data: unknown) => void>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private _connected = false;
  private _clientId: string | null = null;
  private reconnectInterval = 5000;
  private subscriberCount = 0;
  private visibilityBound = false;
  // Cache last "connection" event so late listeners get the current IBKR status
  private _lastConnectionData: unknown = null;

  get connected() {
    return this._connected;
  }

  get clientId() {
    return this._clientId;
  }

  subscribe() {
    this.subscriberCount++;
    if (this.subscriberCount === 1) {
      this.bindVisibility();
      if (!document.hidden) {
        this.connect();
      }
    }
    return () => {
      this.subscriberCount--;
      if (this.subscriberCount === 0) {
        this.unbindVisibility();
        this.disconnect();
      }
    };
  }

  private bindVisibility() {
    if (this.visibilityBound) return;
    this.visibilityBound = true;
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  private unbindVisibility() {
    this.visibilityBound = false;
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private handleVisibility = () => {
    if (document.hidden) {
      // Tab hidden — release the connection so other tabs/requests can use it
      this.disconnect();
    } else if (this.subscriberCount > 0) {
      // Tab visible again — reconnect
      this.connect();
    }
  };

  private connect() {
    if (this.eventSource) {
      return; // Already connected
    }

    try {
      const eventSource = new EventSource(`${getApiBase()}/api/updates/stream`);
      this.eventSource = eventSource;

      eventSource.onopen = () => {
        console.log("SSE connected");
        this._connected = true;
        this.notifyConnectionListeners();
      };

      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle initial connection message
          if (message.type === "connected") {
            this._clientId = message.clientId;
            return;
          }

          // Cache connection status for late listeners
          if (message.type === "connection") {
            this._lastConnectionData = message.data;
          }

          // Notify listeners for this event type
          const listeners = this.listeners.get(message.type);
          if (listeners) {
            listeners.forEach((listener) => listener(message.data));
          }
        } catch (err) {
          console.error("Failed to parse SSE message:", err);
        }
      };

      eventSource.onerror = () => {
        console.error("SSE connection error");
        this._connected = false;
        this.notifyConnectionListeners();
        this.cleanup();

        // Auto-reconnect if we still have subscribers and tab is visible
        if (this.subscriberCount > 0 && !document.hidden) {
          this.reconnectTimeout = setTimeout(() => {
            console.log("SSE reconnecting...");
            this.connect();
          }, this.reconnectInterval);
        }
      };
    } catch (err) {
      console.error("Failed to create EventSource:", err);
      this._connected = false;
      this.notifyConnectionListeners();
    }
  }

  private cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.cleanup();
    this._connected = false;
    this._clientId = null;
    this.notifyConnectionListeners();
  }

  addListener(type: SSEEventType, callback: (data: unknown) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);

    // Replay last cached connection status for new listeners
    if (type === "connection" && this._lastConnectionData !== null) {
      callback(this._lastConnectionData);
    }

    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  addConnectionListener(callback: (connected: boolean) => void) {
    this.connectionListeners.add(callback);
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  private notifyConnectionListeners() {
    this.connectionListeners.forEach((listener) => listener(this._connected));
  }

  forceReconnect() {
    this.cleanup();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.subscriberCount > 0) {
      this.connect();
    }
  }
}

// Global singleton instance - exported for direct use by other hooks
export const sseManager = new SSEManager();

// Hook to use the SSE connection status
export function useSSEConnection() {
  const [connected, setConnected] = useState(sseManager.connected);
  const [clientId, setClientId] = useState(sseManager.clientId);

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const unsubscribeConnection = sseManager.addConnectionListener((isConnected) => {
      setConnected(isConnected);
      setClientId(sseManager.clientId);
    });

    return () => {
      unsubscribe();
      unsubscribeConnection();
    };
  }, []);

  return {
    connected,
    clientId,
    reconnect: () => sseManager.forceReconnect(),
  };
}

// Hook that triggers a callback when allocation changes are broadcast
export function useAllocationUpdates(onUpdate: () => void) {
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  });

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("allocation", () => {
      callbackRef.current();
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);
}

// Hook that triggers a callback when position changes are broadcast
export function usePositionUpdates(onUpdate: () => void) {
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  });

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("position", () => {
      callbackRef.current();
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);
}

// Hook that receives live macro data updates
export function useMacroUpdates(onUpdate: (data: unknown) => void) {
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  });

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("macro", (data) => {
      callbackRef.current(data);
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);
}

// Hook that receives the wheel live-data refresh ("wheel_strategy" event),
// broadcast after the backend finishes the background IBKR fan-out.
export function useWheelUpdates(onUpdate: (data: unknown) => void) {
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  });

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("wheel_strategy", (data) => {
      callbackRef.current(data);
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);
}

