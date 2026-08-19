/**
 * Spreads builder page — thin wrapper around OptionsBuilder.
 *
 * Owns:
 * - Symbol picker (loaded from settings)
 * - Strategy Advisor (VIX-based strike/sizing recommendations)
 * - Active spreads list with close/hedge handlers
 * - GEX modal and Hedge Wizard dialog
 * - Risk/hedge state
 */

import { useState, useEffect, useCallback } from "react";
import { BarChart3 } from "lucide-react";
import { settingsApi } from "@/api/settings";
import { api } from "@/api";
import { ActiveSpreadsList } from "@/components/iron-condor/ActiveSpreadsList";
import { CloseSpreadDialog } from "@/components/iron-condor/CloseSpreadDialog";
import { GexModal } from "@/components/iron-condor/GexModal";
import { HedgeWizardDialog } from "@/components/iron-condor/HedgeWizardDialog";
import { StrategyAdvisor } from "@/components/iron-condor/StrategyAdvisor";
import { OptionsBuilder } from "@/components/options-builder/OptionsBuilder";
import type { StrategyRecommendation } from "@/components/options-builder/OptionsBuilder";
import type { StrategyApplyParams } from "@/components/iron-condor/StrategyAdvisor";
import { useSpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";
import { useHedgeRecommendations } from "@/hooks/useHedgeRecommendations";
import { Label } from "@/components/ui/label";
import type { ActiveSpread, HedgeStrategy } from "@assup/shared";

const DEFAULT_SYMBOLS = ["SPX", "XSP", "RUT"];

export function IronCondorPage() {
  // Symbol picker
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [symbol, setSymbol] = useState<string>("SPX");

  // Risk thresholds from settings
  const [hedgeWarningPct, setHedgeWarningPct] = useState(100);
  const [hedgeDangerPct, setHedgeDangerPct] = useState(200);

  // Active spreads
  const [spreads, setSpreads] = useState<ActiveSpread[]>([]);

  // Strategy recommendation from advisor
  const [strategyRec, setStrategyRec] = useState<StrategyRecommendation | null>(null);

  // Close dialog
  const [closingSpread, setClosingSpread] = useState<ActiveSpread | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // GEX modal
  const [gexModalOpen, setGexModalOpen] = useState(false);

  // Hedge wizard
  const [hedgeDialogOpen, setHedgeDialogOpen] = useState(false);
  const [hedgingSpread, setHedgingSpread] = useState<ActiveSpread | null>(null);
  const [hedgeInitialStrategy, setHedgeInitialStrategy] = useState<HedgeStrategy | undefined>(undefined);

  // Load symbols and risk thresholds from settings
  useEffect(() => {
    settingsApi.get<{ symbols?: string[]; updateIntervalMs?: number; hedgeWarningPct?: number; hedgeDangerPct?: number }>("spreads")
      .then(r => {
        if (r.value?.symbols?.length) {
          setSymbols(r.value.symbols);
          setSymbol(r.value.symbols[0]);
        }
        if (r.value?.hedgeWarningPct != null) setHedgeWarningPct(r.value.hedgeWarningPct);
        if (r.value?.hedgeDangerPct != null) setHedgeDangerPct(r.value.hedgeDangerPct);
      })
      .catch(() => {});
  }, []);

  // Poll active spreads every 10s
  const fetchSpreads = useCallback(() => {
    api.ironCondor.getActiveSpreads()
      .then(r => setSpreads(r.spreads))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchSpreads();
    const interval = setInterval(fetchSpreads, 10000);
    return () => clearInterval(interval);
  }, [fetchSpreads]);

  const riskMap = useSpreadRiskStatus(spreads, hedgeWarningPct, hedgeDangerPct);
  const recommendations = useHedgeRecommendations(spreads, riskMap);

  // Handlers
  const handleSymbolChange = useCallback((sym: string) => {
    setSymbol(sym);
    setStrategyRec(null);
  }, []);

  const handleCloseSpread = useCallback((spread: ActiveSpread) => {
    setClosingSpread(spread);
    setCloseDialogOpen(true);
  }, []);

  const handleHedgeSpread = useCallback((spread: ActiveSpread, initialStrategy?: HedgeStrategy) => {
    setHedgingSpread(spread);
    setHedgeInitialStrategy(initialStrategy);
    setHedgeDialogOpen(true);
  }, []);

  const handleHedgeDialogClose = useCallback((open: boolean) => {
    if (!open) {
      setHedgeDialogOpen(false);
      setHedgingSpread(null);
      setHedgeInitialStrategy(undefined);
    } else {
      setHedgeDialogOpen(true);
    }
  }, []);

  const handleStrategyApply = useCallback((params: StrategyApplyParams) => {
    setStrategyRec({
      shortStrike: params.shortStrike,
      longStrike: params.longStrike,
      wingWidth: params.wingWidth,
      quantity: params.quantity,
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Active spreads — always on top */}
      <ActiveSpreadsList
        spreads={spreads}
        onClose={handleCloseSpread}
        onHedge={handleHedgeSpread}
        riskMap={riskMap}
        recommendations={recommendations}
      />

      {/* Symbol picker — sticky bar */}
      <div className="flex items-center gap-4 flex-wrap border rounded-lg p-3 bg-background/95 sticky top-[65px] md:top-[113px] z-40 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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

        <button
          onClick={() => setGexModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted transition-colors"
          title="Open GEX analysis"
        >
          <BarChart3 className="h-4 w-4" />
          GEX
        </button>
      </div>

      {/* Strategy Advisor — VIX-based strike/sizing recommendations */}
      <StrategyAdvisor
        key={symbol}
        symbol={symbol}
        baseQuantity={1}
        onApply={handleStrategyApply}
      />

      {/* Options builder — re-mounts on symbol change to reset all internal state */}
      <OptionsBuilder
        key={symbol}
        symbol={symbol}
        allowedModes={["vertical", "iron-condor"]}
        defaultMode="vertical"
        onOrderPlaced={fetchSpreads}
        strategyRecommendation={strategyRec}
      />

      {/* Close spread dialog */}
      <CloseSpreadDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        spread={closingSpread}
        onSuccess={fetchSpreads}
      />

      {/* Hedge wizard */}
      <HedgeWizardDialog
        open={hedgeDialogOpen}
        onOpenChange={handleHedgeDialogClose}
        spread={hedgingSpread}
        risk={riskMap.get(hedgingSpread?.id ?? "") ?? { level: "healthy", premiumMultiple: null }}
        chain={[]}
        underlyingPrice={0}
        onSuccess={fetchSpreads}
        initialStrategy={hedgeInitialStrategy}
      />

      {/* GEX modal */}
      <GexModal
        open={gexModalOpen}
        onOpenChange={setGexModalOpen}
        symbol={symbol}
        expiration={undefined}
        chain={[]}
        mode="put-spread"
        putDelta={4.5}
        callDelta={4.5}
        wingWidth={30}
        onApplyLegs={() => {}}
      />
    </div>
  );
}
