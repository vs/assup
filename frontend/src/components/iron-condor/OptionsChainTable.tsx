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
    ? "cursor-pointer hover:bg-red-100/60 rounded px-0.5"
    : "opacity-30 px-0.5";
  const callCellClass = callActive
    ? "cursor-pointer hover:bg-green-100/60 rounded px-0.5"
    : "opacity-30 px-0.5";

  return (
    <div ref={rowRef} className={`my-0.5 ${style}`}>
      <div className="grid gap-1 py-1 px-1 text-xs" style={{ gridTemplateColumns: "50px 50px 45px 40px 70px 40px 45px 50px 50px" }}>
        {/* Put side */}
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

        {/* Call side */}
        <div className={`text-muted-foreground ${!callActive ? "opacity-30" : ""}`}>
          {formatIV(entry.call?.iv)}
        </div>
        <div className={`text-green-600 ${callCellClass}`} onClick={handleCallClick}>
          {formatDelta(entry.call?.delta)}
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
        <div className={`text-[10px] px-2 pb-1 ${label.color}`}>
          {label.text.includes("SELL") ? "\u25BC" : "\u25B2"} {label.text}
        </div>
      )}
    </div>
  );
});

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

  const scrollToSellRow = useCallback(() => {
    if (sellRowRef.current) {
      sellRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  // Auto-scroll to the sell leg when chain loads or sell strike changes
  useEffect(() => {
    if (sellRowRef.current && scrollRef.current) {
      sellRowRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [scrollTarget, chain]);

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
            onClick={scrollToSellRow}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
            title="Scroll to recommended strike"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Locate
          </button>
        )}
      </div>

      {expanded && (
        <>
          <p className="text-xs text-muted-foreground mb-2 ml-6">
            {putActive && <>Click the <span className="text-red-600 font-medium">put side</span> to move put legs. </>}
            {callActive && <>Click the <span className="text-green-600 font-medium">call side</span> to move call legs. </>}
          </p>

          {/* Header */}
          <div className="grid gap-1 px-1 text-[10px] text-muted-foreground uppercase font-medium pb-1 border-b" style={{ gridTemplateColumns: "50px 50px 45px 40px 70px 40px 45px 50px 50px" }}>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Bid</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Ask</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>Delta</div>
            <div className={`text-right ${!putActive ? "opacity-30" : ""}`}>IV</div>
            <div className="text-center font-semibold text-foreground">Strike</div>
            <div className={!callActive ? "opacity-30" : ""}>IV</div>
            <div className={!callActive ? "opacity-30" : ""}>Delta</div>
            <div className={!callActive ? "opacity-30" : ""}>Bid</div>
            <div className={!callActive ? "opacity-30" : ""}>Ask</div>
          </div>
          <div className="flex mb-1">
            {putActive && <div className="flex-1 text-center text-[10px] font-semibold text-red-600">{"\u2190"} PUTS (click to set put legs)</div>}
            {!putActive && <div className="flex-1" />}
            <div className="w-[70px]" />
            {callActive && <div className="flex-1 text-center text-[10px] font-semibold text-green-600">CALLS (click to set call legs) {"\u2192"}</div>}
            {!callActive && <div className="flex-1" />}
          </div>

          {/* Scrollable chain — ~12 rows visible */}
          <div ref={scrollRef} className="max-h-[360px] overflow-y-auto">
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
        </>
      )}
    </div>
  );
}
