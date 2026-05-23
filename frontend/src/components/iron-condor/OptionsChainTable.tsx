/**
 * Options chain table for the iron condor builder.
 * Puts on left, strike in center, calls on right.
 * Selected legs highlighted with colored borders and labels.
 */

import { memo, useCallback } from "react";
import type { IronCondorChainStrike, IronCondorSelectedLegs } from "@assup/shared";

interface OptionsChainTableProps {
  chain: IronCondorChainStrike[];
  selectedLegs: IronCondorSelectedLegs;
  underlyingPrice: number;
  onSelectLeg: (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => void;
}

function getLegLabel(strike: number, legs: IronCondorSelectedLegs): string | null {
  if (strike === legs.buyPut) return "BUY PUT (wing)";
  if (strike === legs.sellPut) return "SELL PUT (short)";
  if (strike === legs.sellCall) return "SELL CALL (short)";
  if (strike === legs.buyCall) return "BUY CALL (wing)";
  return null;
}

function getLegStyle(strike: number, legs: IronCondorSelectedLegs): string {
  if (strike === legs.buyPut) return "bg-red-50 border border-red-300";
  if (strike === legs.sellPut) return "bg-red-100 border-2 border-red-500";
  if (strike === legs.sellCall) return "bg-green-100 border-2 border-green-500";
  if (strike === legs.buyCall) return "bg-green-50 border border-green-300";
  return "border-b border-border";
}

function formatDelta(delta: number | undefined): string {
  if (delta == null || delta === 0) return "\u2014";
  return delta.toFixed(3);
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
}: {
  entry: IronCondorChainStrike;
  selectedLegs: IronCondorSelectedLegs;
  isAtMoney: boolean;
  onSelectLeg: (strike: number, type: "PUT" | "CALL", side: "BUY" | "SELL") => void;
}) {
  const label = getLegLabel(entry.strike, selectedLegs);
  const style = getLegStyle(entry.strike, selectedLegs);

  const handlePutClick = useCallback(() => {
    // If below current sell put, it's a buy put (wing); otherwise sell put
    if (selectedLegs.sellPut && entry.strike < selectedLegs.sellPut) {
      onSelectLeg(entry.strike, "PUT", "BUY");
    } else {
      onSelectLeg(entry.strike, "PUT", "SELL");
    }
  }, [entry.strike, selectedLegs.sellPut, onSelectLeg]);

  const handleCallClick = useCallback(() => {
    // If above current sell call, it's a buy call (wing); otherwise sell call
    if (selectedLegs.sellCall && entry.strike > selectedLegs.sellCall) {
      onSelectLeg(entry.strike, "CALL", "BUY");
    } else {
      onSelectLeg(entry.strike, "CALL", "SELL");
    }
  }, [entry.strike, selectedLegs.sellCall, onSelectLeg]);

  return (
    <div className={`rounded-sm my-0.5 ${style}`}>
      <div className="grid gap-1 py-1 px-1 text-xs" style={{ gridTemplateColumns: "55px 55px 50px 45px 70px 45px 50px 55px 55px" }}>
        {/* Put side */}
        <div className="text-right cursor-pointer hover:bg-red-50/50" onClick={handlePutClick}>
          {formatPrice(entry.put?.bid)}
        </div>
        <div className="text-right cursor-pointer hover:bg-red-50/50" onClick={handlePutClick}>
          {formatPrice(entry.put?.ask)}
        </div>
        <div className="text-right text-red-600 cursor-pointer hover:bg-red-50/50" onClick={handlePutClick}>
          {formatDelta(entry.put?.delta)}
        </div>
        <div className="text-right text-muted-foreground">
          {formatIV(entry.put?.iv)}
        </div>

        {/* Strike */}
        <div className={`text-center font-semibold ${isAtMoney ? "text-amber-700" : ""}`}>
          {entry.strike}
          {isAtMoney && " \u25C6"}
        </div>

        {/* Call side */}
        <div className="text-muted-foreground">
          {formatIV(entry.call?.iv)}
        </div>
        <div className="text-green-600 cursor-pointer hover:bg-green-50/50" onClick={handleCallClick}>
          {formatDelta(entry.call?.delta)}
        </div>
        <div className="cursor-pointer hover:bg-green-50/50" onClick={handleCallClick}>
          {formatPrice(entry.call?.bid)}
        </div>
        <div className="cursor-pointer hover:bg-green-50/50" onClick={handleCallClick}>
          {formatPrice(entry.call?.ask)}
        </div>
      </div>
      {label && (
        <div className={`text-[10px] px-2 pb-1 font-semibold ${label.includes("PUT") ? "text-red-600" : "text-green-600"}`}>
          {label.includes("SELL") ? "\u25BC" : "\u25B2"} {label} — {"\u03B4"} {
            label.includes("PUT")
              ? formatDelta(entry.put?.delta)
              : formatDelta(entry.call?.delta)
          }
        </div>
      )}
    </div>
  );
});

export function OptionsChainTable({ chain, selectedLegs, underlyingPrice, onSelectLeg }: OptionsChainTableProps) {
  // Find closest strike to underlying
  const atMoneyStrike = chain.reduce((closest, entry) => {
    return Math.abs(entry.strike - underlyingPrice) < Math.abs(closest - underlyingPrice)
      ? entry.strike
      : closest;
  }, chain[0]?.strike ?? 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Options Chain</h3>
        <span className="text-xs text-muted-foreground">Click a row to select as leg</span>
      </div>

      {/* Header */}
      <div className="grid gap-1 px-1 text-[10px] text-muted-foreground uppercase font-medium pb-1 border-b" style={{ gridTemplateColumns: "55px 55px 50px 45px 70px 45px 50px 55px 55px" }}>
        <div className="text-right">Bid</div>
        <div className="text-right">Ask</div>
        <div className="text-right">Delta</div>
        <div className="text-right">IV</div>
        <div className="text-center font-semibold text-foreground">Strike</div>
        <div>IV</div>
        <div>Delta</div>
        <div>Bid</div>
        <div>Ask</div>
      </div>
      <div className="flex mb-1">
        <div className="flex-1 text-center text-[10px] font-semibold text-red-600">{"\u2190"} PUTS</div>
        <div className="w-[70px]" />
        <div className="flex-1 text-center text-[10px] font-semibold text-green-600">CALLS {"\u2192"}</div>
      </div>

      {/* Scrollable chain */}
      <div className="max-h-[500px] overflow-y-auto">
        {chain.map((entry) => (
          <ChainRow
            key={entry.strike}
            entry={entry}
            selectedLegs={selectedLegs}
            isAtMoney={entry.strike === atMoneyStrike}
            onSelectLeg={onSelectLeg}
          />
        ))}
      </div>
    </div>
  );
}
