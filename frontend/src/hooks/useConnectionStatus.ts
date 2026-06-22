import { useState, useEffect } from "react";
import { useSSEConnection } from "./useSSE";

interface ConnectionStatus {
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

  // If SSE is disconnected, override status to show disconnected
  // (the last SSE event may have reported "connected" before the backend went down)
  const effectiveStatus = sseConnected ? status : { ...status, connected: false };

  return {
    status: effectiveStatus,
    sseError: sseConnected ? null : "Lost connection to server. Reconnecting...",
  };
}
