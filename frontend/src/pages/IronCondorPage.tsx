/**
 * Iron Condor Builder page.
 * Two-column layout: options chain on the left, analysis on the right.
 * Top bar with parameters. Delta-guided leg selection with manual override.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { IronCondorAnalysis } from "@/components/iron-condor/IronCondorAnalysis";
import { PlaceIronCondorDialog } from "@/components/iron-condor/PlaceIronCondorDialog";
import type {
  IronCondorChainResponse,
  IronCondorChainStrike,
  IronCondorAnalyzeResponse,
  IronCondorOrderLeg,
  IronCondorSelectedLegs,
} from "@assup/shared";

function findClosestDelta(chain: IronCondorChainStrike[], targetDelta: number, type: "PUT" | "CALL"): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;

  for (const entry of chain) {
    const option = type === "PUT" ? entry.put : entry.call;
    if (!option || option.delta === 0) continue;
    const diff = Math.abs(option.delta * 100 - targetDelta); // delta in % units
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry.strike;
    }
  }
  return best;
}

export function IronCondorPage() {
  // Parameters
  const [symbol] = useState("SPX");
  const [targetDte, setTargetDte] = useState(1);
  const [quantity, setQuantity] = useState(2);
  const [putDelta, setPutDelta] = useState(7);
  const [callDelta, setCallDelta] = useState(3.5);
  const [wingWidth, setWingWidth] = useState(100);

  // Data
  const [chainData, setChainData] = useState<IronCondorChainResponse | null>(null);
  const [selectedExpiration, setSelectedExpiration] = useState<string>("");
  const [selectedLegs, setSelectedLegs] = useState<IronCondorSelectedLegs>({
    buyPut: null, sellPut: null, sellCall: null, buyCall: null,
  });
  const [analysis, setAnalysis] = useState<IronCondorAnalyzeResponse | null>(null);

  // UI state
  const [chainLoading, setChainLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);

  const analyzeTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // --- Fetch chain ---
  const fetchChain = useCallback(async (dte?: number) => {
    setChainLoading(true);
    setError(null);
    try {
      const data = await api.ironCondor.getChain(symbol, dte ?? targetDte);
      setChainData(data);
      setSelectedExpiration(data.selectedExpiration);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch chain");
    } finally {
      setChainLoading(false);
    }
  }, [symbol, targetDte]);

  // Initial fetch
  useEffect(() => {
    fetchChain();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-select legs based on deltas ---
  const autoSelectLegs = useCallback(() => {
    if (!chainData) return;

    const sellPutStrike = findClosestDelta(chainData.chain, putDelta, "PUT");
    const sellCallStrike = findClosestDelta(chainData.chain, callDelta, "CALL");

    if (!sellPutStrike || !sellCallStrike) return;

    // Wings at configured distance
    const buyPutStrike = sellPutStrike - wingWidth;
    const buyCallStrike = sellCallStrike + wingWidth;

    // Snap to nearest available strikes
    const snappedBuyPut = chainData.chain.reduce((closest, entry) =>
      Math.abs(entry.strike - buyPutStrike) < Math.abs(closest - buyPutStrike) ? entry.strike : closest,
      chainData.chain[0]?.strike ?? buyPutStrike,
    );
    const snappedBuyCall = chainData.chain.reduce((closest, entry) =>
      Math.abs(entry.strike - buyCallStrike) < Math.abs(closest - buyCallStrike) ? entry.strike : closest,
      chainData.chain[chainData.chain.length - 1]?.strike ?? buyCallStrike,
    );

    setSelectedLegs({
      buyPut: snappedBuyPut,
      sellPut: sellPutStrike,
      sellCall: sellCallStrike,
      buyCall: snappedBuyCall,
    });
  }, [chainData, putDelta, callDelta, wingWidth]);

  // Auto-select when chain data or params change
  useEffect(() => {
    autoSelectLegs();
  }, [autoSelectLegs]);

  // --- Analyze ---
  const triggerAnalyze = useCallback(() => {
    if (!chainData || !selectedLegs.buyPut || !selectedLegs.sellPut || !selectedLegs.sellCall || !selectedLegs.buyCall) {
      setAnalysis(null);
      return;
    }

    clearTimeout(analyzeTimeout.current);
    analyzeTimeout.current = setTimeout(async () => {
      setAnalyzeLoading(true);
      try {
        const getLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => {
          const entry = chainData.chain.find(c => c.strike === strike);
          const option = type === "PUT" ? entry?.put : entry?.call;
          return {
            strike,
            type,
            side,
            iv: option?.iv ?? 0,
            bid: option?.bid ?? 0,
            ask: option?.ask ?? 0,
          };
        };

        const expDate = chainData.selectedExpiration;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expMs = new Date(
          parseInt(expDate.slice(0, 4)),
          parseInt(expDate.slice(4, 6)) - 1,
          parseInt(expDate.slice(6, 8)),
        ).getTime();
        const dte = Math.max(0, Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)));

        const result = await api.ironCondor.analyze({
          underlyingPrice: chainData.underlyingPrice,
          legs: [
            getLeg(selectedLegs.buyPut!, "PUT", "BUY"),
            getLeg(selectedLegs.sellPut!, "PUT", "SELL"),
            getLeg(selectedLegs.sellCall!, "CALL", "SELL"),
            getLeg(selectedLegs.buyCall!, "CALL", "BUY"),
          ],
          daysToExpiry: dte,
          quantity,
        });
        setAnalysis(result);
      } catch (err) {
        console.error("Analyze failed:", err);
      } finally {
        setAnalyzeLoading(false);
      }
    }, 200); // 200ms debounce
  }, [chainData, selectedLegs, quantity]);

  useEffect(() => {
    triggerAnalyze();
    return () => clearTimeout(analyzeTimeout.current);
  }, [triggerAnalyze]);

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
    // Calculate DTE for new expiration and re-fetch
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expMs = new Date(
      parseInt(exp.slice(0, 4)),
      parseInt(exp.slice(4, 6)) - 1,
      parseInt(exp.slice(6, 8)),
    ).getTime();
    const dte = Math.max(0, Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)));
    setTargetDte(dte);
    fetchChain(dte);
  }, [fetchChain]);

  // --- Build order legs ---
  const orderLegs = useMemo((): IronCondorOrderLeg[] => {
    if (!chainData || !selectedLegs.buyPut || !selectedLegs.sellPut || !selectedLegs.sellCall || !selectedLegs.buyCall) return [];

    const makeLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL"): IronCondorOrderLeg => {
      const entry = chainData.chain.find(c => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      return {
        conId: option?.conId ?? 0,
        strike,
        type,
        side,
        expiration: chainData.selectedExpiration,
        exchange: "SMART",
      };
    };

    return [
      makeLeg(selectedLegs.buyPut, "PUT", "BUY"),
      makeLeg(selectedLegs.sellPut, "PUT", "SELL"),
      makeLeg(selectedLegs.sellCall, "CALL", "SELL"),
      makeLeg(selectedLegs.buyCall, "CALL", "BUY"),
    ];
  }, [chainData, selectedLegs]);

  // Format expiration for display
  const formatExpiration = (exp: string) => {
    if (exp.length !== 8) return exp;
    const d = new Date(parseInt(exp.slice(0, 4)), parseInt(exp.slice(4, 6)) - 1, parseInt(exp.slice(6, 8)));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center gap-4 flex-wrap border rounded-lg p-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Symbol</Label>
          <div className="border rounded-md px-3 py-1.5 text-sm font-semibold bg-background">{symbol}</div>
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
          <Input
            type="number"
            step={0.5}
            value={putDelta}
            onChange={(e) => setPutDelta(parseFloat(e.target.value) || 7)}
            className="w-16 h-8 text-sm text-center border-red-300 text-red-600"
          />
          <Input
            type="number"
            step={0.5}
            value={callDelta}
            onChange={(e) => setCallDelta(parseFloat(e.target.value) || 3.5)}
            className="w-16 h-8 text-sm text-center border-green-300 text-green-600"
          />
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

        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchChain()}
          disabled={chainLoading}
        >
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

      {/* Main content: two columns */}
      {chainData && (
        <div className="grid grid-cols-2 gap-4">
          {/* Left: Options Chain */}
          <div className="border rounded-lg p-4">
            <OptionsChainTable
              chain={chainData.chain}
              selectedLegs={selectedLegs}
              underlyingPrice={chainData.underlyingPrice}
              onSelectLeg={handleSelectLeg}
            />
          </div>

          {/* Right: Analysis */}
          <div className="border rounded-lg p-4 bg-muted/20">
            <IronCondorAnalysis
              analysis={analysis}
              selectedLegs={selectedLegs}
              chain={chainData.chain}
              underlyingPrice={chainData.underlyingPrice}
              quantity={quantity}
              loading={analyzeLoading}
              onPlaceOrder={() => setOrderDialogOpen(true)}
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
      {analysis && (
        <PlaceIronCondorDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          symbol={symbol}
          legs={orderLegs}
          quantity={quantity}
          netCreditMid={analysis.netCredit.mid}
          maxLoss={Math.max(analysis.maxLossPut, analysis.maxLossCall)}
        />
      )}
    </div>
  );
}
