import { useConnectionStatus } from "@/hooks/useConnectionStatus";

function formatUptime(isoTime: string | null): string {
  if (!isoTime) return "Unknown";
  const diff = Date.now() - new Date(isoTime).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

type ConnectionStatusData = ReturnType<typeof useConnectionStatus>;

interface ConnectionStatusPopupProps {
  status: ConnectionStatusData["status"];
  sseError: ConnectionStatusData["sseError"];
}

export function ConnectionStatusPopup({
  status,
  sseError,
}: ConnectionStatusPopupProps) {
  const isConnected = status.connected;

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 w-64 rounded-lg border bg-background p-3 shadow-lg">
      {isConnected ? (
        <>
          <h4 className="text-sm font-medium mb-2">Connected to TWS</h4>
          <dl className="text-xs space-y-1.5">
            {status.account && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-medium">{status.account}</dd>
              </div>
            )}
            {status.serverVersion && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Server</dt>
                <dd className="font-medium">v{status.serverVersion}</dd>
              </div>
            )}
            {status.serverConnectionTime && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Uptime</dt>
                <dd className="font-medium">
                  {formatUptime(status.serverConnectionTime)}
                </dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <>
          <h4 className="text-sm font-medium mb-1.5">Disconnected</h4>
          <p className="text-xs text-muted-foreground break-words">
            {sseError || status.error}
          </p>
          {!sseError && (
            <ul className="mt-2 pt-2 border-t text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Check TWS is running</li>
              <li>Enable API in TWS settings</li>
              <li>Port: 7497 (paper) / 7496 (live)</li>
              <li>Add trusted IP in TWS</li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
