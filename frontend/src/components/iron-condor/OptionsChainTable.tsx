/**
 * Options chain table for the spread builder.
 * Puts on left, strike in center, calls on right.
 * Selected legs highlighted with colored borders and labels.
 * Click behavior depends on spread mode.
 */

import { memo, useCallback } from "react";
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
}: {
  entry: IronCondorChainStrike;
  selectedLegs: SpreadSelectedLegs;
  isAtMoney: boolean;
  onSelectLeg: (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => void;
  mode: SpreadMode;
}) {
  const label = getLegLabel(entry.strike, selectedLegs);
  const style = getLegStyle(entry.strike, selectedLegs);

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
    <div className={`my-0.5 ${style}`}>
      <div className="grid gap-1 py-1 px-1 text-xs" style={{ gridTemplateColumns: "50px 50px 45px 40px 70px 40px 45px 50px 50px" }}>
        {/* Put side */}
        <div className={`text-right ${putCellClass}`} onClick={handlePutClick}>
          {formatPrice(entry.put?.bid)}
        </div>
        <div className={`text-right ${putCellClass}`} onClick={handlePutClick}>
          {formatPrice(entry.put?.ask)}
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
          {formatPrice(entry.call?.bid)}
        </div>
        <div className={callCellClass} onClick={handleCallClick}>
          {formatPrice(entry.call?.ask)}
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
  const atMoneyStrike = chain.reduce((closest: number, entry: IronCondorChainStrike) => {
    return Math.abs(entry.strike - underlyingPrice) < Math.abs(closest - underlyingPrice)
      ? entry.strike
      : closest;
  }, chain[0]?.strike ?? 0);

  const putActive = mode === "put-spread" || mode === "iron-condor";
  const callActive = mode === "call-spread" || mode === "iron-condor";

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold mb-1">Options Chain</h3>
        <p className="text-xs text-muted-foreground">
          {putActive && <>Click the <span className="text-red-600 font-medium">put side</span> to move put legs. </>}
          {callActive && <>Click the <span className="text-green-600 font-medium">call side</span> to move call legs. </>}
          Strikes are auto-selected based on your target deltas above.
        </p>
      </div>

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

      {/* Scrollable chain */}
      <div className="max-h-[500px] overflow-y-auto">
        {chain.map((entry: IronCondorChainStrike) => (
          <ChainRow
            key={entry.strike}
            entry={entry}
            selectedLegs={selectedLegs}
            isAtMoney={entry.strike === atMoneyStrike}
            onSelectLeg={onSelectLeg}
            mode={mode}
          />
        ))}
      </div>
    </div>
  );
}
