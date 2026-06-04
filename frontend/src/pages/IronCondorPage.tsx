/**
 * Spreads builder page.
 * Supports put spreads, call spreads, and iron condors on SPX/RUT.
 * Two-column layout: options chain on the left, analysis on the right.
 *
 * Uses streaming market data via useSpreadsStream for live chain updates
 * and client-side analysis via analyzeSpread for instant computation.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { cn } from "@/lib/utils";
import { settingsApi } from "@/api/settings";
import { api } from "@/api";
import { useSpreadsStream } from "@/hooks/useSpreadsStream";
import { analyzeSpread } from "@/utils/spreadAnalysis";
import { OptionsChainTable } from "@/components/iron-condor/OptionsChainTable";
import { SpreadAnalysis } from "@/components/iron-condor/SpreadAnalysis";
import { PlaceSpreadDialog } from "@/components/iron-condor/PlaceSpreadDialog";
import { ActiveSpreadsList } from "@/components/iron-condor/ActiveSpreadsList";
import { CloseSpreadDialog } from "@/components/iron-condor/CloseSpreadDialog";
import type {
  SpreadMode,
  IronCondorChainStrike,
  IronCondorLeg,
  IronCondorOrderLeg,
  SpreadSelectedLegs,
  ActiveSpread,
} from "@assup/shared";

const DEFAULT_SYMBOLS = ["SPX", "XSP", "RUT"];
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

function parseDte(expiration: string): number {
  if (expiration.length !== 8) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expMs = new Date(
    parseInt(expiration.slice(0, 4)),
    parseInt(expiration.slice(4, 6)) - 1,
    parseInt(expiration.slice(6, 8)),
  ).getTime();
  return Math.max(0, Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)));
}

export function IronCondorPage() {
  // Configurable symbols from settings
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);

  // Parameters
  const [symbol, setSymbol] = useState<string>("SPX");
  const [mode, setMode] = useState<SpreadMode>("put-spread");
  const [expiration, setExpiration] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);
  const [putDelta, setPutDelta] = useState(3.5);
  const [callDelta, setCallDelta] = useState(3.5);
  const [wingWidth, setWingWidth] = useState(100);

  // Selected legs
  const [selectedLegs, setSelectedLegs] = useState<SpreadSelectedLegs>({
    buyPut: null, sellPut: null, sellCall: null, buyCall: null,
  });

  // UI state
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [chainExpanded, setChainExpanded] = useState(false);

  // Active spread close
  const [closingSpread, setClosingSpread] = useState<ActiveSpread | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // When chain is collapsed, only stream selected strikes
  const streamStrikes = useMemo(() => {
    if (chainExpanded) return undefined; // full chain
    const strikes: number[] = [];
    if (selectedLegs.buyPut) strikes.push(selectedLegs.buyPut);
    if (selectedLegs.sellPut) strikes.push(selectedLegs.sellPut);
    if (selectedLegs.sellCall) strikes.push(selectedLegs.sellCall);
    if (selectedLegs.buyCall) strikes.push(selectedLegs.buyCall);
    return strikes.length > 0 ? strikes : undefined;
  }, [chainExpanded, selectedLegs]);

  // Phase 2: once legs are selected, focus dense subscription around them
  // Use a margin of wingWidth + 50 points around the outermost legs
  const focusRange = useMemo(() => {
    const strikes: number[] = [];
    if (selectedLegs.buyPut) strikes.push(selectedLegs.buyPut);
    if (selectedLegs.sellPut) strikes.push(selectedLegs.sellPut);
    if (selectedLegs.sellCall) strikes.push(selectedLegs.sellCall);
    if (selectedLegs.buyCall) strikes.push(selectedLegs.buyCall);
    if (strikes.length === 0) return undefined;
    const margin = wingWidth + 50;
    return {
      min: Math.min(...strikes) - margin,
      max: Math.max(...strikes) + margin,
    };
  }, [selectedLegs, wingWidth]);

  // Streaming data (chain only, no positions)
  const {
    chain,
    underlyingPrice,
    expirations,
    selectedExpiration: streamExpiration,
    status,
    error,
  } = useSpreadsStream(symbol, expiration, streamStrikes, focusRange);

  // Active spreads via REST endpoint (polled every 10s)
  const [spreads, setSpreads] = useState<ActiveSpread[]>([]);

  useEffect(() => {
    const fetchSpreads = () => {
      api.ironCondor.getActiveSpreads()
        .then(r => setSpreads(r.spreads))
        .catch(() => {});
    };
    fetchSpreads();
    const interval = setInterval(fetchSpreads, 10000);
    return () => clearInterval(interval);
  }, []);

  // Sync expiration from stream init event (server-selected nearest expiration)
  useEffect(() => {
    if (streamExpiration && !expiration) {
      setExpiration(streamExpiration);
    }
  }, [streamExpiration, expiration]);

  // Load symbols from settings
  useEffect(() => {
    settingsApi.get<{ symbols: string[] }>("spreads")
      .then(r => {
        if (r.value?.symbols?.length > 0) {
          setSymbols(r.value.symbols);
          setSymbol(r.value.symbols[0]);
        }
      })
      .catch(() => {}); // Use defaults
  }, []);

  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  // --- Auto-select legs based on deltas and mode ---
  // Track whether we've successfully auto-selected legs for the current expiration.
  // Retry when chain data gets populated (non-zero deltas arrive from stream).
  const autoSelectDoneRef = useRef(false);
  const prevExpirationRef = useRef<string | undefined>(undefined);

  // Count options with non-zero delta to detect when real data arrives
  const chainHasDeltas = useMemo(() => {
    return chain.some(e =>
      (e.put && e.put.delta > 0) || (e.call && e.call.delta > 0)
    );
  }, [chain]);

  useEffect(() => {
    // Reset auto-select flag when expiration or mode changes
    if (expiration !== prevExpirationRef.current) {
      autoSelectDoneRef.current = false;
      prevExpirationRef.current = expiration;
    }
  }, [expiration, mode]);

  useEffect(() => {
    // Skip if already auto-selected for this expiration or no chain data
    if (autoSelectDoneRef.current) return;
    if (chain.length === 0 || !chainHasDeltas) return;

    const newLegs: SpreadSelectedLegs = { buyPut: null, sellPut: null, sellCall: null, buyCall: null };

    if (hasPutSide) {
      const sellPutStrike = findClosestDelta(chain, putDelta, "PUT");
      if (sellPutStrike) {
        const buyPutTarget = sellPutStrike - wingWidth;
        const snappedBuyPut = chain.reduce((closest, entry) =>
          Math.abs(entry.strike - buyPutTarget) < Math.abs(closest - buyPutTarget) ? entry.strike : closest,
          chain[0]?.strike ?? buyPutTarget,
        );
        newLegs.sellPut = sellPutStrike;
        newLegs.buyPut = snappedBuyPut;
      }
    }

    if (hasCallSide) {
      const sellCallStrike = findClosestDelta(chain, callDelta, "CALL");
      if (sellCallStrike) {
        const buyCallTarget = sellCallStrike + wingWidth;
        const snappedBuyCall = chain.reduce((closest, entry) =>
          Math.abs(entry.strike - buyCallTarget) < Math.abs(closest - buyCallTarget) ? entry.strike : closest,
          chain[chain.length - 1]?.strike ?? buyCallTarget,
        );
        newLegs.sellCall = sellCallStrike;
        newLegs.buyCall = snappedBuyCall;
      }
    }

    // Only mark done if we actually found legs
    const foundLegs = (hasPutSide ? newLegs.sellPut !== null : true)
      && (hasCallSide ? newLegs.sellCall !== null : true);

    if (foundLegs) {
      autoSelectDoneRef.current = true;
      setSelectedLegs(newLegs);
    }
  }, [chain, chainHasDeltas, putDelta, callDelta, wingWidth, hasPutSide, hasCallSide]);

  // Re-run auto-select when user changes delta/wingWidth parameters
  const handleParameterChange = useCallback(() => {
    autoSelectDoneRef.current = false;
  }, []);

  // --- Client-side analysis (instant, via useMemo) ---
  const analysis = useMemo(() => {
    if (!selectedLegs.sellPut && !selectedLegs.sellCall) return null;
    if (!underlyingPrice || chain.length === 0) return null;
    if (!expiration) return null;

    // Guard: require mode-relevant legs
    if (hasPutSide && (!selectedLegs.buyPut || !selectedLegs.sellPut)) return null;
    if (hasCallSide && (!selectedLegs.sellCall || !selectedLegs.buyCall)) return null;

    const getLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL"): IronCondorLeg => {
      const entry = chain.find((c: IronCondorChainStrike) => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      return { strike, type, side, iv: option?.iv ?? 0, bid: option?.bid ?? 0, ask: option?.ask ?? 0 };
    };

    const daysToExpiry = parseDte(expiration);

    const legs: IronCondorLeg[] = [];
    if (hasPutSide) {
      legs.push(getLeg(selectedLegs.buyPut!, "PUT", "BUY"));
      legs.push(getLeg(selectedLegs.sellPut!, "PUT", "SELL"));
    }
    if (hasCallSide) {
      legs.push(getLeg(selectedLegs.sellCall!, "CALL", "SELL"));
      legs.push(getLeg(selectedLegs.buyCall!, "CALL", "BUY"));
    }

    if (legs.length === 0) return null;

    try {
      return analyzeSpread({
        underlyingPrice,
        legs,
        daysToExpiry,
        quantity,
        mode,
      });
    } catch {
      return null;
    }
  }, [chain, selectedLegs, underlyingPrice, quantity, mode, expiration, hasPutSide, hasCallSide]);

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
    setExpiration(exp);
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
  }, []);

  // --- Symbol change ---
  const handleSymbolChange = useCallback((sym: string) => {
    setSymbol(sym);
    setExpiration(undefined);
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
  }, []);

  // --- Mode change ---
  const handleModeChange = useCallback((newMode: SpreadMode) => {
    setMode(newMode);
    autoSelectDoneRef.current = false;
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
  }, []);

  const handleCloseSpread = useCallback((spread: ActiveSpread) => {
    setClosingSpread(spread);
    setCloseDialogOpen(true);
  }, []);

  // --- Build order legs ---
  const orderLegs = useMemo((): IronCondorOrderLeg[] => {
    if (chain.length === 0 || !expiration) return [];

    if (hasPutSide && (!selectedLegs.buyPut || !selectedLegs.sellPut)) return [];
    if (hasCallSide && (!selectedLegs.sellCall || !selectedLegs.buyCall)) return [];

    const makeLeg = (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL"): IronCondorOrderLeg => {
      const entry = chain.find(c => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      return { conId: option?.conId ?? 0, strike, type, side, expiration: expiration!, exchange: "SMART" };
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
  }, [chain, selectedLegs, hasPutSide, hasCallSide, expiration]);

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
      <div className="flex items-center gap-4 flex-wrap border rounded-lg p-3 bg-background/95 sticky top-[65px] md:top-[113px] z-30 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Symbol picker */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Symbol</Label>
          <div className="flex rounded-md border overflow-hidden">
            {symbols.map(sym => (
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
          <Select value={expiration ?? ""} onValueChange={handleExpirationChange}>
            <SelectTrigger className="w-[180px] h-8 text-sm">
              <SelectValue placeholder="Select expiration" />
            </SelectTrigger>
            <SelectContent>
              {expirations.map((exp: string) => (
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
              onChange={(e) => { setPutDelta(parseFloat(e.target.value) || 7); handleParameterChange(); }}
              className="w-16 h-8 text-sm text-center border-red-300 text-red-600"
            />
          )}
          {hasCallSide && (
            <Input
              type="number"
              step={0.5}
              value={callDelta}
              onChange={(e) => { setCallDelta(parseFloat(e.target.value) || 3.5); handleParameterChange(); }}
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
            onChange={(e) => { setWingWidth(parseInt(e.target.value) || 100); handleParameterChange(); }}
            className="w-16 h-8 text-sm text-center"
          />
        </div>

        <div className="flex-1" />

        {underlyingPrice > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{symbol} {underlyingPrice.toLocaleString()}</span>
          </div>
        )}

        {/* Connection status indicator */}
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "h-2 w-2 rounded-full",
            status === "connected" ? "bg-green-500" :
            status === "reconnecting" || status === "connecting" ? "bg-yellow-500" :
            "bg-red-500"
          )} />
          <span className="text-xs text-muted-foreground">
            {status === "connected" ? "Live" : status === "connecting" ? "Connecting..." : status === "reconnecting" ? "Reconnecting..." : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Active spreads */}
      <ActiveSpreadsList
        spreads={spreads}
        onClose={handleCloseSpread}
      />

      {/* Main content: stacked layout */}
      {chain.length > 0 && (
        <div className="space-y-4">
          {/* Options Chain */}
          <div className="border rounded-lg p-4">
            <OptionsChainTable
              chain={chain}
              selectedLegs={selectedLegs}
              underlyingPrice={underlyingPrice}
              onSelectLeg={handleSelectLeg}
              mode={mode}
              expanded={chainExpanded}
              onExpandedChange={setChainExpanded}
            />
          </div>

          {/* Analysis */}
          <div className="border rounded-lg p-4 bg-muted/20">
            <SpreadAnalysis
              analysis={analysis}
              selectedLegs={selectedLegs}
              chain={chain}
              underlyingPrice={underlyingPrice}
              quantity={quantity}
              onPlaceOrder={() => setOrderDialogOpen(true)}
              mode={mode}
              symbol={symbol}
              loading={chain.length > 0 && !chainHasDeltas}
            />
          </div>
        </div>
      )}

      {/* Connecting state — show analysis skeleton */}
      {status === "connecting" && chain.length === 0 && (
        <div className="border rounded-lg p-4 bg-muted/20">
          <SpreadAnalysis
            analysis={null}
            selectedLegs={selectedLegs}
            chain={[]}
            underlyingPrice={0}
            quantity={quantity}
            onPlaceOrder={() => {}}
            mode={mode}
            symbol={symbol}
            loading
          />
        </div>
      )}

      {/* Order dialog */}
      {analysis && expiration && (
        <PlaceSpreadDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          symbol={symbol}
          legs={orderLegs}
          quantity={quantity}
          netCreditMid={analysis.netCredit.mid}
          maxLoss={maxLoss}
          mode={mode}
          chain={chain}
        />
      )}

      {/* Close spread dialog */}
      <CloseSpreadDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        spread={closingSpread}
        onSuccess={() => {}}
      />
    </div>
  );
}
