import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/common";
import { settingsApi } from "@/api/settings";

const MAX_SYMBOLS = 5;
const DEFAULT_SYMBOLS = ["SPX", "XSP", "RUT"];
const DEFAULT_UPDATE_INTERVAL_MS = 2000;

const UPDATE_INTERVAL_OPTIONS = [
  { value: 500, label: "0.5s" },
  { value: 1000, label: "1s" },
  { value: 2000, label: "2s" },
  { value: 3000, label: "3s" },
  { value: 5000, label: "5s" },
];

interface SpreadsSettings {
  symbols: string[];
  updateIntervalMs?: number;
}

export function SpreadsSection() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [updateIntervalMs, setUpdateIntervalMs] = useState(DEFAULT_UPDATE_INTERVAL_MS);
  const [newSymbol, setNewSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Refs to always have current values for the save function
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;
  const intervalRef = useRef(updateIntervalMs);
  intervalRef.current = updateIntervalMs;

  const save = useCallback(async (syms: string[], interval: number) => {
    try {
      await settingsApi.set<SpreadsSettings>("spreads", {
        symbols: syms,
        updateIntervalMs: interval,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const result = await settingsApi.get<SpreadsSettings>("spreads");
      if (result.value?.symbols?.length > 0) {
        setSymbols(result.value.symbols);
      }
      if (result.value?.updateIntervalMs != null) {
        setUpdateIntervalMs(result.value.updateIntervalMs);
      }
    } catch {
      // Use defaults
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleAdd = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    if (symbols.includes(sym)) {
      setError(`${sym} is already in the list`);
      return;
    }
    if (symbols.length >= MAX_SYMBOLS) {
      setError(`Maximum ${MAX_SYMBOLS} symbols allowed`);
      return;
    }
    const next = [...symbols, sym];
    setSymbols(next);
    setNewSymbol("");
    setError(null);
    save(next, intervalRef.current);
  };

  const handleRemove = (sym: string) => {
    const next = symbols.filter(s => s !== sym);
    if (next.length === 0) {
      setError("At least one symbol is required");
      return;
    }
    setSymbols(next);
    save(next, intervalRef.current);
  };

  const handleIntervalChange = (value: number) => {
    setUpdateIntervalMs(value);
    save(symbolsRef.current, value);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6 py-2">
      <h2 className="text-lg font-semibold">Spreads</h2>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Symbols</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure up to {MAX_SYMBOLS} symbols for the spreads builder. These appear as quick-select buttons on the spreads page.
          </p>

          {/* Current symbols */}
          <div className="flex flex-wrap gap-2">
            {symbols.map(sym => (
              <div
                key={sym}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted rounded-md text-sm font-semibold"
              >
                {sym}
                <button
                  onClick={() => handleRemove(sym)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title={`Remove ${sym}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new symbol */}
          {symbols.length < MAX_SYMBOLS && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="new-symbol" className="sr-only">New Symbol</Label>
                <Input
                  id="new-symbol"
                  placeholder="Enter ticker (e.g. NDX)"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  maxLength={10}
                />
              </div>
              <Button variant="outline" onClick={handleAdd} disabled={!newSymbol.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chain Update Frequency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            How often the options chain data (prices, deltas, IV) refreshes on the spreads page.
            Lower values show changes faster but can make the UI harder to read.
          </p>

          <div className="flex items-center gap-3">
            <Label className="text-sm whitespace-nowrap">Update every</Label>
            <div className="flex rounded-md border overflow-hidden">
              {UPDATE_INTERVAL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleIntervalChange(opt.value)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    updateIntervalMs === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
