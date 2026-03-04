import { useState } from "react";
import { Link } from "react-router-dom";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { X, User, Settings } from "lucide-react";

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

export function ConnectionStatus() {
  const { status, sseError } = useConnectionStatus();
  const [isPinned, setIsPinned] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const isConnected = status.connected;
  const showDetails = isPinned || isHovering;

  return (
    <div
      className={`relative rounded-lg border bg-muted/30 shadow-sm ${showDetails ? "rounded-b-none border-b-transparent z-50" : ""}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Top row: status indicator, account, settings icon */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => setIsPinned(!isPinned)}
          className={`h-2.5 w-2.5 rounded-full transition-all hover:ring-2 hover:ring-offset-2 hover:ring-offset-background ${
            isConnected
              ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] hover:ring-green-500/50 animate-breathing"
              : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] hover:ring-red-500/50"
          }`}
          title={isConnected ? "Connected to TWS" : "Disconnected from TWS"}
        />

        {status.account && (
          <div className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{status.account}</span>
          </div>
        )}

        <Link
          to="/settings"
          className="ml-auto p-1 rounded hover:bg-muted transition-colors"
          title="Settings"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Expanded details — absolutely positioned below to avoid layout shift */}
      {showDetails && (
        <div className="absolute top-full right-0 w-72 border border-t bg-muted/30 backdrop-blur rounded-b-lg shadow-lg px-3 py-3 z-50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              {isConnected ? (
                <>
                  <h4 className="font-medium text-card-foreground mb-3">
                    Connected to TWS
                  </h4>
                  <dl className="text-sm space-y-2">
                    {status.account && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Account</dt>
                        <dd className="font-medium">{status.account}</dd>
                      </div>
                    )}
                    {status.serverVersion && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Server Version</dt>
                        <dd className="font-medium">{status.serverVersion}</dd>
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
                  <h4 className="font-medium text-card-foreground mb-2">
                    Connection Issue
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {sseError || status.error}
                  </p>

                  {!sseError && (
                    <div className="mt-3 pt-3 border-t">
                      <h5 className="text-sm font-medium text-card-foreground mb-2">
                        Troubleshooting steps:
                      </h5>
                      <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                        <li>Ensure TWS or IB Gateway is running</li>
                        <li>Check API is enabled in TWS settings</li>
                        <li>Verify port 7497 (paper) or 7496 (live)</li>
                        <li>Add trusted IP in TWS API settings</li>
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
            {isPinned && (
              <button
                onClick={() => setIsPinned(false)}
                className="p-1 rounded hover:bg-muted transition-colors shrink-0"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
