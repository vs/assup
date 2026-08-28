import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ActiveSpread, IronCondorChainStrike } from "@assup/shared";
import { HedgeStrategyPicker } from "./HedgeStrategyPicker";
import type { HedgeStrategy } from "@assup/shared";
import { HedgeStrikeConfig } from "./HedgeStrikeConfig";
import { HedgePayoffComparison } from "./HedgePayoffComparison";
import { HedgeOrderConfirm } from "./HedgeOrderConfirm";
import { computeHedgedPayoff } from "@/utils/spreadAnalysis";
import type { SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";
import { useSpreadsStream } from "@/hooks/useSpreadsStream";

interface HedgeWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  risk: SpreadRiskStatus;
  /** Optional external chain — if empty/missing, the wizard streams its own */
  chain?: IronCondorChainStrike[];
  underlyingPrice?: number;
  onSuccess: () => void;
  initialStrategy?: HedgeStrategy;
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
  chain: externalChain,
  underlyingPrice: externalUnderlyingPrice,
  onSuccess,
  initialStrategy,
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

  // Stream own chain data — focused on the spread's hedge zone only
  const needsOwnStream = open && !!spread && (!externalChain || externalChain.length === 0);
  const hedgeFocusRange = useMemo(() => {
    if (!spread) return undefined;
    const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
    const lo = strikes[0];
    const hi = strikes[strikes.length - 1];
    // Cover spread legs + 5 wing widths in the hedge direction
    return isPut
      ? { min: lo - wingWidth * 5, max: hi }
      : { min: lo, max: hi + wingWidth * 5 };
  }, [spread, isPut, wingWidth]);

  const streamMode = isPut ? "put-spread" : "call-spread";
  const streamResult = useSpreadsStream(
    spread?.symbol ?? "SPX",
    spread?.expiry,
    undefined, // selectedStrikes — not needed, focusRange covers it
    hedgeFocusRange, // dense subscription in the hedge zone
    undefined, // targetPutDelta
    undefined, // targetCallDelta
    undefined, // wingWidth
    streamMode, // only subscribe to the side we need
    2000,      // updateIntervalMs
    needsOwnStream, // enabled
  );
  const chain = needsOwnStream ? streamResult.chain : (externalChain ?? []);
  const underlyingPrice = needsOwnStream ? streamResult.underlyingPrice : (externalUnderlyingPrice ?? 0);

  // Reset state when dialog opens with a new spread
  useEffect(() => {
    if (open && spread) {
      const strat = initialStrategy ?? "butterfly";
      setStrategy(strat);
      setStep(initialStrategy ? 2 : 1);
      setLimitPrice(0);

      if (strat === "roll") {
        // Default roll target: midpoint between short and long legs
        const shortLeg = spread.legs.find((l) => l.side === "SELL");
        const shortStrike = shortLeg?.strike ?? 0;
        const rollTarget = Math.round((shortStrike + longLegStrike) / 2);
        setSelectedStrike(rollTarget);
      } else {
        setSelectedStrike(defaultStrike);
      }
    }
  }, [open, spread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Derive quotes from chain data ---
  const quotes = useMemo(() => buildQuotesFromChain(chain), [chain]);
  const connected = chain.length > 0;

  // --- Available strikes for dropdown (from real chain, not synthetic intervals) ---
  const right: "P" | "C" = isPut ? "P" : "C";
  const availableStrikes = useMemo(() => {
    const result: number[] = [];
    for (const row of chain) {
      const opt = isPut ? row.put : row.call;
      if (!opt) continue;

      if (strategy === "roll") {
        // Roll: strikes strictly between the current short and long legs.
        // For puts: below short strike but above long strike (no inversion).
        // For calls: above short strike but below long strike.
        const shortLeg = spread?.legs.find((l) => l.side === "SELL");
        const shortStrike = shortLeg?.strike ?? 0;
        if (isPut && row.strike < shortStrike && row.strike > longLegStrike) result.push(row.strike);
        if (!isPut && row.strike > shortStrike && row.strike < longLegStrike) result.push(row.strike);
      } else if (strategy === "butterfly") {
        // Butterfly: outer wing must be beyond the long leg
        if (isPut && row.strike < longLegStrike) result.push(row.strike);
        if (!isPut && row.strike > longLegStrike) result.push(row.strike);
      } else {
        // Protective: any strike is valid
        result.push(row.strike);
      }
    }
    return result.sort((a, b) => (isPut ? b - a : a - b));
  }, [chain, isPut, longLegStrike, strategy, spread]);

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
    } else if (strategy === "roll") {
      // Roll cost = buy back current short (ask) - sell new short (bid)
      const shortLeg = spread.legs.find((l) => l.side === "SELL");
      const closeQuote = quotes.get(`${shortLeg?.strike ?? 0}:${right}`);
      const newQuote = quotes.get(`${selectedStrike}:${right}`);
      const closeCost = closeQuote?.ask ?? 0;
      const newPremium = newQuote?.bid ?? 0;
      return Math.max(0, closeCost - newPremium);
    } else {
      const quote = quotes.get(`${selectedStrike}:${right}`);
      return quote?.ask ?? 0;
    }
  }, [quotes, strategy, longLegStrike, selectedStrike, right, spread]);

  // For rolls: the close leg's ask price (what it costs to buy back the short)
  const rollCloseLimitPrice = useMemo(() => {
    if (!spread || strategy !== "roll") return undefined;
    const shortLeg = spread.legs.find((l) => l.side === "SELL");
    const closeQuote = quotes.get(`${shortLeg?.strike ?? 0}:${right}`);
    return closeQuote?.ask ?? undefined;
  }, [spread, strategy, quotes, right]);

  // Auto-set limitPrice to hedgeMidPrice when first available (step 2, limitPrice still 0)
  useEffect(() => {
    if (step === 2 && limitPrice === 0 && hedgeMidPrice > 0) {
      setLimitPrice(hedgeMidPrice);
    }
  }, [step, limitPrice, hedgeMidPrice]);

  // --- Payoff analysis ---
  // Standard credit-spread payoff at expiry, using the ENTRY CREDIT as the
  // baseline. We deliberately ignore current mark / unrealized P&L: this view
  // shows the spread's intrinsic best/worst-case scenarios at expiration,
  // and how a hedge shifts those scenarios. Net premium is signed (negative
  // for net credit received), so abs() recovers the credit magnitude.
  const originalCreditPerShare = spread
    ? Math.abs(spread.netPremium) / (spread.quantity * 100)
    : 0;

  // Before analysis: standard expiration payoff for the existing spread.
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
        originalCreditMid: originalCreditPerShare,
        hedgeDebitLimit: 0,
        quantity: spread.quantity,
      });
    } catch {
      return null;
    }
  }, [spread, originalCreditPerShare, underlyingPrice]);

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
      } else if (strategy === "roll") {
        // For roll: replace the short leg with a new one further OTM.
        // Cancel out the old short by adding a BUY at the same strike,
        // then add a new SELL at the selected strike
        const shortLeg = spread.legs.find((l) => l.side === "SELL");
        const closeQuote = quotes.get(`${shortLeg?.strike ?? 0}:${right}`);
        const newQuote = quotes.get(`${selectedStrike}:${right}`);
        newLegs = [
          {
            strike: shortLeg?.strike ?? 0,
            type: isPut ? "PUT" : "CALL",
            side: "BUY" as const,
            bid: closeQuote?.bid ?? 0,
            ask: closeQuote?.ask ?? 0,
          },
          {
            strike: selectedStrike,
            type: isPut ? "PUT" : "CALL",
            side: "SELL" as const,
            bid: newQuote?.bid ?? 0,
            ask: newQuote?.ask ?? 0,
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
        originalCreditMid: originalCreditPerShare,
        hedgeDebitLimit: limitPrice,
        quantity: spread.quantity,
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
    originalCreditPerShare,
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
        { side: "BUY" as const, strike: longLegStrike, right, conId: middleQuote?.conId ?? 0 },
        { side: "SELL" as const, strike: selectedStrike, right, conId: outerQuote?.conId ?? 0 },
      ];
    } else if (strategy === "roll") {
      const shortLeg = spread.legs.find((l) => l.side === "SELL");
      const closeQuote = quotes.get(`${shortLeg?.strike ?? 0}:${right}`);
      const newQuote = quotes.get(`${selectedStrike}:${right}`);
      return [
        { side: "BUY" as const, strike: shortLeg?.strike ?? 0, right, conId: closeQuote?.conId ?? 0 },
        { side: "SELL" as const, strike: selectedStrike, right, conId: newQuote?.conId ?? 0 },
      ];
    } else {
      const q = quotes.get(`${selectedStrike}:${right}`);
      return [{ side: "BUY" as const, strike: selectedStrike, right, conId: q?.conId ?? 0 }];
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
            rollCloseLimitPrice={rollCloseLimitPrice}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
