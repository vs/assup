import { useState, useEffect } from "react";
import { useSSEConnection } from "./useSSE";

export interface ConnectionStatus {
  connected: boolean;
  account: string | null;
  serverVersion: number | null;
  serverConnectionTime: string | null;
  error: string | null;
}

const initialStatus: ConnectionStatus = {
  connected: false,
  account: null,
  serverVersion: null,
  serverConnectionTime: null,
  error: null,
};

// Import the singleton manager for adding listeners
import { sseManager } from "./useSSE";

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const { connected: sseConnected } = useSSEConnection();

  useEffect(() => {
    // Listen for connection status updates via the singleton SSE manager
    const removeListener = sseManager.addListener("connection", (data) => {
      setStatus(data as ConnectionStatus);
    });

    return () => {
      removeListener();
    };
  }, []);

  return {
    status,
    sseError: sseConnected ? null : "Lost connection to server. Reconnecting...",
  };
}
