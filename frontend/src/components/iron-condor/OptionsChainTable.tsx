/**
 * Options chain table for the spread builder.
 * Puts on left, strike in center, calls on right.
 * Selected legs highlighted with colored borders and labels.
 * Click behavior depends on spread mode.
 * Auto-scrolls to the primary sell leg on load.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import type { IronCondorChainStrike, SpreadSelectedLegs, SpreadMode } from "@assup/shared";

interface OptionsChainTableProps {
  chain: IronCondorChainStrike[];
  selectedLegs: SpreadSelectedLegs;
  underlyingPrice: number;
  onSelectLeg: (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => void;
  mode: SpreadMode;
}

function getLegLabel(strike: number, legs: SpreadSelectedLegs): { text: string; color: string } | null {
  if (strike === legs.buyPut) return { text: "BUY PUT (protection)", color: "text-red-500" };
  if (strike === legs.sellPut) return { text: "SELL PUT (income)", color: "text-red-700 font-bold" };
  if (strike === legs.sellCall) return { text: "SELL CALL (income)", color: "text-green-700 font-bold" };
  if (strike === legs.buyCall) return { text: "BUY CALL (protection)", color: "text-green-500" };
  return null;
}

function getLegStyle(strike: number, legs: SpreadSelectedLegs): string {
  if (strike === legs.buyPut) return "bg-red-50 border border-red-300 rounded";
  if (strike === legs.sellPut) return "bg-red-100 border-2 border-red-500 rounded";
  if (strike === legs.sellCall) return "bg-green-100 border-2 border-green-500 rounded";
  if (strike === legs.buyCall) return "bg-green-50 border border-green-300 rounded";
  return "border-b border-border";
}

function formatDelta(delta: number | undefined): string {
  if (delta == null || delta === 0) return "\u2014";
  return (delta * 100).toFixed(1);
}

function formatPrice(price: number | undefined): string {
  if (price == null || price === 0) return "\u2014";
  return price.toFixed(2);
}

function formatIV(iv: number | undefined): string {
  if (iv == null || iv === 0) return "\u2014";
  return iv.toFixed(1);
}

const GRID_COLS = "1fr 1fr 1fr 0.8fr 0.7fr 1.3fr 0.7fr 0.8fr 1fr 1fr 1fr";

const ChainRow = memo(function ChainRow({
  entry,
  selectedLegs,
  isAtMoney,
  onSelectLeg,
  mode,
  rowRef,
}: {
  entry: IronCondorChainStrike;
  selectedLegs: SpreadSelectedLegs;
  isAtMoney: boolean;
  onSelectLeg: (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => void;
  mode: SpreadMode;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  const label = getLegLabel(entry.strike, selectedLegs);
  const style = getLegStyle(entry.strike, selectedLegs);

  const prevValues = useRef({
    putBid: entry.put?.bid,
    putAsk: entry.put?.ask,
    callBid: entry.call?.bid,
    callAsk: entry.call?.ask,
  });

  const [flashCells, setFlashCells] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const flashes: Record<string, boolean> = {};
    if (prevValues.current.putBid !== entry.put?.bid) flashes.putBid = true;
    if (prevValues.current.putAsk !== entry.put?.ask) flashes.putAsk = true;
    if (prevValues.current.callBid !== entry.call?.bid) flashes.callBid = true;
    if (prevValues.current.callAsk !== entry.call?.ask) flashes.callAsk = true;

    prevValues.current = {
      putBid: entry.put?.bid,
      putAsk: entry.put?.ask,
      callBid: entry.call?.bid,
      callAsk: entry.call?.ask,
    };

    if (Object.keys(flashes).length > 0) {
      setFlashCells(flashes);
      const timer = setTimeout(() => setFlashCells({}), 300);
      return () => clearTimeout(timer);
    }
  }, [entry.put?.bid, entry.put?.ask, entry.call?.bid, entry.call?.ask]);

  const putActive = mode === "put-spread" || mode === "iron-condor";
  const callActive = mode === "call-spread" || mode === "iron-condor";

  const handlePutClick = useCallback(() => {
    if (!putActive) return;
    if (selectedLegs.sellPut && entry.strike < selectedLegs.sellPut) {
      onSelectLeg(entry.strike, "PUT", "BUY");
    } else {
      onSelectLeg(entry.strike, "PUT", "SELL");
    }
  }, [entry.strike, selectedLegs.sellPut, onSelectLeg, putActive]);

  const handleCallClick = useCallback(() => {
    if (!callActive) return;
    if (selectedLegs.sellCall && entry.strike > selectedLegs.sellCall) {
      onSelectLeg(entry.strike, "CALL", "BUY");
    } else {
      onSelectLeg(entry.strike, "CALL", "SELL");
    }
  }, [entry.strike, selectedLegs.sellCall, onSelectLeg, callActive]);

  const putCellClass = putActive
    ? "cursor-pointer hover:bg-red-100/60 rounded px-1"
    : "opacity-30 px-1";
  const callCellClass = callActive
    ? "cursor-pointer hover:bg-green-100/60 rounded px-1"
    : "opacity-30 px-1";

  return (
    <div ref={rowRef} className={`my-0.5 ${style}`}>
      <div className="grid gap-0.5 py-2 px-3 tabular-nums" style={{ gridTemplateColumns: GRID_COLS }}>
        {/* Put side: Bid, Ask, Mid, Delta, IV */}
        <div className={`text-right ${putCellClass}`} onClick={handlePutClick}>
          <span className={`transition-colors duration-300 rounded px-0.5${flashCells.putBid ? " bg-blue-500/20" : ""}`}>
            {formatPrice(entry.put?.bid)}
          </span>
        </div>
        <div className={`text-right ${putCellClass}`} onClick={handlePutClick}>
          <span className={`transition-colors duration-300 rounded px-0.5${flashCells.putAsk ? " bg-blue-500/20" : ""}`}>
            {formatPrice(entry.put?.ask)}
          </span>
        </div>
        <div className={`text-right font-medium ${putCellClass}`} onClick={handlePutClick}>
          {formatPrice(entry.put?.mid)}
        </div>
        <div className={`text-right text-red-600 ${putCellClass}`} onClick={handlePutClick}>
          {formatDelta(entry.put?.delta)}
        </div>
        <div className={`text-right text-muted-foreground ${!putActive ? "opacity-30" : ""}`}>
          {formatIV(entry.put?.iv)}
        </div>

        {/* Strike */}
        <div className={`text-center font-semibold ${isAtMoney ? "text-amber-700 bg-amber-50 rounded" : ""}`}>
          {entry.strike}
          {isAtMoney && " \u25C6"}
        </div>

        {/* Call side: IV, Delta, Mid, Bid, Ask */}
        <div className={`text-muted-foreground ${!callActive ? "opacity-30" : ""}`}>
          {formatIV(entry.call?.iv)}
        </div>
        <div className={`text-green-600 ${callCellClass}`} onClick={handleCallClick}>
          {formatDelta(entry.call?.delta)}
        </div>
        <div className={`font-medium ${callCellClass}`} onClick={handleCallClick}>
          {formatPrice(entry.call?.mid)}
        </div>
        <div className={callCellClass} onClick={handleCallClick}>
          <span className={`transition-colors duration-300 rounded px-0.5${flashCells.callBid ? " bg-blue-500/20" : ""}`}>
            {formatPrice(entry.call?.bid)}
          </span>
        </div>
        <div className={callCellClass} onClick={handleCallClick}>
          <span className={`transition-colors duration-300 rounded px-0.5${flashCells.callAsk ? " bg-blue-500/20" : ""}`}>
            {formatPrice(entry.call?.ask)}
          </span>
        </div>
      </div>
      {label && (
        <div className={`text-xs px-3 pb-1 ${label.color}`}>
          {label.text.includes("SELL") ? "\u25BC" : "\u25B2"} {label.text}
        </div>
      )}
    </div>
  );
});

// --- Minimap: Sublime-style sliding window showing all legs ---
function ChainMinimap({
  chain,
  selectedLegs,
  underlyingPrice,
  scrollRef,
  mode,
}: {
  chain: IronCondorChainStrike[];
  selectedLegs: SpreadSelectedLegs;
  underlyingPrice: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  mode: SpreadMode;
}) {
  const minimapRef = useRef<HTMLDivElement>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0.2);

  // Track scroll position of the main chain
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= 0) return;
      setViewportTop(scrollTop / scrollHeight);
      setViewportHeight(clientHeight / scrollHeight);
    };
    update();
    el.addEventListener("scroll", update);
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef, chain.length]);

  // Click minimap to scroll
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const mm = minimapRef.current;
    if (!el || !mm) return;
    const rect = mm.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const targetScroll = clickRatio * el.scrollHeight - el.clientHeight / 2;
    el.scrollTo({ top: targetScroll, behavior: "smooth" });
  }, [scrollRef]);

  if (chain.length === 0) return null;

  const minStrike = chain[0].strike;
  const maxStrike = chain[chain.length - 1].strike;
  const range = maxStrike - minStrike || 1;

  const strikeToPercent = (s: number) => ((s - minStrike) / range) * 100;

  const legMarkers: Array<{ strike: number; color: string; label: string; side: "left" | "right" }> = [];
  if (selectedLegs.buyPut) legMarkers.push({ strike: selectedLegs.buyPut, color: "bg-red-400", label: "BP", side: "left" });
  if (selectedLegs.sellPut) legMarkers.push({ strike: selectedLegs.sellPut, color: "bg-red-600", label: "SP", side: "left" });
  if (selectedLegs.sellCall) legMarkers.push({ strike: selectedLegs.sellCall, color: "bg-green-600", label: "SC", side: "right" });
  if (selectedLegs.buyCall) legMarkers.push({ strike: selectedLegs.buyCall, color: "bg-green-400", label: "BC", side: "right" });

  // Shade the zone between sell legs (profit zone for iron condor)
  const hasProfitZone = selectedLegs.sellPut && selectedLegs.sellCall;
  const profitZoneTop = selectedLegs.sellPut ? strikeToPercent(selectedLegs.sellPut) : 0;
  const profitZoneBottom = selectedLegs.sellCall ? strikeToPercent(selectedLegs.sellCall) : 100;

  return (
    <div
      ref={minimapRef}
      className="relative w-10 bg-muted/40 rounded border cursor-pointer flex-shrink-0"
      onClick={handleMinimapClick}
      title="Click to navigate"
    >
      {/* ATM marker */}
      <div
        className="absolute left-0 right-0 border-t border-dashed border-amber-500/60"
        style={{ top: `${strikeToPercent(underlyingPrice)}%` }}
      />

      {/* Profit zone */}
      {hasProfitZone && mode === "iron-condor" && (
        <div
          className="absolute left-0 right-0 bg-emerald-500/10"
          style={{
            top: `${profitZoneTop}%`,
            height: `${profitZoneBottom - profitZoneTop}%`,
          }}
        />
      )}

      {/* Leg markers */}
      {legMarkers.map(m => (
        <div
          key={m.label}
          className="absolute flex items-center gap-0.5"
          style={{
            top: `${strikeToPercent(m.strike)}%`,
            transform: "translateY(-50%)",
            ...(m.side === "left" ? { left: 0 } : { right: 0 }),
          }}
        >
          {m.side === "left" && (
            <>
              <div className={`w-1.5 h-3 ${m.color} rounded-r`} />
              <span className="text-[8px] font-bold text-muted-foreground">{m.label}</span>
            </>
          )}
          {m.side === "right" && (
            <>
              <span className="text-[8px] font-bold text-muted-foreground">{m.label}</span>
              <div className={`w-1.5 h-3 ${m.color} rounded-l`} />
            </>
          )}
        </div>
      ))}

      {/* Viewport window */}
      <div
        className="absolute left-0 right-0 border border-foreground/30 bg-foreground/5 rounded"
        style={{
          top: `${viewportTop * 100}%`,
          height: `${Math.max(viewportHeight * 100, 5)}%`,
        }}
      />
    </div>
  );
}

export function OptionsChainTable({ chain, selectedLegs, underlyingPrice, onSelectLeg, mode }: OptionsChainTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sellRowRef = useRef<HTMLDivElement>(null);

  const atMoneyStrike = chain.reduce((closest: number, entry: IronCondorChainStrike) => {
    return Math.abs(entry.strike - underlyingPrice) < Math.abs(closest - underlyingPrice)
      ? entry.strike
      : closest;
  }, chain[0]?.strike ?? 0);

  // Determine primary sell strike to scroll to
  const scrollTarget = mode === "put-spread"
    ? selectedLegs.sellPut
    : mode === "call-spread"
      ? selectedLegs.sellCall
      : selectedLegs.sellPut ?? selectedLegs.sellCall;

  const scrollToLegs = useCallback(() => {
    if (sellRowRef.current) {
      sellRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  // Auto-scroll to the sell leg when chain loads or sell strike changes
  useEffect(() => {
    if (sellRowRef.current && scrollRef.current) {
      sellRowRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [scrollTarget]);

  const putActive = mode === "put-spread" || mode === "iron-condor";
  const callActive = mode === "call-spread" || mode === "iron-condor";

  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <h3 className="text-sm font-semibold">Options Chain</h3>
          <span className="text-xs text-muted-foreground">{chain.length} strikes</span>
        </button>
        {expanded && scrollTarget && (
          <button
            onClick={scrollToLegs}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
            title="Scroll to selected legs"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Locate
          </button>
        )}
      </div>

      {expanded && (
        <>
          {/* Header */}
          <div className="grid gap-0.5 px-3 text-xs text-muted-foreground uppercase font-medium pb-2 border-b" style={{ gridTemplateColumns: GRID_COLS }}>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Bid</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Ask</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Mid</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Delta</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>IV</div>
            <div className="text-center font-semibold text-foreground">Strike</div>
            <div className={!callActive ? "opacity-30" : ""}>IV</div>
            <div className={!callActive ? "opacity-30" : ""}>Delta</div>
            <div className={!callActive ? "opacity-30" : ""}>Mid</div>
            <div className={!callActive ? "opacity-30" : ""}>Bid</div>
            <div className={!callActive ? "opacity-30" : ""}>Ask</div>
          </div>

          {/* Chain + Minimap side by side */}
          <div className="flex gap-1">
            {/* Scrollable chain */}
            <div ref={scrollRef} className="flex-1 max-h-[560px] overflow-y-auto">
              {chain.map((entry: IronCondorChainStrike) => (
                <ChainRow
                  key={entry.strike}
                  entry={entry}
                  selectedLegs={selectedLegs}
                  isAtMoney={entry.strike === atMoneyStrike}
                  onSelectLeg={onSelectLeg}
                  mode={mode}
                  rowRef={entry.strike === scrollTarget ? sellRowRef : undefined}
                />
              ))}
            </div>

            {/* Minimap */}
            <ChainMinimap
              chain={chain}
              selectedLegs={selectedLegs}
              underlyingPrice={underlyingPrice}
              scrollRef={scrollRef}
              mode={mode}
            />
          </div>
        </>
      )}
    </div>
  );
}
