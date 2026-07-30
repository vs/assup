import { useState, useEffect, useCallback } from "react";
import { ordersApi } from "@/api/orders";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { Position, RollCandidate, RollCandidatesResponse } from "@assup/shared";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RollOptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  onOrderPlaced?: () => void;
}

export function RollOptionDialog({
  open,
  onOpenChange,
  position,
  onOrderPlaced,
}: RollOptionDialogProps) {
  const [minDTEBeyond, setMinDTEBeyond] = useState(30);
  const [minNetCredit, setMinNetCredit] = useState(0.10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RollCandidatesResponse | null>(null);
  const [selected, setSelected] = useState<RollCandidate | null>(null);
  const [limitPrice, setLimitPrice] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState<{ orderId: number } | null>(null);

  const fetchCandidates = useCallback(async () => {
    if (!position || !position.expiry || !position.strike || !position.right || !position.conId) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setSuccess(null);
    try {
      const result = await ordersApi.rollCandidates({
        symbol: position.underlying ?? position.symbol,
        expiration: position.expiry,
        strike: position.strike,
        right: position.right,
        conId: position.conId,
        minDTEBeyond,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch candidates");
    } finally {
      setLoading(false);
    }
  }, [position, minDTEBeyond]);

  // Fetch on open
  useEffect(() => {
    if (open && position) {
      fetchCandidates();
    }
  }, [open, position, fetchCandidates]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setData(null);
      setSelected(null);
      setError(null);
      setSuccess(null);
      setMinDTEBeyond(30);
      setMinNetCredit(0.10);
    }
  }, [open]);

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
        quantity: Math.abs(position.position),
        limitPrice,
      });
      setSuccess({ orderId: result.orderId });
      onOrderPlaced?.();
      setTimeout(() => onOpenChange(false), 1500);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              { label: "Expiry", value: position.expiry ?? "—" },
              { label: "Qty", value: String(position.position) },
              { label: "Close Ask", value: data ? formatCurrency(data.closeLeg.ask, { maximumFractionDigits: 2 }) : "—" },
              { label: "Close Mid", value: data ? formatCurrency(data.closeLeg.mid, { maximumFractionDigits: 2 }) : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-medium">{value}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-4 items-end flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Min DTE beyond current expiry</Label>
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
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Highlight threshold (net credit)</Label>
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
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchCandidates} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          {/* Candidates table */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Scanning option chain…</div>
          ) : data && data.candidates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No profitable roll candidates found. Try reducing Min DTE beyond.
            </div>
          ) : data ? (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strike</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">DTE</TableHead>
                    <TableHead className="text-right">New Mid</TableHead>
                    <TableHead className="text-right">Net Credit</TableHead>
                    <TableHead className="text-right">Ann. Return</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.candidates.map((c) => {
                    const aboveThreshold = c.netCreditMid >= minNetCredit;
                    const isSelected = selected?.conId === c.conId;
                    return (
                      <TableRow
                        key={`${c.strike}-${c.expiration}`}
                        className={`cursor-pointer ${
                          isSelected
                            ? "bg-primary/10 outline outline-1 outline-primary"
                            : aboveThreshold
                            ? "border-l-2 border-l-green-500 bg-green-500/5 hover:bg-green-500/10"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => handleSelectCandidate(c)}
                      >
                        <TableCell className="font-semibold">{formatCurrency(c.strike)}</TableCell>
                        <TableCell className="text-muted-foreground">{c.expiration}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.daysToExpiry}</TableCell>
                        <TableCell className="text-right tabular-nums font-mono">
                          {formatCurrency(c.mid, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-mono font-semibold ${
                          c.netCreditMid >= minNetCredit ? "text-green-600" : "text-green-500"
                        }`}>
                          +{formatCurrency(c.netCreditMid, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono">
                          {c.annualizedReturn.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {/* Order preview */}
          {selected && data && (
            <div className="rounded-md border p-4 space-y-3 bg-primary/5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Order Preview</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-destructive/10 p-3">
                  <div className="text-xs text-destructive uppercase tracking-wide mb-1">Buy to Close</div>
                  <div className="font-medium text-sm">{closeContractName}</div>
                  <div className="font-mono text-destructive mt-1 text-sm">
                    −{formatCurrency(data.closeLeg.ask, { maximumFractionDigits: 2 })}
                    <span className="text-muted-foreground text-xs ml-1">(ask)</span>
                  </div>
                </div>
                <div className="rounded-md bg-green-500/10 p-3">
                  <div className="text-xs text-green-600 uppercase tracking-wide mb-1">Sell to Open</div>
                  <div className="font-medium text-sm">{openContractName}</div>
                  <div className="font-mono text-green-600 mt-1 text-sm">
                    +{formatCurrency(selected.bid, { maximumFractionDigits: 2 })}
                    <span className="text-muted-foreground text-xs ml-1">(bid)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-4 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">Limit price (net credit/contract)</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-green-600 font-medium">+$</span>
                    <Input
                      type="number"
                      step={0.01}
                      min={0.01}
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                      className="w-24 text-center"
                      disabled={placing}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Total Credit</div>
                  <div className="font-bold text-green-600 text-lg">
                    {formatCurrency(limitPrice * qty * 100, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {success && (
                <div className="p-2 rounded-md bg-green-500/10 text-green-600 text-sm">
                  Roll order placed! Order ID: {success.orderId}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={placing}>
                  Cancel
                </Button>
                <Button
                  onClick={handlePlaceRoll}
                  disabled={placing || limitPrice <= 0}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {placing ? "Placing…" : "Place Roll Order"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
