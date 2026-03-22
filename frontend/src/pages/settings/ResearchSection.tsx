import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { researchApi } from "@/api/research";
import { settingsApi } from "@/api/settings";

interface ResearchSettings {
  synthesizerMode: "claude-cli" | "api";
}

const defaultSettings: ResearchSettings = {
  synthesizerMode: "claude-cli",
};

export function ResearchSection() {
  const [settings, setSettings] = useState<ResearchSettings>(defaultSettings);
  const [status, setStatus] = useState<{
    available: boolean;
    mode: string;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [savedSettings, claudeStatus] = await Promise.all([
        settingsApi
          .get<ResearchSettings>("research")
          .then((r) => r.value)
          .catch(() => defaultSettings),
        researchApi.getClaudeStatus().catch(() => null),
      ]);
      setSettings(savedSettings);
      setStatus(claudeStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleModeChange = async (useCli: boolean) => {
    const newSettings: ResearchSettings = {
      ...settings,
      synthesizerMode: useCli ? "claude-cli" : "api",
    };
    setSettings(newSettings);
    try {
      await settingsApi.set("research", newSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await researchApi.getClaudeStatus();
      setStatus(result);
    } catch (err) {
      setStatus({
        available: false,
        mode: settings.synthesizerMode,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6 py-2">
      <h2 className="text-lg font-semibold">Research</h2>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Synthesis Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="synth-mode">Use Claude Code CLI</Label>
              <p className="text-sm text-muted-foreground">
                {settings.synthesizerMode === "claude-cli"
                  ? "Reports are generated using claude -p with agentic capabilities (web search, tools)"
                  : "Reports are generated using the Anthropic API SDK directly"}
              </p>
            </div>
            <Switch
              id="synth-mode"
              checked={settings.synthesizerMode === "claude-cli"}
              onCheckedChange={handleModeChange}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Claude Code Status</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${testing ? "animate-spin" : ""}`}
              />
              Test Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="flex items-center gap-3">
              {status.available ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Claude Code authenticated and available</span>
                </>
              ) : status.error?.includes("not found") ||
                status.error?.includes("ENOENT") ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  <div>
                    <p>Claude Code binary not found</p>
                    <p className="text-sm text-muted-foreground">
                      Ensure @anthropic-ai/claude-code is installed in the
                      container
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <div>
                    <p>Not authenticated</p>
                    <p className="text-sm text-muted-foreground">
                      Run <code>claude login</code> on the host and restart the
                      container
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Unable to check status. Is the research service running?
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
