import { useState, useEffect, useCallback } from "react";
import type { WheelScan, AssetClass } from "@assup/shared";
import { wheelScannerApi } from "@/api/wheelScanner";
import { researchApi } from "@/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CandidateCard } from "./CandidateCard";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { timeAgo } from "@/utils/format";

const statusStyles: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};

interface ScanHistoryProps {
  assetClasses: AssetClass[];
  refreshTrigger?: number;
}

export function ScanHistory({ assetClasses, refreshTrigger }: ScanHistoryProps) {
  const [scans, setScans] = useState<WheelScan[]>([]);
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [trackedSymbols, setTrackedSymbols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [scanData, tickerData] = await Promise.all([
        wheelScannerApi.scans.list(10),
        researchApi.listTickers(1, 1000),
      ]);
      setScans(scanData);
      setTrackedSymbols(new Set(tickerData.tickers.map((t) => t.symbol)));

      if (scanData.some((s) => s.status === "running")) {
        setCollapsed(false);
      }
    } catch {
      // Silent fail for history
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  function handleTickerAdded(symbol: string) {
    setTrackedSymbols((prev) => new Set([...prev, symbol]));
  }

  if (loading || scans.length === 0) return null;

  const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));

  return (
    <Card>
      <CardContent className="p-0">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4 text-muted-foreground" />
            Scan History
            <span className="text-muted-foreground font-normal">
              ({scans.length} scan{scans.length !== 1 ? "s" : ""})
            </span>
          </div>
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {!collapsed && (
          <div className="border-t">
            {scans.map((scan) => {
              const style = statusStyles[scan.status] ?? statusStyles.pending;
              const isExpanded = expandedScanId === scan.id;

              return (
                <div key={scan.id} className="border-b last:border-b-0">
                  <button
                    className="w-full flex items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors text-sm"
                    onClick={() =>
                      setExpandedScanId(isExpanded ? null : scan.id)
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-muted-foreground">
                      {timeAgo(scan.createdAt)}
                    </span>
                    <Badge variant={style.variant} className="text-xs">
                      {style.label}
                    </Badge>
                    <span className="text-muted-foreground">
                      {scan.scoredCandidates} scored / {scan.totalCandidates} found
                    </span>
                    {scan.reportsTriggered > 0 && (
                      <span className="text-muted-foreground">
                        {scan.reportsTriggered} reports
                      </span>
                    )}
                  </button>

                  {isExpanded && scan.results.length > 0 && (
                    <div className="px-4 pb-4 pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {scan.results.map((result) => {
                          const ac = acMap.get(result.assetClassId);
                          return (
                            <CandidateCard
                              key={result.id}
                              result={result}
                              assetClassName={ac?.name}
                              assetClassColor={ac?.color}
                              isTracked={trackedSymbols.has(result.symbol)}
                              onAdded={handleTickerAdded}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isExpanded && scan.results.length === 0 && (
                    <div className="px-4 pb-4 text-sm text-muted-foreground">
                      No results for this scan.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
