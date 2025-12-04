import { useState } from "react";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Info, X } from "lucide-react";

export function ConnectionStatus() {
  const { status, sseError } = useConnectionStatus();
  const [showHelp, setShowHelp] = useState(false);

  const isConnected = status.connected;
  const hasError = status.error || sseError;

  return (
    <div className="flex items-center gap-3">
      {/* Account display */}
      {status.account && (
        <span className="text-sm text-muted-foreground">
          {status.account}
        </span>
      )}

      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`h-2.5 w-2.5 rounded-full ${
            isConnected
              ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
              : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
          }`}
          title={isConnected ? "Connected to TWS" : "Disconnected from TWS"}
        />

        {/* Info button when there's an error */}
        {hasError && (
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Connection help"
          >
            <Info className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Help popup */}
      {showHelp && hasError && (
        <div className="absolute right-4 top-16 z-50 w-80 rounded-lg border bg-card p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="font-medium text-card-foreground mb-2">
                Connection Issue
              </h4>
              <p className="text-sm text-muted-foreground">
                {sseError || status.error}
              </p>
            </div>
            <button
              onClick={() => setShowHelp(false)}
              className="p-1 rounded hover:bg-muted transition-colors shrink-0"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

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
        </div>
      )}
    </div>
  );
}
