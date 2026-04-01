import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Key,
  Trash2,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { researchApi } from "@/api/research";
import { settingsApi } from "@/api/settings";

interface ResearchSettings {
  synthesizerMode: "claude-cli" | "api";
}

interface AuthStatus {
  configured: boolean;
  source: string;
  maskedToken?: string;
}

interface SAAuthStatus {
  configured: boolean;
  source: string;
  maskedEmail?: string;
  browser: {
    blocked: boolean;
    blockedAt: string | null;
    lastSuccessAt: string | null;
  };
}

const defaultSettings: ResearchSettings = {
  synthesizerMode: "claude-cli",
};

export function ResearchSection() {
  const [settings, setSettings] = useState<ResearchSettings>(defaultSettings);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    available: boolean;
    mode: string;
    error?: string;
    version?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Seeking Alpha state
  const [saStatus, setSaStatus] = useState<SAAuthStatus | null>(null);
  const [saEmail, setSaEmail] = useState("");
  const [saPassword, setSaPassword] = useState("");
  const [saSaving, setSaSaving] = useState(false);
  const [saRemoving, setSaRemoving] = useState(false);
  const [saTesting, setSaTesting] = useState(false);
  const [saSaveSuccess, setSaSaveSuccess] = useState(false);
  const [saTestResult, setSaTestResult] = useState<{
    ok: boolean;
    hasData: boolean;
    premium: boolean;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [savedSettings, auth, claude, saAuth] = await Promise.all([
        settingsApi
          .get<ResearchSettings>("research")
          .then((r) => r.value)
          .catch(() => defaultSettings),
        researchApi.getAuthStatus().catch(() => null),
        researchApi.getClaudeStatus().catch(() => null),
        researchApi.getSAAuthStatus().catch(() => null),
      ]);
      setSettings(savedSettings);
      setAuthStatus(auth);
      setConnectionStatus(claude);
      setSaStatus(saAuth);
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
    const prev = settings;
    const newSettings: ResearchSettings = {
      ...settings,
      synthesizerMode: useCli ? "claude-cli" : "api",
    };
    setSettings(newSettings);
    try {
      await settingsApi.set("research", newSettings);
    } catch (err) {
      setSettings(prev);
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const result = await researchApi.setAuthToken(tokenInput.trim());
      setAuthStatus(result);
      setTokenInput("");
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    setRemoving(true);
    setError(null);
    try {
      const result = await researchApi.deleteAuthToken();
      setAuthStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove token");
    } finally {
      setRemoving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await researchApi.getClaudeStatus();
      setConnectionStatus(result);
    } catch (err) {
      setConnectionStatus({
        available: false,
        mode: settings.synthesizerMode,
        error: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSACredentials = async () => {
    if (!saEmail.trim() || !saPassword) return;
    setSaSaving(true);
    setSaSaveSuccess(false);
    setError(null);
    try {
      await researchApi.setSACredentials(saEmail.trim(), saPassword);
      setSaStatus(await researchApi.getSAAuthStatus());
      setSaEmail("");
      setSaPassword("");
      setSaTestResult(null);
      setSaSaveSuccess(true);
      setTimeout(() => setSaSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save SA credentials");
    } finally {
      setSaSaving(false);
    }
  };

  const handleRemoveSACredentials = async () => {
    setSaRemoving(true);
    setError(null);
    try {
      await researchApi.deleteSACredentials();
      setSaStatus(await researchApi.getSAAuthStatus());
      setSaTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove SA credentials");
    } finally {
      setSaRemoving(false);
    }
  };

  const handleTestSAConnection = async () => {
    setSaTesting(true);
    setSaTestResult(null);
    try {
      const result = await researchApi.testSAConnection();
      setSaTestResult(result);
    } catch (err) {
      setSaTestResult({ ok: false, hasData: false, premium: false });
    } finally {
      setSaTesting(false);
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
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Authentication
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {authStatus && (
            <div className="flex items-center gap-3">
              {authStatus.configured ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                  <div className="min-w-0">
                    <p>
                      Token configured
                      <span className="text-muted-foreground ml-1">
                        ({authStatus.source === "database" ? "saved in database" : "from environment"})
                      </span>
                    </p>
                    {authStatus.maskedToken && (
                      <p className="text-sm text-muted-foreground font-mono">
                        {authStatus.maskedToken}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  <p>No authentication token configured</p>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="oauth-token">OAuth Token</Label>
            <div className="flex gap-2">
              <Input
                id="oauth-token"
                type="password"
                placeholder="sk-ant-oat01-..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveToken()}
              />
              <Button
                onClick={handleSaveToken}
                disabled={saving || !tokenInput.trim()}
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {saving ? "Validating..." : "Save"}
              </Button>
              {authStatus?.source === "database" && (
                <Button
                  variant="outline"
                  onClick={handleRemoveToken}
                  disabled={removing}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove
                </Button>
              )}
            </div>
            {saveSuccess && (
              <p className="text-sm text-green-600">Token validated and saved</p>
            )}
            <p className="text-sm text-muted-foreground">
              Run <code className="bg-muted px-1 rounded">claude setup-token</code> on
              your machine to generate a token, then paste it here.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Connection Test</CardTitle>
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
          {connectionStatus ? (
            <div className="flex items-center gap-3">
              {connectionStatus.available ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <p>Claude Code authenticated and available</p>
                    {connectionStatus.version && (
                      <p className="text-sm text-muted-foreground">{connectionStatus.version}</p>
                    )}
                  </div>
                </>
              ) : connectionStatus.error?.includes("not found") ||
                connectionStatus.error?.includes("ENOENT") ? (
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
                    <p>CLI test failed</p>
                    {connectionStatus.version && (
                      <p className="text-sm text-muted-foreground">{connectionStatus.version}</p>
                    )}
                    {connectionStatus.error && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap break-all max-w-lg">
                        {connectionStatus.error}
                      </p>
                    )}
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Seeking Alpha
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestSAConnection}
              disabled={saTesting}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${saTesting ? "animate-spin" : ""}`}
              />
              Test Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {saStatus && (
            <div className="flex items-center gap-3">
              {saStatus.configured ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                  <div className="min-w-0">
                    <p>
                      Credentials configured
                      <span className="text-muted-foreground ml-1">
                        ({saStatus.source === "database" ? "saved in database" : "from environment"})
                      </span>
                    </p>
                    {saStatus.maskedEmail && (
                      <p className="text-sm text-muted-foreground font-mono">
                        {saStatus.maskedEmail}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  <p>No Seeking Alpha credentials configured</p>
                </>
              )}
            </div>
          )}

          {saStatus?.browser?.blocked && (
            <div className="flex items-center gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
              <div>
                <p className="font-medium">Seeking Alpha is blocking requests (captcha)</p>
                <p className="text-sm text-muted-foreground">
                  SA data will be skipped during report generation until the block clears.
                  {saStatus.browser.blockedAt && (
                    <> Blocked since {new Date(saStatus.browser.blockedAt).toLocaleString()}.</>
                  )}
                  {saStatus.browser.lastSuccessAt && (
                    <> Last successful fetch: {new Date(saStatus.browser.lastSuccessAt).toLocaleString()}.</>
                  )}
                </p>
              </div>
            </div>
          )}

          {saTestResult && (
            <div className="flex items-center gap-3">
              {saTestResult.ok ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <p>Connection successful — data is accessible</p>
                    <p className="text-sm text-muted-foreground">
                      {saTestResult.premium
                        ? "Premium access — full ratings unlocked"
                        : "Guest access — some ratings may be limited"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <p>Connection failed — could not fetch data from Seeking Alpha</p>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sa-email">Email</Label>
            <Input
              id="sa-email"
              type="email"
              placeholder="your@email.com"
              value={saEmail}
              onChange={(e) => setSaEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sa-password">Password</Label>
            <Input
              id="sa-password"
              type="password"
              placeholder="••••••••"
              value={saPassword}
              onChange={(e) => setSaPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveSACredentials()}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveSACredentials}
              disabled={saSaving || !saEmail.trim() || !saPassword}
            >
              {saSaving ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saSaving ? "Saving..." : "Save"}
            </Button>
            {saStatus?.source === "database" && (
              <Button
                variant="outline"
                onClick={handleRemoveSACredentials}
                disabled={saRemoving}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            )}
          </div>
          {saSaveSuccess && (
            <p className="text-sm text-green-600">Credentials saved</p>
          )}
          <p className="text-sm text-muted-foreground">
            Optional. Providing Seeking Alpha credentials unlocks premium metrics and
            community discussion data. Without credentials, public data is still collected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
