import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ActiveSpread, IronCondorChainStrike } from "@assup/shared";
import { HedgeStrategyPicker, type HedgeStrategy } from "./HedgeStrategyPicker";
import { HedgeStrikeConfig } from "./HedgeStrikeConfig";
import { HedgePayoffComparison } from "./HedgePayoffComparison";
import { HedgeOrderConfirm } from "./HedgeOrderConfirm";
import { computeHedgedPayoff } from "@/utils/spreadAnalysis";
import type { SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";

interface HedgeWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  risk: SpreadRiskStatus;
  /** The live options chain already streaming on the page */
  chain: IronCondorChainStrike[];
  underlyingPrice: number;
  onSuccess: () => void;
}

/** Derive wing width from spread legs (smallest gap between adjacent strikes). */
function deriveWingWidth(spread: ActiveSpread): number {
  const strikes = spread.legs.map((l) => l.strike).sort((a, b) => a - b);
  if (strikes.length < 2) return 5;
  return strikes[1] - strikes[0];
}

/** Build a quotes Map from the page's existing chain data, keyed by "strike:P" or "strike:C". */
function buildQuotesFromChain(chain: IronCondorChainStrike[]) {
  const quotes = new Map<string, {
    strike: number; right: "P" | "C"; conId: number;
    bid: number | null; ask: number | null; mid: number | null; delta: number | null;
  }>();
  for (const row of chain) {
    if (row.put) {
      quotes.set(`${row.strike}:P`, {
        strike: row.strike, right: "P", conId: row.put.conId,
        bid: row.put.bid, ask: row.put.ask, mid: row.put.mid, delta: row.put.delta,
      });
    }
    if (row.call) {
      quotes.set(`${row.strike}:C`, {
        strike: row.strike, right: "C", conId: row.call.conId,
        bid: row.call.bid, ask: row.call.ask, mid: row.call.mid, delta: row.call.delta,
      });
    }
  }
  return quotes;
}

export function HedgeWizardDialog({
  open,
  onOpenChange,
  spread,
  risk,
  chain,
  underlyingPrice,
  onSuccess,
}: HedgeWizardDialogProps) {
  const [step, setStep] = useState(1);
  const [strategy, setStrategy] = useState<HedgeStrategy>("butterfly");
  const [selectedStrike, setSelectedStrike] = useState(0);
  const [limitPrice, setLimitPrice] = useState(0);

  const isPut = spread ? spread.type === "put-spread" : true;

  // Compute wing width and long leg from spread
  const wingWidth = spread ? deriveWingWidth(spread) : 5;
  const sortedLegs = spread
    ? [...spread.legs].sort((a, b) => a.strike - b.strike)
    : [];
  const longLeg = isPut
    ? sortedLegs[0]
    : sortedLegs[sortedLegs.length - 1];
  const longLegStrike = longLeg?.strike ?? 0;

  // Default strike: one wing width beyond long leg
  const defaultStrike = isPut
    ? longLegStrike - wingWidth
    : longLegStrike + wingWidth;

  // Reset state when dialog opens with a new spread
  useEffect(() => {
    if (open && spread) {
      setStep(1);
      setSelectedStrike(defaultStrike);
      setLimitPrice(0);
    }
  }, [open, spread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Derive quotes from the page's existing chain (no separate SSE stream) ---
  const quotes = useMemo(() => buildQuotesFromChain(chain), [chain]);
  const connected = chain.length > 0;

  // --- Available strikes for dropdown (from real chain, not synthetic intervals) ---
  const right: "P" | "C" = isPut ? "P" : "C";
  const availableStrikes = useMemo(() => {
    const result: number[] = [];
    for (const row of chain) {
      const opt = isPut ? row.put : row.call;
      if (!opt) continue;
      if (isPut && row.strike < longLegStrike) result.push(row.strike);
      if (!isPut && row.strike > longLegStrike) result.push(row.strike);
    }
    return result.sort((a, b) => (isPut ? b - a : a - b));
  }, [chain, isPut, longLegStrike]);

  // Snap selectedStrike to nearest available if not in list
  useEffect(() => {
    if (availableStrikes.length === 0) return;
    if (availableStrikes.includes(selectedStrike)) return;
    const nearest = availableStrikes.reduce((prev, curr) =>
      Math.abs(curr - selectedStrike) < Math.abs(prev - selectedStrike)
        ? curr
        : prev,
    );
    setSelectedStrike(nearest);
  }, [availableStrikes, selectedStrike]);

  // --- Hedge mid price computation ---
  const hedgeMidPrice = useMemo(() => {
    if (!spread) return 0;
    if (strategy === "butterfly") {
      const middleQuote = quotes.get(`${longLegStrike}:${right}`);
      const outerQuote = quotes.get(`${selectedStrike}:${right}`);
      const middleAsk = middleQuote?.ask ?? 0;
      const outerBid = outerQuote?.bid ?? 0;
      return Math.max(0, middleAsk - outerBid);
    } else {
      const quote = quotes.get(`${selectedStrike}:${right}`);
      return quote?.ask ?? 0;
    }
  }, [quotes, strategy, longLegStrike, selectedStrike, right, spread]);

  // Auto-set limitPrice to hedgeMidPrice when first available (step 2, limitPrice still 0)
  useEffect(() => {
    if (step === 2 && limitPrice === 0 && hedgeMidPrice > 0) {
      setLimitPrice(hedgeMidPrice);
    }
  }, [step, limitPrice, hedgeMidPrice]);

  // --- Payoff analysis ---
  const originalCreditPerContract = spread
    ? Math.abs(spread.netPremium) / (spread.quantity * 100)
    : 0;

  // Before analysis: payoff of the existing spread based on ENTRY credit, not live marks.
  const beforeResult = useMemo(() => {
    if (!spread) return null;
    try {
      const existingLegs = spread.legs.map((leg) => ({
        strike: leg.strike,
        type: (leg.right === "P" ? "PUT" : "CALL") as "PUT" | "CALL",
        side: leg.side,
      }));
      return computeHedgedPayoff({
        existingLegs,
        newLegs: [],
        originalCreditMid: originalCreditPerContract,
        hedgeDebitLimit: 0,
        quantity: spread.quantity,
        underlyingPrice: underlyingPrice || spread.legs[0].strike,
      });
    } catch {
      return null;
    }
  }, [spread, originalCreditPerContract, underlyingPrice]);

  // After analysis (hedged payoff)
  const afterResult = useMemo(() => {
    if (!spread || !beforeResult) return null;
    try {
      const existingLegs = spread.legs.map((leg) => ({
        strike: leg.strike,
        type: (leg.right === "P" ? "PUT" : "CALL") as "PUT" | "CALL",
        side: leg.side,
      }));

      let newLegs: Array<{
        strike: number;
        type: "PUT" | "CALL";
        side: "BUY" | "SELL";
        bid: number;
        ask: number;
      }>;

      if (strategy === "butterfly") {
        const middleQuote = quotes.get(`${longLegStrike}:${right}`);
        const outerQuote = quotes.get(`${selectedStrike}:${right}`);
        newLegs = [
          {
            strike: longLegStrike,
            type: isPut ? "PUT" : "CALL",
            side: "BUY" as const,
            bid: middleQuote?.bid ?? 0,
            ask: middleQuote?.ask ?? 0,
          },
          {
            strike: selectedStrike,
            type: isPut ? "PUT" : "CALL",
            side: "SELL" as const,
            bid: outerQuote?.bid ?? 0,
            ask: outerQuote?.ask ?? 0,
          },
        ];
      } else {
        const q = quotes.get(`${selectedStrike}:${right}`);
        newLegs = [
          {
            strike: selectedStrike,
            type: isPut ? "PUT" : "CALL",
            side: "BUY" as const,
            bid: q?.bid ?? 0,
            ask: q?.ask ?? 0,
          },
        ];
      }

      return computeHedgedPayoff({
        existingLegs,
        newLegs,
        originalCreditMid: originalCreditPerContract,
        hedgeDebitLimit: limitPrice,
        quantity: spread.quantity,
        underlyingPrice: underlyingPrice || spread.legs[0].strike,
      });
    } catch {
      return null;
    }
  }, [
    spread,
    beforeResult,
    strategy,
    quotes,
    longLegStrike,
    selectedStrike,
    right,
    isPut,
    originalCreditPerContract,
    limitPrice,
    underlyingPrice,
  ]);

  // --- Before payoff metrics ---
  const beforeMaxProfit = beforeResult?.maxProfit ?? 0;
  const beforeMaxLoss = beforeResult?.maxLoss ?? 0;

  // --- Chart strikes ---
  const chartStrikes = useMemo(() => {
    if (!spread) return [];
    const strikeSet = new Set<number>();
    for (const leg of spread.legs) strikeSet.add(leg.strike);
    if (selectedStrike > 0) strikeSet.add(selectedStrike);
    return Array.from(strikeSet)
      .sort((a, b) => a - b)
      .map((strike) => ({ strike, label: String(strike) }));
  }, [spread, selectedStrike]);

  // --- Order legs ---
  const orderLegs = useMemo(() => {
    if (!spread) return [];
    if (strategy === "butterfly") {
      const middleQuote = quotes.get(`${longLegStrike}:${right}`);
      const outerQuote = quotes.get(`${selectedStrike}:${right}`);
      return [
        {
          side: "BUY" as const,
          strike: longLegStrike,
          right,
          conId: middleQuote?.conId ?? 0,
        },
        {
          side: "SELL" as const,
          strike: selectedStrike,
          right,
          conId: outerQuote?.conId ?? 0,
        },
      ];
    } else {
      const q = quotes.get(`${selectedStrike}:${right}`);
      return [
        {
          side: "BUY" as const,
          strike: selectedStrike,
          right,
          conId: q?.conId ?? 0,
        },
      ];
    }
  }, [spread, strategy, quotes, longLegStrike, selectedStrike, right]);

  // --- Handlers ---
  const handleStrategySelect = (s: HedgeStrategy) => {
    setStrategy(s);
    setLimitPrice(0);
    setStep(2);
  };

  const handleSuccess = () => {
    onOpenChange(false);
    onSuccess();
  };

  if (!spread) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hedge {spread.symbol} Spread</DialogTitle>
          <DialogDescription>Step {step} of 4</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <HedgeStrategyPicker
            spread={spread}
            premiumMultiple={risk.premiumMultiple}
            onSelect={handleStrategySelect}
          />
        )}

        {step === 2 && (
          <HedgeStrikeConfig
            spread={spread}
            strategy={strategy}
            availableStrikes={availableStrikes}
            quotes={quotes}
            selectedStrike={selectedStrike}
            onSelectedStrikeChange={setSelectedStrike}
            limitPrice={limitPrice}
            onLimitPriceChange={setLimitPrice}
            hedgeMidPrice={hedgeMidPrice}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            connected={connected}
          />
        )}

        {step === 3 && beforeResult && afterResult && (
          <HedgePayoffComparison
            beforeCurve={beforeResult.payoffCurve}
            afterResult={afterResult}
            beforeMaxProfit={beforeMaxProfit}
            beforeMaxLoss={beforeMaxLoss}
            underlyingPrice={underlyingPrice || spread.legs[0].strike}
            strikes={chartStrikes}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}

        {step === 4 && beforeResult && afterResult && (
          <HedgeOrderConfirm
            spread={spread}
            strategy={strategy}
            orderLegs={orderLegs}
            limitPrice={limitPrice}
            quantity={spread.quantity}
            beforeMaxLoss={beforeMaxLoss}
            afterMaxLoss={afterResult.maxLoss}
            onBack={() => setStep(3)}
            onSuccess={handleSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
