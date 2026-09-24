import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { ordersApi } from "@/api/orders";
import { formatCurrency, formatDisplayName, quoteMid } from "@assup/shared";
import type { RollCandidate, RollCandidatesResponse, RollScanProgress } from "@assup/shared";
import { useLiveQuote } from "@/hooks";
import { sseManager } from "@/hooks/useSSE";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatExpiry(yyyymmdd: string, dte?: number): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const d = new Date(
    parseInt(yyyymmdd.slice(0, 4)),
    parseInt(yyyymmdd.slice(4, 6)) - 1,
    parseInt(yyyymmdd.slice(6, 8)),
  );
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return dte !== undefined ? `${label} (${dte}d)` : label;
}

/** Scan phases in order, for the progress trail under the bar */
const PHASE_LABELS = ["Close leg", "Chain", "Contracts", "Quotes"] as const;
const PHASE_ORDER: RollScanProgress["phase"][] = ["close-leg", "chain", "contracts", "quotes", "done"];

/** How the candidate table is organized: one flat list by credit, or grouped */
type GroupBy = "credit" | "strike" | "expiration";

interface CandidateGroup {
  key: string;
  /** null for the flat "by net credit" list */
  label: string | null;
  candidates: RollCandidate[];
}

/**
 * Group candidates for display. Groups are listed in natural order (strikes
 * ascending, expiries chronological) so the ladder reads top to bottom, while
 * rows inside each group — and the flat list — are sorted by best credit first.
 */
function groupCandidates(candidates: RollCandidate[], groupBy: GroupBy): CandidateGroup[] {
  const byCreditDesc = (a: RollCandidate, b: RollCandidate) => b.netCreditMid - a.netCreditMid;
  if (groupBy === "credit") {
    return [{ key: "all", label: null, candidates: [...candidates].sort(byCreditDesc) }];
  }

  const groups = new Map<string, RollCandidate[]>();
  for (const c of candidates) {
    const key = groupBy === "strike" ? String(c.strike) : c.expiration;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return [...groups.entries()]
    .sort((a, b) => (groupBy === "strike" ? Number(a[0]) - Number(b[0]) : a[0].localeCompare(b[0])))
    .map(([key, rows]) => ({
      key,
      label: groupBy === "strike"
        ? formatCurrency(Number(key))
        : formatExpiry(key, rows[0].daysToExpiry),
      candidates: [...rows].sort(byCreditDesc),
    }));
}

/** Minimal position shape required by the Roll dialog; both Position and CurrentOptionPosition satisfy this. */
export interface RollablePosition {
  symbol: string;
  underlying?: string;
  strike?: number;
  right?: "C" | "P";
  /** Expiry in YYYYMMDD format */
  expiry?: string;
  conId: number;
  /** Negative for short positions */
  position: number;
}

interface RollOptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: RollablePosition | null;
  onOrderPlaced?: () => void;
}

export function RollOptionDialog({
  open,
  onOpenChange,
  position,
  onOrderPlaced,
}: RollOptionDialogProps) {
  const [minDTEBeyond, setMinDTEBeyond] = useState(30);
  const [strikeRangePercent, setStrikeRangePercent] = useState(20);
  const [minNetCredit, setMinNetCredit] = useState(0.10);
  const [groupBy, setGroupBy] = useState<GroupBy>("credit");
  const [progress, setProgress] = useState<RollScanProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RollCandidatesResponse | null>(null);
  const [selected, setSelected] = useState<RollCandidate | null>(null);
  const [limitPrice, setLimitPrice] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState<{ orderId: number } | null>(null);

  // Live quotes for the two legs of the roll, so the credit reflects the market
  // while the dialog is open (the scan table stays as scanned).
  const closeLive = useLiveQuote(open && position?.conId ? position.conId : undefined);
  const openLive = useLiveQuote(open && selected?.conId ? selected.conId : undefined);
  const closeAsk = closeLive?.ask ?? data?.closeLeg.ask ?? null;
  const closeMid = quoteMid(closeLive) ?? data?.closeLeg.mid ?? null;
  const openBid = openLive?.bid ?? selected?.bid ?? null;
  const openMid = quoteMid(openLive) ?? selected?.mid ?? null;
  const liveNetCreditMid = closeMid != null && openMid != null ? openMid - closeMid : null;
  /** A roll that costs money: the replacement premium doesn't cover the buy-back */
  const isDebitRoll = limitPrice < 0;

  const phaseIndex = progress ? PHASE_ORDER.indexOf(progress.phase) : -1;

  const groups = useMemo(
    () => (data ? groupCandidates(data.candidates, groupBy) : []),
    [data, groupBy],
  );

  // Tracks the in-flight scan request so it can be cancelled
  const abortRef = useRef<AbortController | null>(null);
  // Identifies this scan in the progress events the backend pushes over SSE
  const scanIdRef = useRef<string>("");

  // Progress events for the running scan (ignoring any other dialog's scan)
  useEffect(() => {
    if (!loading) return;
    // Hold the shared SSE connection open for the scan, then listen for its events
    const releaseSse = sseManager.subscribe();
    const removeListener = sseManager.addListener("roll_progress", (data) => {
      const event = data as RollScanProgress;
      if (event.scanId === scanIdRef.current) setProgress(event);
    });
    return () => {
      removeListener();
      releaseSse();
    };
  }, [loading]);

  // Elapsed seconds, so a stalled phase is visibly stalled
  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  const cancelScan = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  }, []);

  const startScan = useCallback(async () => {
    if (!position || !position.expiry || !position.strike || !position.right || !position.conId) return;

    // Cancel any previous in-flight scan before starting a new one
    cancelScan();

    const controller = new AbortController();
    abortRef.current = controller;

    scanIdRef.current = `roll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setProgress(null);
    setLoading(true);
    setError(null);
    setSelected(null);
    setSuccess(null);
    setData(null);

    try {
      const result = await ordersApi.rollCandidates(
        {
          symbol: position.underlying ?? position.symbol,
          expiration: position.expiry,
          strike: position.strike,
          right: position.right,
          conId: position.conId,
          minDTEBeyond,
          strikeRangePercent,
          progressClientId: sseManager.clientId ?? undefined,
          scanId: scanIdRef.current,
        },
        controller.signal,
      );
      setData(result);
    } catch (err) {
      // Ignore errors from a cancelled scan (user clicked Cancel or closed dialog)
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to fetch candidates");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [position, minDTEBeyond, strikeRangePercent, cancelScan]);

  // Cancel any in-flight scan when the component unmounts
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      cancelScan();
      setData(null);
      setSelected(null);
      setError(null);
      setSuccess(null);
      setMinDTEBeyond(30);
      setStrikeRangePercent(20);
      setMinNetCredit(0.10);
      setGroupBy("credit");
      setProgress(null);
    }
    onOpenChange(nextOpen);
  }, [cancelScan, onOpenChange]);

  const handleSelectCandidate = (candidate: RollCandidate) => {
    setSelected(candidate);
    setLimitPrice(Math.round(candidate.netCreditMid * 100) / 100);
    setSuccess(null);
  };

  const handlePlaceRoll = async () => {
    if (!position || !selected || !data) return;
    setPlacing(true);
    setError(null);
    try {
      const result = await ordersApi.roll({
        symbol: position.underlying ?? position.symbol,
        closeConId: data.closeLeg.conId,
        openConId: selected.conId,
        openExpiration: selected.expiration,
        openStrike: selected.strike,
        openRight: position.right!,
        quantity: Math.abs(position.position),
        limitPrice,
      });
      setSuccess({ orderId: result.orderId });
      onOrderPlaced?.();
      setTimeout(() => handleOpenChange(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place roll order");
    } finally {
      setPlacing(false);
    }
  };

  if (!position) return null;

  const qty = Math.abs(position.position);
  const closeContractName = formatDisplayName({
    symbol: position.underlying ?? position.symbol,
    secType: "OPT",
    strike: position.strike,
    right: position.right,
    lastTradeDateOrContractMonth: position.expiry,
  });

  const openContractName = selected
    ? formatDisplayName({
        symbol: position.underlying ?? position.symbol,
        secType: "OPT",
        strike: selected.strike,
        right: position.right,
        lastTradeDateOrContractMonth: selected.expiration,
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roll Option</DialogTitle>
          <DialogDescription>
            Find a replacement to roll {position.underlying ?? position.symbol} for a net credit
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current position summary */}
          <div className="p-3 rounded-md bg-muted grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
            {[
              { label: "Symbol", value: position.underlying ?? position.symbol },
              { label: "Strike", value: position.strike ? formatCurrency(position.strike) : "—" },
              { label: "Expiry", value: position.expiry ? formatExpiry(position.expiry) : "—" },
              { label: "Qty", value: String(position.position) },
              { label: "Close Ask", value: closeAsk != null ? formatCurrency(closeAsk, { maximumFractionDigits: 2 }) : "—" },
              { label: "Close Mid", value: closeMid != null ? formatCurrency(closeMid, { maximumFractionDigits: 2 }) : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-medium">{value}</div>
              </div>
            ))}
          </div>

          {/* Filters + Scan controls */}
          <div className="flex gap-4 items-end flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Roll at least</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">(?)</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">
                    The replacement option must expire at least this many days after the current position's expiry date.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={minDTEBeyond}
                  onChange={(e) => setMinDTEBeyond(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-20 text-center"
                  disabled={loading}
                />
                <span className="text-sm text-muted-foreground">days further out</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Strikes within</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">(?)</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">
                    How far above and below the current strike to scan. Rolling out at the same or a
                    more aggressive strike pays more premium, at more risk.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">±</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={strikeRangePercent}
                  onChange={(e) => setStrikeRangePercent(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-20 text-center"
                  disabled={loading}
                />
                <span className="text-sm text-muted-foreground">% of strike</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Green-highlight rows above</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">(?)</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56">
                    Rows where the mid-price net credit meets or exceeds this amount are highlighted in green.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  min={0}
                  step={0.05}
                  value={minNetCredit}
                  onChange={(e) => setMinNetCredit(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-24 text-center"
                  disabled={loading}
                />
                <span className="text-sm text-muted-foreground">net credit</span>
              </div>
            </div>
            {loading ? (
              <Button variant="outline" size="sm" onClick={cancelScan}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={startScan}>
                {data ? "Re-scan" : "Scan"}
              </Button>
            )}
          </div>

          {/* Status / Error */}
          {loading && (
            <div className="space-y-2 py-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {progress?.message ?? "Starting scan…"}
                  {progress?.total ? ` — ${progress.done ?? 0}/${progress.total}` : ""}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{elapsed}s</span>
              </div>
              <Progress
                value={progress?.total ? ((progress.done ?? 0) / progress.total) * 100 : undefined}
                className={progress?.total ? "" : "animate-pulse"}
              />
              <div className="text-xs text-muted-foreground">
                {PHASE_LABELS.map((label, i) => (
                  <span key={label} className={i <= phaseIndex ? "text-foreground" : ""}>
                    {i > 0 && " → "}
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          {/* Candidates table (only shown after a completed scan) */}
          {!loading && data && (
            data.candidates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No roll candidates could be quoted. Try reducing the "days further out" value or widening the strike range.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Group by</Label>
                    <ToggleGroup
                      type="single"
                      value={groupBy}
                      onValueChange={(v) => v && setGroupBy(v as GroupBy)}
                    >
                      <ToggleGroupItem value="credit" className="text-xs px-3 h-7">
                        Net credit
                      </ToggleGroupItem>
                      <ToggleGroupItem value="strike" className="text-xs px-3 h-7">
                        Strike
                      </ToggleGroupItem>
                      <ToggleGroupItem value="expiration" className="text-xs px-3 h-7">
                        Expiry
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {data.candidates.length} candidates
                  </span>
                </div>
                <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strike</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead className="text-right">New Mid</TableHead>
                      <TableHead className="text-right">Net Credit</TableHead>
                      <TableHead className="text-right">Ann. Return</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <Fragment key={group.key}>
                        {group.label && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={5} className="py-1.5 text-xs font-medium">
                              {group.label}
                              <span className="ml-2 font-normal text-muted-foreground">
                                {group.candidates.length} {group.candidates.length === 1 ? "roll" : "rolls"} · best{" "}
                                <span className={group.candidates[0].netCreditMid < 0 ? "text-red-600" : "text-green-600"}>
                                  {group.candidates[0].netCreditMid < 0 ? "−" : "+"}
                                  {formatCurrency(Math.abs(group.candidates[0].netCreditMid), { maximumFractionDigits: 2 })}
                                </span>
                              </span>
                            </TableCell>
                          </TableRow>
                        )}
                        {group.candidates.map((c) => {
                      const aboveThreshold = c.netCreditMid >= minNetCredit;
                      const isDebit = c.netCreditMid < 0;
                      const isSelected = selected?.conId === c.conId;
                      return (
                        <TableRow
                          key={`${c.strike}-${c.expiration}`}
                          className={`cursor-pointer ${
                            isSelected
                              ? "bg-primary/10 outline outline-1 outline-primary"
                              : aboveThreshold
                              ? "border-l-2 border-l-green-500 bg-green-500/5 hover:bg-green-500/10"
                              : isDebit
                              ? "border-l-2 border-l-red-500/60 hover:bg-muted/50"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => handleSelectCandidate(c)}
                        >
                          <TableCell className="font-semibold">
                            {formatCurrency(c.strike)}
                            {position.strike != null && c.strike !== position.strike && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {c.strike > position.strike ? "▲" : "▼"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatExpiry(c.expiration, c.daysToExpiry)}</TableCell>
                          <TableCell className="text-right tabular-nums font-mono">
                            {formatCurrency(c.mid, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-mono font-semibold ${
                            isDebit ? "text-red-600" : aboveThreshold ? "text-green-600" : "text-green-500"
                          }`}>
                            {isDebit ? "−" : "+"}{formatCurrency(Math.abs(c.netCreditMid), { maximumFractionDigits: 2 })}
                            {isDebit && <span className="ml-1 text-[10px] uppercase tracking-wide">debit</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono">
                            {c.annualizedReturn.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </div>
            )
          )}

          {/* Order preview */}
          {selected && data && (
            <div className="rounded-md border p-4 space-y-3 bg-primary/5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Order Preview</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-destructive/10 p-3">
                  <div className="text-xs text-destructive uppercase tracking-wide mb-1">Buy to Close</div>
                  <div className="font-medium text-sm">{closeContractName}</div>
                  <div className="font-mono text-destructive mt-1 text-sm">
                    −{formatCurrency(closeAsk ?? data.closeLeg.ask, { maximumFractionDigits: 2 })}
                    <span className="text-muted-foreground text-xs ml-1">(ask)</span>
                  </div>
                </div>
                <div className="rounded-md bg-green-500/10 p-3">
                  <div className="text-xs text-green-600 uppercase tracking-wide mb-1">Sell to Open</div>
                  <div className="font-medium text-sm">{openContractName}</div>
                  <div className="font-mono text-green-600 mt-1 text-sm">
                    +{formatCurrency(openBid ?? selected.bid, { maximumFractionDigits: 2 })}
                    <span className="text-muted-foreground text-xs ml-1">(bid)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-4 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">Limit price per contract (negative = debit)</Label>
                  <div className="flex items-center gap-1">
                    <span className={`font-medium ${isDebitRoll ? "text-red-600" : "text-green-600"}`}>
                      {isDebitRoll ? "−$" : "+$"}
                    </span>
                    <Input
                      type="number"
                      step={0.01}
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                      className="w-24 text-center"
                      disabled={placing}
                    />
                  </div>
                </div>
                {liveNetCreditMid != null && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Live net credit (mid)</div>
                    <div className="font-mono font-medium">
                      {formatCurrency(liveNetCreditMid, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {isDebitRoll ? "Total cost to roll" : "Total Credit"}
                  </div>
                  <div className={`font-bold text-lg ${isDebitRoll ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(Math.abs(limitPrice) * qty * 100, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {success && (
                <div className="p-2 rounded-md bg-green-500/10 text-green-600 text-sm">
                  Roll order placed! Order ID: {success.orderId}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={placing}>
                  Cancel
                </Button>
                <Button
                  onClick={handlePlaceRoll}
                  disabled={placing || limitPrice === 0}
                  className={isDebitRoll
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"}
                >
                  {placing ? "Placing…" : isDebitRoll ? "Place Roll Order (debit)" : "Place Roll Order"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
