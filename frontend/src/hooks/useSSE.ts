import { useEffect, useRef, useState } from "react";

export type SSEEventType = "position" | "order" | "allocation" | "connection" | "connected";

export interface SSEMessage {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Singleton SSE connection manager
class SSEManager {
  private eventSource: EventSource | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private listeners: Map<SSEEventType, Set<(data: unknown) => void>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private _connected = false;
  private _clientId: string | null = null;
  private reconnectInterval = 5000;
  private subscriberCount = 0;

  get connected() {
    return this._connected;
  }

  get clientId() {
    return this._clientId;
  }

  subscribe() {
    this.subscriberCount++;
    if (this.subscriberCount === 1) {
      this.connect();
    }
    return () => {
      this.subscriberCount--;
      if (this.subscriberCount === 0) {
        this.disconnect();
      }
    };
  }

  private connect() {
    if (this.eventSource) {
      return; // Already connected
    }

    try {
      const eventSource = new EventSource(`${API_BASE}/api/updates/stream`);
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

        // Auto-reconnect if we still have subscribers
        if (this.subscriberCount > 0) {
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

// Global singleton instance
const sseManager = new SSEManager();

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

    // Sync initial state
    setConnected(sseManager.connected);
    setClientId(sseManager.clientId);

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
  callbackRef.current = onUpdate;

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
  callbackRef.current = onUpdate;

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

// Hook that triggers a callback when order changes are broadcast
export function useOrderUpdates(onUpdate: () => void) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("order", () => {
      callbackRef.current();
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);
}
