import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ActiveSpread } from "@assup/shared";
import { HedgeStrategyPicker, type HedgeStrategy } from "./HedgeStrategyPicker";
import { HedgeStrikeConfig } from "./HedgeStrikeConfig";
import { HedgePayoffComparison } from "./HedgePayoffComparison";
import { HedgeOrderConfirm } from "./HedgeOrderConfirm";
import { useHedgeStream } from "@/hooks/useHedgeStream";
import { analyzeSpread, computeHedgedPayoff } from "@/utils/spreadAnalysis";
import type { SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";

interface HedgeWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  risk: SpreadRiskStatus;
  onSuccess: () => void;
}

/** Derive wing width from spread legs (smallest gap between adjacent strikes). */
function deriveWingWidth(spread: ActiveSpread): number {
  const strikes = spread.legs.map((l) => l.strike).sort((a, b) => a - b);
  if (strikes.length < 2) return 5;
  return strikes[1] - strikes[0];
}

/** Days to expiry from YYYYMMDD string. */
function daysToExpiry(expiry: string): number {
  if (expiry.length !== 8) return 30;
  const d = new Date(
    parseInt(expiry.slice(0, 4)),
    parseInt(expiry.slice(4, 6)) - 1,
    parseInt(expiry.slice(6, 8)),
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

export function HedgeWizardDialog({
  open,
  onOpenChange,
  spread,
  risk,
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

  // --- SSE stream setup ---
  // Subscribe to strikes around spread (±3× wing width, at 5-point intervals)
  const streamStrikes = useMemo(() => {
    if (!spread) return [];
    const strikes = new Set<number>();
    const center = longLegStrike;
    const range = Math.max(wingWidth * 3, 15);
    const interval = 5;
    for (let s = center - range; s <= center + range; s += interval) {
      strikes.add(Math.round(s / interval) * interval);
    }
    // Also add all existing leg strikes
    for (const leg of spread.legs) strikes.add(leg.strike);
    return Array.from(strikes).sort((a, b) => a - b);
  }, [spread?.id, longLegStrike, wingWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  const { quotes, underlyingPrice, connected } = useHedgeStream(
    spread?.symbol ?? "",
    spread?.expiry ?? "",
    streamStrikes,
    open && step >= 2,
  );

  // --- Available strikes for dropdown ---
  // For puts: strikes below long leg; for calls: strikes above long leg
  const right: "P" | "C" = isPut ? "P" : "C";
  const availableStrikes = useMemo(() => {
    const result: number[] = [];
    for (const [key] of quotes) {
      if (!key.endsWith(`:${right}`)) continue;
      const strike = parseFloat(key.split(":")[0]);
      if (isPut && strike < longLegStrike) result.push(strike);
      if (!isPut && strike > longLegStrike) result.push(strike);
    }
    return result.sort((a, b) => (isPut ? b - a : a - b));
  }, [quotes, right, isPut, longLegStrike]);

  // Snap selectedStrike to nearest available if not in list
  useEffect(() => {
    if (availableStrikes.length === 0) return;
    if (availableStrikes.includes(selectedStrike)) return;
    // Find nearest
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
      // Buy middle (longLeg.strike) ask - sell outer (selectedStrike) bid
      const middleQuote = quotes.get(`${longLegStrike}:${right}`);
      const outerQuote = quotes.get(`${selectedStrike}:${right}`);
      const middleAsk = middleQuote?.ask ?? 0;
      const outerBid = outerQuote?.bid ?? 0;
      return Math.max(0, middleAsk - outerBid);
    } else {
      // Protective: ask of the protective strike
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

  const dte = spread ? daysToExpiry(spread.expiry) : 30;

  // Before analysis (existing spread payoff)
  const beforeAnalysis = useMemo(() => {
    if (!spread) return null;
    try {
      const mode = isPut ? "put-spread" : "call-spread";
      const legs = spread.legs.map((leg) => {
        const quoteKey = `${leg.strike}:${leg.right}`;
        const q = quotes.get(quoteKey);
        // Fallback to reasonable defaults if quotes not yet loaded
        const bid = q?.bid ?? Math.max(0, leg.midPrice ?? 1);
        const ask = q?.ask ?? Math.max(0, (leg.midPrice ?? 1) * 1.05);
        return {
          strike: leg.strike,
          type: (leg.right === "P" ? "PUT" : "CALL") as "PUT" | "CALL",
          side: leg.side,
          iv: 20, // default IV
          bid,
          ask,
        };
      });
      return analyzeSpread({
        underlyingPrice: underlyingPrice || spread.legs[0].strike,
        legs,
        daysToExpiry: dte,
        quantity: spread.quantity,
        mode,
      });
    } catch {
      return null;
    }
  }, [spread, quotes, isPut, underlyingPrice, dte]);

  // After analysis (hedged payoff)
  const afterResult = useMemo(() => {
    if (!spread || !beforeAnalysis) return null;
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
        // Two new legs: buy at longLeg.strike (middle) and buy at selectedStrike (outer)
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
            side: "BUY" as const,
            bid: outerQuote?.bid ?? 0,
            ask: outerQuote?.ask ?? 0,
          },
        ];
      } else {
        // Protective: single leg
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
    beforeAnalysis,
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
  const beforeMaxProfit = beforeAnalysis?.maxProfit ?? 0;
  const beforeMaxLoss = useMemo(() => {
    if (!beforeAnalysis) return 0;
    const losses = [beforeAnalysis.maxLossPut, beforeAnalysis.maxLossCall].filter(
      (v): v is number => v != null,
    );
    return losses.length > 0 ? Math.max(...losses) : 0;
  }, [beforeAnalysis]);

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
          side: "BUY" as const,
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

        {step === 3 && beforeAnalysis && afterResult && (
          <HedgePayoffComparison
            beforeCurve={beforeAnalysis.payoffCurve}
            afterResult={afterResult}
            beforeMaxProfit={beforeMaxProfit}
            beforeMaxLoss={beforeMaxLoss}
            underlyingPrice={underlyingPrice || spread.legs[0].strike}
            strikes={chartStrikes}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}

        {step === 4 && beforeAnalysis && afterResult && (
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
