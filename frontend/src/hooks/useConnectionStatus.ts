import { useState, useEffect, useCallback } from "react";

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

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus);
  const [sseError, setSseError] = useState<string | null>(null);

  const connect = useCallback(() => {
    const eventSource = new EventSource("/api/connection/status");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ConnectionStatus;
        setStatus(data);
        setSseError(null);
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = () => {
      setSseError("Lost connection to server. Reconnecting...");
      eventSource.close();
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    return eventSource;
  }, []);

  useEffect(() => {
    const eventSource = connect();
    return () => {
      eventSource.close();
    };
  }, [connect]);

  return { status, sseError };
}
