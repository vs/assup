/**
 * Spreads builder page.
 * Supports put spreads, call spreads, and iron condors on SPX/RUT.
 * Two-column layout: options chain on the left, analysis on the right.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/api";
import { OptionsChainTable } from "@/components/iron-condor/OptionsChainTable";
import { SpreadAnalysis } from "@/components/iron-condor/SpreadAnalysis";
import { PlaceSpreadDialog } from "@/components/iron-condor/PlaceSpreadDialog";
import { ActiveSpreadsList } from "@/components/iron-condor/ActiveSpreadsList";
import { CloseSpreadDialog } from "@/components/iron-condor/CloseSpreadDialog";
import type {
  SpreadMode,
  IronCondorChainResponse,
  IronCondorChainStrike,
  IronCondorAnalyzeResponse,
  IronCondorOrderLeg,
  SpreadSelectedLegs,
  ActiveSpread,
} from "@assup/shared";

const SUPPORTED_SYMBOLS = ["SPX", "XSP", "RUT"] as const;
const SPREAD_MODES: { value: SpreadMode; label: string }[] = [
  { value: "put-spread", label: "Put Spread" },
  { value: "call-spread", label: "Call Spread" },
  { value: "iron-condor", label: "Iron Condor" },
];

function findClosestDelta(chain: IronCondorChainStrike[], targetDelta: number, type: "PUT" | "CALL"): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;

  for (const entry of chain) {
    const option = type === "PUT" ? entry.put : entry.call;
    if (!option || option.delta === 0) continue;
    const diff = Math.abs(option.delta * 100 - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry.strike;
    }
  }
  return best;
}

export function IronCondorPage() {
  // Parameters
  const [symbol, setSymbol] = useState<string>("SPX");
  const [mode, setMode] = useState<SpreadMode>("put-spread");
  const [targetDte, setTargetDte] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [putDelta, setPutDelta] = useState(3.5);
  const [callDelta, setCallDelta] = useState(3.5);
  const [wingWidth, setWingWidth] = useState(100);

  // Data
  const [chainData, setChainData] = useState<IronCondorChainResponse | null>(null);
  const [selectedExpiration, setSelectedExpiration] = useState<string>("");
  const [selectedLegs, setSelectedLegs] = useState<SpreadSelectedLegs>({
    buyPut: null, sellPut: null, sellCall: null, buyCall: null,
  });
  const [analysis, setAnalysis] = useState<IronCondorAnalyzeResponse | null>(null);

  // UI state
  const [chainLoading, setChainLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);

  // Active spreads
  const [activeSpreads, setActiveSpreads] = useState<ActiveSpread[]>([]);
  const [closingSpread, setClosingSpread] = useState<ActiveSpread | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  // --- Fetch chain ---
  const fetchChain = useCallback(async (sym?: string, dte?: number) => {
    setChainLoading(true);
    setError(null);
    try {
      const data = await api.ironCondor.getChain(sym ?? symbol, dte ?? targetDte);
      setChainData(data);
      setSelectedExpiration(data.selectedExpiration);
      fetchActiveSpreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch chain");
    } finally {
      setChainLoading(false);
    }
  }, [symbol, targetDte]);

  // --- Fetch active spreads ---
  const fetchActiveSpreads = useCallback(async () => {
    try {
      const data = await api.ironCondor.getActiveSpreads();
      setActiveSpreads(data);
    } catch {
      // Silent — active spreads are supplementary, don't block the page
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchChain();
    fetchActiveSpreads();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-select legs based on deltas and mode ---
  const autoSelectLegs = useCallback(() => {
    if (!chainData) return;

    const newLegs: SpreadSelectedLegs = { buyPut: null, sellPut: null, sellCall: null, buyCall: null };

    if (hasPutSide) {
      const sellPutStrike = findClosestDelta(chainData.chain, putDelta, "PUT");
      if (sellPutStrike) {
        const buyPutTarget = sellPutStrike - wingWidth;
        const snappedBuyPut = chainData.chain.reduce((closest, entry) =>
          Math.abs(entry.strike - buyPutTarget) < Math.abs(closest - buyPutTarget) ? entry.strike : closest,
          chainData.chain[0]?.strike ?? buyPutTarget,
        );
        newLegs.sellPut = sellPutStrike;
        newLegs.buyPut = snappedBuyPut;
      }
    }

    if (hasCallSide) {
      const sellCallStrike = findClosestDelta(chainData.chain, callDelta, "CALL");
      if (sellCallStrike) {
        const buyCallTarget = sellCallStrike + wingWidth;
        const snappedBuyCall = chainData.chain.reduce((closest, entry) =>
          Math.abs(entry.strike - buyCallTarget) < Math.abs(closest - buyCallTarget) ? entry.strike : closest,
          chainData.chain[chainData.chain.length - 1]?.strike ?? buyCallTarget,
        );
        newLegs.sellCall = sellCallStrike;
        newLegs.buyCall = snappedBuyCall;
      }
    }

    setSelectedLegs(newLegs);
  }, [chainData, putDelta, callDelta, wingWidth, hasPutSide, hasCallSide]);

  // Auto-select when chain data or params change
  useEffect(() => {
    autoSelectLegs();
  }, [autoSelectLegs]);

  // --- Analyze ---
  useEffect(() => {
    if (!chainData) { setAnalysis(null); return; }

    // Guard: require mode-relevant legs
    if (hasPutSide && (!selectedLegs.buyPut || !selectedLegs.sellPut)) { setAnalysis(null); return; }
    if (hasCallSide && (!selectedLegs.sellCall || !selectedLegs.buyCall)) { setAnalysis(null); return; }

    const getLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => {
      const entry = chainData.chain.find((c: IronCondorChainStrike) => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      return { strike, type, side, iv: option?.iv ?? 0, bid: option?.bid ?? 0, ask: option?.ask ?? 0 };
    };

    const expDate = chainData.selectedExpiration;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expMs = new Date(parseInt(expDate.slice(0, 4)), parseInt(expDate.slice(4, 6)) - 1, parseInt(expDate.slice(6, 8))).getTime();
    const dte = Math.max(0, Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)));

    const legs: ReturnType<typeof getLeg>[] = [];
    if (hasPutSide) {
      legs.push(getLeg(selectedLegs.buyPut!, "PUT", "BUY"));
      legs.push(getLeg(selectedLegs.sellPut!, "PUT", "SELL"));
    }
    if (hasCallSide) {
      legs.push(getLeg(selectedLegs.sellCall!, "CALL", "SELL"));
      legs.push(getLeg(selectedLegs.buyCall!, "CALL", "BUY"));
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setAnalyzeLoading(true);
      try {
        const result = await api.ironCondor.analyze({
          underlyingPrice: chainData.underlyingPrice,
          legs,
          daysToExpiry: dte,
          quantity,
          mode,
        });
        if (!cancelled) setAnalysis(result);
      } catch (err) {
        console.error("Analyze failed:", err);
        if (!cancelled) { setAnalysis(null); setError(err instanceof Error ? err.message : "Analysis failed"); }
      } finally {
        if (!cancelled) setAnalyzeLoading(false);
      }
    }, 200);

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [chainData, selectedLegs, quantity, mode, hasPutSide, hasCallSide]);

  // --- Leg selection handler ---
  const handleSelectLeg = useCallback((strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => {
    setSelectedLegs(prev => {
      if (type === "PUT" && side === "SELL") return { ...prev, sellPut: strike };
      if (type === "PUT" && side === "BUY") return { ...prev, buyPut: strike };
      if (type === "CALL" && side === "SELL") return { ...prev, sellCall: strike };
      if (type === "CALL" && side === "BUY") return { ...prev, buyCall: strike };
      return prev;
    });
  }, []);

  // --- Expiration change ---
  const handleExpirationChange = useCallback((exp: string) => {
    setSelectedExpiration(exp);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expMs = new Date(parseInt(exp.slice(0, 4)), parseInt(exp.slice(4, 6)) - 1, parseInt(exp.slice(6, 8))).getTime();
    const dte = Math.max(0, Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)));
    setTargetDte(dte);
    fetchChain(undefined, dte);
  }, [fetchChain]);

  // --- Symbol change ---
  const handleSymbolChange = useCallback((sym: string) => {
    setSymbol(sym);
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
    setAnalysis(null);
    fetchChain(sym);
  }, [fetchChain]);

  // --- Mode change ---
  const handleModeChange = useCallback((newMode: SpreadMode) => {
    setMode(newMode);
    // Explicitly reset all legs — autoSelectLegs will repopulate the relevant ones
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
    setAnalysis(null);
  }, []);

  const handleCloseSpread = useCallback((spread: ActiveSpread) => {
    setClosingSpread(spread);
    setCloseDialogOpen(true);
  }, []);

  const handleCloseSuccess = useCallback(() => {
    fetchActiveSpreads();
  }, [fetchActiveSpreads]);

  // --- Build order legs ---
  const orderLegs = useMemo((): IronCondorOrderLeg[] => {
    if (!chainData) return [];

    if (hasPutSide && (!selectedLegs.buyPut || !selectedLegs.sellPut)) return [];
    if (hasCallSide && (!selectedLegs.sellCall || !selectedLegs.buyCall)) return [];

    const makeLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL"): IronCondorOrderLeg => {
      const entry = chainData.chain.find(c => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      return { conId: option?.conId ?? 0, strike, type, side, expiration: chainData.selectedExpiration, exchange: "SMART" };
    };

    const legs: IronCondorOrderLeg[] = [];
    if (hasPutSide) {
      legs.push(makeLeg(selectedLegs.buyPut!, "PUT", "BUY"));
      legs.push(makeLeg(selectedLegs.sellPut!, "PUT", "SELL"));
    }
    if (hasCallSide) {
      legs.push(makeLeg(selectedLegs.sellCall!, "CALL", "SELL"));
      legs.push(makeLeg(selectedLegs.buyCall!, "CALL", "BUY"));
    }
    return legs;
  }, [chainData, selectedLegs, hasPutSide, hasCallSide]);

  // Format expiration for display
  const formatExpiration = (exp: string) => {
    if (exp.length !== 8) return exp;
    const d = new Date(parseInt(exp.slice(0, 4)), parseInt(exp.slice(4, 6)) - 1, parseInt(exp.slice(6, 8)));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
  };

  // Max loss for order dialog
  const maxLoss = analysis
    ? Math.max(...[analysis.maxLossPut, analysis.maxLossCall].filter((v): v is number => v != null))
    : 0;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center gap-4 flex-wrap border rounded-lg p-3 bg-muted/30">
        {/* Symbol picker */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Symbol</Label>
          <div className="flex rounded-md border overflow-hidden">
            {SUPPORTED_SYMBOLS.map(sym => (
              <button
                key={sym}
                onClick={() => handleSymbolChange(sym)}
                className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                  symbol === sym ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Mode picker */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
          <div className="flex rounded-md border overflow-hidden">
            {SPREAD_MODES.map(m => (
              <button
                key={m.value}
                onClick={() => handleModeChange(m.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === m.value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Expiration</Label>
          <Select value={selectedExpiration} onValueChange={handleExpirationChange}>
            <SelectTrigger className="w-[180px] h-8 text-sm">
              <SelectValue placeholder="Select expiration" />
            </SelectTrigger>
            <SelectContent>
              {(chainData?.expirations ?? []).map((exp: string) => (
                <SelectItem key={exp} value={exp}>{formatExpiration(exp)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            className="w-14 h-8 text-sm text-center"
          />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Target Deltas</Label>
          {hasPutSide && (
            <Input
              type="number"
              step={0.5}
              value={putDelta}
              onChange={(e) => setPutDelta(parseFloat(e.target.value) || 7)}
              className="w-16 h-8 text-sm text-center border-red-300 text-red-600"
            />
          )}
          {hasCallSide && (
            <Input
              type="number"
              step={0.5}
              value={callDelta}
              onChange={(e) => setCallDelta(parseFloat(e.target.value) || 3.5)}
              className="w-16 h-8 text-sm text-center border-green-300 text-green-600"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Wing Width</Label>
          <Input
            type="number"
            step={5}
            value={wingWidth}
            onChange={(e) => setWingWidth(parseInt(e.target.value) || 100)}
            className="w-16 h-8 text-sm text-center"
          />
        </div>

        <div className="flex-1" />

        {chainData && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{symbol} {chainData.underlyingPrice.toLocaleString()}</span>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={() => fetchChain()} disabled={chainLoading}>
          {chainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Active spreads */}
      <ActiveSpreadsList
        spreads={activeSpreads}
        symbol={symbol}
        onClose={handleCloseSpread}
      />

      {/* Main content: stacked layout */}
      {chainData && (
        <div className="space-y-4">
          {/* Options Chain */}
          <div className="border rounded-lg p-4">
            <OptionsChainTable
              chain={chainData.chain}
              selectedLegs={selectedLegs}
              underlyingPrice={chainData.underlyingPrice}
              onSelectLeg={handleSelectLeg}
              mode={mode}
            />
          </div>

          {/* Analysis */}
          <div className="border rounded-lg p-4 bg-muted/20">
            <SpreadAnalysis
              analysis={analysis}
              selectedLegs={selectedLegs}
              chain={chainData.chain}
              underlyingPrice={chainData.underlyingPrice}
              quantity={quantity}
              loading={analyzeLoading}
              onPlaceOrder={() => setOrderDialogOpen(true)}
              mode={mode}
              symbol={symbol}
            />
          </div>
        </div>
      )}

      {/* Loading state */}
      {chainLoading && !chainData && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Fetching {symbol} options chain...
        </div>
      )}

      {/* Order dialog */}
      {analysis && chainData && (
        <PlaceSpreadDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          symbol={symbol}
          legs={orderLegs}
          quantity={quantity}
          netCreditMid={analysis.netCredit.mid}
          maxLoss={maxLoss}
          mode={mode}
          chain={chainData.chain}
        />
      )}

      {/* Close spread dialog */}
      <CloseSpreadDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        spread={closingSpread}
        onSuccess={handleCloseSuccess}
      />
    </div>
  );
}
