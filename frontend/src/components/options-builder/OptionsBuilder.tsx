/**
 * Reusable options builder component extracted from IronCondorPage.
 * Supports four strategy modes:
 * - "single": select individual option contracts for ordering
 * - "put-spread": build put vertical spreads
 * - "call-spread": build call vertical spreads
 * - "iron-condor": build iron condors (put + call spreads)
 *
 * Handles streaming, auto-selection, chain display, analysis, and order placement.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/api";
import { useSpreadsStream } from "@/hooks/useSpreadsStream";
import { analyzeSpread } from "@/utils/spreadAnalysis";
import { OptionsChainTable } from "@/components/iron-condor/OptionsChainTable";
import { SpreadAnalysis } from "@/components/iron-condor/SpreadAnalysis";
import { PlaceSpreadDialog } from "@/components/iron-condor/PlaceSpreadDialog";
import type {
  SpreadMode,
  StrategyMode,
  IronCondorChainStrike,
  IronCondorLeg,
  IronCondorOrderLeg,
  SpreadSelectedLegs,
} from "@assup/shared";

// --- Props ---

/** Externally-supplied strike/sizing recommendation (from strategy advisor) */
export interface StrategyRecommendation {
  shortStrike: number;
  longStrike: number;
  wingWidth: number;
  quantity: number;
}

export interface OptionsBuilderProps {
  symbol: string;
  allowedModes?: StrategyMode[];
  defaultMode?: StrategyMode;
  onOrderPlaced?: () => void;
  onClose?: () => void;
  /** When set, overrides delta-based auto-selection with specific strikes */
  strategyRecommendation?: StrategyRecommendation | null;
  /** Pause the SSE stream (e.g. when a modal needs its own stream) */
  paused?: boolean;
}

// --- Helpers ---

const STRATEGY_MODES: { value: StrategyMode; label: string }[] = [
  { value: "single", label: "Single" },
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

const DEFAULT_UPDATE_INTERVAL_MS = 2000;

/** Derive the SpreadMode for streaming based on strategy mode */
function deriveSpreadMode(strategyMode: StrategyMode): SpreadMode {
  if (strategyMode === "put-spread") return "put-spread";
  if (strategyMode === "call-spread") return "call-spread";
  // "single" and "iron-condor": subscribe to both sides
  return "iron-condor";
}

// --- Component ---

export function OptionsBuilder({
  symbol,
  allowedModes,
  defaultMode = "iron-condor",
  onOrderPlaced,
  onClose,
  strategyRecommendation,
  paused = false,
}: OptionsBuilderProps) {
  // Strategy mode
  const [strategyMode, setStrategyMode] = useState<StrategyMode>(defaultMode);

  // Parameters
  const [expiration, setExpiration] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);
  const [putDelta, setPutDelta] = useState(4.5);
  const [callDelta, setCallDelta] = useState(4.5);
  const [wingWidth, setWingWidth] = useState(30);
  const [strikeRange, setStrikeRange] = useState<number | undefined>(undefined);

  // Selected legs (for vertical/iron-condor)
  const [selectedLegs, setSelectedLegs] = useState<SpreadSelectedLegs>({
    buyPut: null, sellPut: null, sellCall: null, buyCall: null,
  });

  // Single-leg selection state
  const [selectedSingleLeg, setSelectedSingleLeg] = useState<{
    strike: number;
    type: "PUT" | "CALL";
    conId: number;
    bid: number;
    ask: number;
    mid: number;
    delta: number;
  } | null>(null);

  // UI state
  const [builderActive, setBuilderActive] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [chainExpanded, setChainExpanded] = useState(false);
  const [singleOrderLoading, setSingleOrderLoading] = useState(false);
  const [singleOrderError, setSingleOrderError] = useState<string | null>(null);

  // Derived spread mode for streaming
  const spreadMode = deriveSpreadMode(strategyMode);

  // For spread modes, which sides are active
  const hasPutSide = strategyMode === "iron-condor" || strategyMode === "put-spread";
  const hasCallSide = strategyMode === "iron-condor" || strategyMode === "call-spread";
  const isSpreadMode = strategyMode !== "single";

  // Phase 2: once legs are selected, focus dense subscription around them
  const focusRange = useMemo(() => {
    if (!isSpreadMode) return undefined;
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
  }, [selectedLegs, wingWidth, isSpreadMode]);

  // Pre-fetch expirations on mount (cached on backend)
  const [prefetchedExpirations, setPrefetchedExpirations] = useState<string[]>([]);
  useEffect(() => {
    const expirationAtStart = expiration;
    api.ironCondor.getExpirations(symbol)
      .then(r => {
        setPrefetchedExpirations(r.expirations);
        if (!expirationAtStart) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const nearest = r.expirations.find(exp => {
            if (exp.length !== 8) return false;
            const expMs = new Date(
              parseInt(exp.slice(0, 4)),
              parseInt(exp.slice(4, 6)) - 1,
              parseInt(exp.slice(6, 8)),
            ).getTime();
            return Math.floor((expMs - today.getTime()) / (1000 * 60 * 60 * 24)) >= 1;
          });
          if (nearest) setExpiration(prev => prev ?? nearest);
        }
      })
      .catch(() => {});
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // Streaming data
  const {
    chain,
    underlyingPrice,
    expirations: streamExpirations,
    selectedExpiration: streamExpiration,
    status,
    error,
    refocusedCount,
    scouting,
    reconnect,
  } = useSpreadsStream(
    symbol,
    expiration,
    undefined, // no strike restriction
    focusRange,
    isSpreadMode && hasPutSide ? putDelta : undefined,
    isSpreadMode && hasCallSide ? callDelta : undefined,
    wingWidth,
    spreadMode,
    DEFAULT_UPDATE_INTERVAL_MS,
    builderActive && !paused,
    strikeRange,
  );

  // Merge expirations: prefer stream data when available, fall back to pre-fetched
  const expirations = streamExpirations.length > 0 ? streamExpirations : prefetchedExpirations;

  // Sync expiration from stream init event
  useEffect(() => {
    if (streamExpiration && !expiration) {
      setExpiration(streamExpiration);
    }
  }, [streamExpiration, expiration]);

  // --- Auto-select legs based on deltas (only in spread modes) ---
  const autoSelectDoneRef = useRef(false);
  const expScrollRef = useRef<HTMLDivElement>(null);
  const prevExpirationRef = useRef<string | undefined>(undefined);

  const chainHasDeltas = useMemo(() => {
    return chain.some(e =>
      (e.put && e.put.delta > 0) || (e.call && e.call.delta > 0)
    );
  }, [chain]);

  useEffect(() => {
    if (expiration !== prevExpirationRef.current) {
      autoSelectDoneRef.current = false;
      prevExpirationRef.current = expiration;
    }
  }, [expiration]);

  // Re-run auto-select on refocus
  useEffect(() => {
    if (refocusedCount > 0) {
      autoSelectDoneRef.current = false;
    }
  }, [refocusedCount]);

  useEffect(() => {
    // Skip auto-select in single mode
    if (!isSpreadMode) return;
    if (autoSelectDoneRef.current) return;
    if (chain.length === 0 || !chainHasDeltas) return;
    if (scouting) return;

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

    const foundLegs = (hasPutSide ? newLegs.sellPut !== null : true)
      && (hasCallSide ? newLegs.sellCall !== null : true);

    if (foundLegs) {
      autoSelectDoneRef.current = true;
      setSelectedLegs(newLegs);
    }
  }, [chain, chainHasDeltas, scouting, putDelta, callDelta, wingWidth, hasPutSide, hasCallSide, isSpreadMode]);

  // --- Apply strategy recommendation (overrides delta-based auto-select) ---
  useEffect(() => {
    if (!strategyRecommendation) return;
    if (chain.length === 0) return;

    const { shortStrike, longStrike, wingWidth: recWingWidth, quantity: recQuantity } = strategyRecommendation;

    // Snap to nearest available strikes in the chain
    const snapToChain = (target: number) =>
      chain.reduce((closest, entry) =>
        Math.abs(entry.strike - target) < Math.abs(closest - target) ? entry.strike : closest,
        chain[0]?.strike ?? target,
      );

    const sellPut = snapToChain(shortStrike);
    const buyPut = snapToChain(longStrike);

    setSelectedLegs(prev => ({ ...prev, sellPut, buyPut }));
    setWingWidth(recWingWidth);
    setQuantity(recQuantity);
    autoSelectDoneRef.current = true;

    // Ensure put-spread mode
    if (strategyMode !== "put-spread") setStrategyMode("put-spread");
  }, [strategyRecommendation, chain]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleParameterChange = useCallback(() => {
    autoSelectDoneRef.current = false;
  }, []);

  // --- Client-side analysis (only for spread modes) ---
  const analysis = useMemo(() => {
    if (!isSpreadMode) return null;
    if (!selectedLegs.sellPut && !selectedLegs.sellCall) return null;
    if (!underlyingPrice || chain.length === 0) return null;
    if (!expiration) return null;

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

    // Determine spread mode for analysis
    const analysisMode: SpreadMode = deriveSpreadMode(strategyMode);

    try {
      return analyzeSpread({
        underlyingPrice,
        legs,
        daysToExpiry,
        quantity,
        mode: analysisMode,
      });
    } catch {
      return null;
    }
  }, [chain, selectedLegs, underlyingPrice, quantity, strategyMode, expiration, hasPutSide, hasCallSide, isSpreadMode]);

  // --- Leg selection handler ---
  const handleSelectLeg = useCallback((strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => {
    if (!isSpreadMode) {
      // Single mode: select the clicked strike as a single leg for ordering
      const entry = chain.find(c => c.strike === strike);
      const option = type === "PUT" ? entry?.put : entry?.call;
      if (option) {
        setSelectedSingleLeg({
          strike,
          type,
          conId: option.conId,
          bid: option.bid,
          ask: option.ask,
          mid: option.mid,
          delta: option.delta,
        });
      }
      return;
    }

    // Spread modes: auto-wing logic
    setSelectedLegs(prev => {
      if (type === "PUT" && side === "SELL") {
        const buyTarget = strike - wingWidth;
        const buyPut = chain.reduce(
          (closest, entry) => Math.abs(entry.strike - buyTarget) < Math.abs(closest - buyTarget) ? entry.strike : closest,
          chain[0]?.strike ?? buyTarget,
        );
        return { ...prev, sellPut: strike, buyPut };
      }
      if (type === "CALL" && side === "SELL") {
        const buyTarget = strike + wingWidth;
        const buyCall = chain.reduce(
          (closest, entry) => Math.abs(entry.strike - buyTarget) < Math.abs(closest - buyTarget) ? entry.strike : closest,
          chain[chain.length - 1]?.strike ?? buyTarget,
        );
        return { ...prev, sellCall: strike, buyCall };
      }
      if (type === "PUT" && side === "BUY") return { ...prev, buyPut: strike };
      if (type === "CALL" && side === "BUY") return { ...prev, buyCall: strike };
      return prev;
    });
  }, [chain, wingWidth, isSpreadMode]);

  // --- Expiration change ---
  const handleExpirationChange = useCallback((exp: string) => {
    setExpiration(exp);
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
    setSelectedSingleLeg(null);
  }, []);

  // --- Strategy mode change ---
  const handleStrategyModeChange = useCallback((newMode: StrategyMode) => {
    setStrategyMode(newMode);
    autoSelectDoneRef.current = false;
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
    setSelectedSingleLeg(null);
  }, []);

  const handleReload = useCallback(() => {
    autoSelectDoneRef.current = false;
    setSelectedLegs({ buyPut: null, sellPut: null, sellCall: null, buyCall: null });
    setSelectedSingleLeg(null);
    reconnect();
  }, [reconnect]);

  // --- Single-leg order placement ---
  const handlePlaceSingleOrder = useCallback(async (action: "BUY" | "SELL") => {
    if (!selectedSingleLeg || !expiration) return;
    setSingleOrderLoading(true);
    setSingleOrderError(null);
    try {
      await api.ironCondor.placeSingleOrder({
        symbol,
        conId: selectedSingleLeg.conId,
        expiration,
        strike: selectedSingleLeg.strike,
        right: selectedSingleLeg.type === "PUT" ? "P" : "C",
        action,
        quantity,
        limitPrice: action === "SELL" ? selectedSingleLeg.bid : selectedSingleLeg.ask,
      });
      setSelectedSingleLeg(null);
      onOrderPlaced?.();
    } catch (err: unknown) {
      setSingleOrderError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSingleOrderLoading(false);
    }
  }, [selectedSingleLeg, expiration, symbol, quantity, onOrderPlaced]);

  // --- Build order legs (for spread/iron-condor order dialog) ---
  const orderLegs = useMemo((): IronCondorOrderLeg[] => {
    if (!isSpreadMode) return [];
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
  }, [chain, selectedLegs, hasPutSide, hasCallSide, expiration, isSpreadMode]);

  // Parse expiration for display
  const parseExpiration = (exp: string) => {
    if (exp.length !== 8) return { label: exp, dte: 0 };
    const d = new Date(parseInt(exp.slice(0, 4)), parseInt(exp.slice(4, 6)) - 1, parseInt(exp.slice(6, 8)));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { label, dte };
  };

  // Max loss for order dialog
  const maxLoss = analysis
    ? Math.max(...[analysis.maxLossPut, analysis.maxLossCall].filter((v): v is number => v != null))
    : 0;

  // Determine the SpreadMode to pass to sub-components for spread modes
  const displayMode: SpreadMode = deriveSpreadMode(strategyMode);

  // Filter allowed strategy modes
  const availableModes = allowedModes
    ? STRATEGY_MODES.filter(m => allowedModes.includes(m.value))
    : STRATEGY_MODES;

  return (
    <div className="space-y-4">
      {/* Configuration bar */}
      <div className={`flex items-center gap-4 flex-wrap border rounded-lg p-3 bg-background/95 sticky z-30 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${onClose ? "top-0" : "top-[65px] md:top-[113px]"}`}>
        {/* Strategy mode picker */}
        {availableModes.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-[10px] uppercase text-muted-foreground">Mode</Label>
            <div className="flex rounded-md border overflow-hidden">
              {availableModes.map(m => (
                <button
                  key={m.value}
                  onClick={() => handleStrategyModeChange(m.value)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    strategyMode === m.value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity */}
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

        {/* Delta inputs (only for spread modes) */}
        {isSpreadMode && (
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
        )}

        {/* Wing width (only for spread modes) */}
        {isSpreadMode && (
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
        )}

        {/* Strike range (percentage around underlying price) */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] uppercase text-muted-foreground">Range %</Label>
          <Input
            type="number"
            step={5}
            min={5}
            max={100}
            value={strikeRange ?? ""}
            placeholder="auto"
            onChange={(e) => setStrikeRange(e.target.value ? parseInt(e.target.value) || 30 : undefined)}
            className="w-16 h-8 text-sm text-center"
          />
        </div>

        <div className="flex-1" />

        {/* Close button (if onClose provided) */}
        {onClose && builderActive && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}

        {builderActive && (
          <>
            <button
              onClick={handleReload}
              disabled={status === "connecting"}
              className="p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
              title="Reload chain & re-select legs"
            >
              <RefreshCw className={cn("h-4 w-4", status === "connecting" && "animate-spin")} />
            </button>

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
          </>
        )}
      </div>

      {/* Expiration selector */}
      {expirations.length > 0 && (() => {
        const scrollRef = expScrollRef;
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
              className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {expirations.map((exp: string) => {
                const { label, dte } = parseExpiration(exp);
                const selected = exp === expiration;
                return (
                  <button
                    key={exp}
                    onClick={() => handleExpirationChange(exp)}
                    className={cn(
                      "shrink-0 px-2 py-1 rounded-md border text-xs transition-colors whitespace-nowrap",
                      selected
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:border-primary/50 hover:bg-muted text-muted-foreground"
                    )}
                  >
                    {label} · {dte}d
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: 200, behavior: "smooth" })}
              className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        );
      })()}

      {/* Error */}
      {builderActive && error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Start builder button */}
      {!builderActive && (
        <Button
          variant="outline"
          className="w-full py-6 text-muted-foreground hover:text-foreground"
          onClick={() => setBuilderActive(true)}
        >
          <Play className="h-4 w-4 mr-2" />
          Open Options Builder
        </Button>
      )}

      {/* Main content */}
      {builderActive && chain.length > 0 && (
        <div className="space-y-4">
          {/* Options Chain */}
          <div className="border rounded-lg p-4">
            <OptionsChainTable
              chain={chain}
              selectedLegs={isSpreadMode ? selectedLegs : {
                buyPut: null,
                sellPut: selectedSingleLeg?.type === "PUT" ? selectedSingleLeg.strike : null,
                sellCall: selectedSingleLeg?.type === "CALL" ? selectedSingleLeg.strike : null,
                buyCall: null,
              }}
              underlyingPrice={underlyingPrice}
              onSelectLeg={handleSelectLeg}
              mode={displayMode}
              expanded={chainExpanded}
              onExpandedChange={setChainExpanded}
              maxHeight={onClose ? "calc(92vh - 280px)" : undefined}
            />
          </div>

          {/* Spread Analysis (for vertical/iron-condor) */}
          {isSpreadMode && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <SpreadAnalysis
                analysis={analysis}
                selectedLegs={selectedLegs}
                chain={chain}
                underlyingPrice={underlyingPrice}
                quantity={quantity}
                onPlaceOrder={() => setOrderDialogOpen(true)}
                mode={displayMode}
                symbol={symbol}
                loading={chain.length > 0 && !chainHasDeltas}
              />
            </div>
          )}

          {/* Single-leg display (for single mode) */}
          {!isSpreadMode && selectedSingleLeg && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">
                    {symbol} {selectedSingleLeg.strike} {selectedSingleLeg.type}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Bid: {selectedSingleLeg.bid.toFixed(2)}</span>
                    <span>Ask: {selectedSingleLeg.ask.toFixed(2)}</span>
                    <span>Mid: {selectedSingleLeg.mid.toFixed(2)}</span>
                    <span>Delta: {(selectedSingleLeg.delta * 100).toFixed(1)}</span>
                  </div>
                  {expiration && (
                    <div className="text-xs text-muted-foreground">
                      Exp: {parseExpiration(expiration).label} ({parseExpiration(expiration).dte} DTE) | Qty: {quantity}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => handlePlaceSingleOrder("BUY")}
                    disabled={singleOrderLoading}
                  >
                    Buy @ {selectedSingleLeg.ask.toFixed(2)}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => handlePlaceSingleOrder("SELL")}
                    disabled={singleOrderLoading}
                  >
                    Sell @ {selectedSingleLeg.bid.toFixed(2)}
                  </Button>
                </div>
              </div>
              {singleOrderError && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription>{singleOrderError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}

      {/* Connecting state */}
      {builderActive && status === "connecting" && chain.length === 0 && isSpreadMode && (
        <div className="border rounded-lg p-4 bg-muted/20">
          <SpreadAnalysis
            analysis={null}
            selectedLegs={selectedLegs}
            chain={[]}
            underlyingPrice={0}
            quantity={quantity}
            onPlaceOrder={() => {}}
            mode={displayMode}
            symbol={symbol}
            loading
          />
        </div>
      )}

      {/* Spread Order dialog */}
      {isSpreadMode && analysis && expiration && (
        <PlaceSpreadDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          symbol={symbol}
          legs={orderLegs}
          quantity={quantity}
          netCreditMid={analysis.netCredit.mid}
          maxLoss={maxLoss}
          mode={displayMode}
          chain={chain}
          onSuccess={onOrderPlaced}
        />
      )}
    </div>
  );
}
