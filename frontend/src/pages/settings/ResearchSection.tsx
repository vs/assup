import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Key,
  X,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { researchApi } from "@/api/research";
import { settingsApi } from "@/api/settings";

const AVAILABLE_MODELS = [
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
] as const;

interface ResearchSettings {
  synthesizerMode: "claude-cli" | "api";
  model?: string;
}

interface AuthStatus {
  configured: boolean;
  source: string;
  maskedToken?: string;
}

interface SAAuthStatus {
  configured: boolean;
  source: string;
  maskedKey?: string;
}

interface RedditAuthStatus {
  configured: boolean;
  source: string;
  maskedClientId?: string;
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

  // Reddit state
  const [redditStatus, setRedditStatus] = useState<RedditAuthStatus | null>(null);
  const [redditClientId, setRedditClientId] = useState("");
  const [redditClientSecret, setRedditClientSecret] = useState("");
  const [redditSaving, setRedditSaving] = useState(false);
  const [redditRemoving, setRedditRemoving] = useState(false);
  const [redditTesting, setRedditTesting] = useState(false);
  const [redditSaveSuccess, setRedditSaveSuccess] = useState(false);
  const [redditTestResult, setRedditTestResult] = useState<{
    ok: boolean;
    hasData: boolean;
    error?: string;
  } | null>(null);

  // Seeking Alpha state
  const [saStatus, setSaStatus] = useState<SAAuthStatus | null>(null);
  const [saApiKey, setSaApiKey] = useState("");
  const [saSaving, setSaSaving] = useState(false);
  const [saRemoving, setSaRemoving] = useState(false);
  const [saTesting, setSaTesting] = useState(false);
  const [saSaveSuccess, setSaSaveSuccess] = useState(false);
  const [saTestResult, setSaTestResult] = useState<{
    ok: boolean;
    hasData: boolean;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Load fast settings first — don't block on slow claude CLI check
      const [savedSettings, auth, saAuth, redditAuth] = await Promise.all([
        settingsApi
          .get<ResearchSettings>("research")
          .then((r) => r.value)
          .catch(() => defaultSettings),
        researchApi.getAuthStatus().catch(() => null),
        researchApi.getSAAuthStatus().catch(() => null),
        researchApi.getRedditAuthStatus().catch(() => null),
      ]);
      setSettings(savedSettings);
      setAuthStatus(auth);
      setSaStatus(saAuth);
      setRedditStatus(redditAuth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Load claude status in background (spawns CLI, can be slow)
    researchApi.getClaudeStatus().then(setConnectionStatus).catch(() => {});
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

  const handleModelChange = async (model: string) => {
    const prev = settings;
    const newSettings: ResearchSettings = { ...settings, model };
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

  const handleSaveRedditCredentials = async () => {
    if (!redditClientId.trim() || !redditClientSecret.trim()) return;
    setRedditSaving(true);
    setRedditSaveSuccess(false);
    setError(null);
    try {
      await researchApi.setRedditCredentials(
        redditClientId.trim(),
        redditClientSecret.trim()
      );
      setRedditStatus(await researchApi.getRedditAuthStatus());
      setRedditClientId("");
      setRedditClientSecret("");
      setRedditTestResult(null);
      setRedditSaveSuccess(true);
      setTimeout(() => setRedditSaveSuccess(false), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save Reddit credentials"
      );
    } finally {
      setRedditSaving(false);
    }
  };

  const handleRemoveRedditCredentials = async () => {
    setRedditRemoving(true);
    setError(null);
    try {
      await researchApi.deleteRedditCredentials();
      setRedditStatus(await researchApi.getRedditAuthStatus());
      setRedditTestResult(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove Reddit credentials"
      );
    } finally {
      setRedditRemoving(false);
    }
  };

  const handleTestRedditConnection = async () => {
    setRedditTesting(true);
    setRedditTestResult(null);
    try {
      setRedditTestResult(await researchApi.testRedditConnection());
    } catch (err) {
      setRedditTestResult({
        ok: false,
        hasData: false,
        error: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRedditTesting(false);
    }
  };

  const handleSaveSACredentials = async () => {
    if (!saApiKey.trim()) return;
    setSaSaving(true);
    setSaSaveSuccess(false);
    setError(null);
    try {
      await researchApi.setSAApiKey(saApiKey.trim());
      setSaStatus(await researchApi.getSAAuthStatus());
      setSaApiKey("");
      setSaTestResult(null);
      setSaSaveSuccess(true);
      setTimeout(() => setSaSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save API key");
    } finally {
      setSaSaving(false);
    }
  };

  const handleRemoveSACredentials = async () => {
    setSaRemoving(true);
    setError(null);
    try {
      await researchApi.deleteSAApiKey();
      setSaStatus(await researchApi.getSAAuthStatus());
      setSaTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove API key");
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
    } catch {
      setSaTestResult({ ok: false, hasData: false });
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
          <CardTitle>Model</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Claude Model</Label>
              <p className="text-sm text-muted-foreground">
                Model used for report synthesis and analysis
              </p>
            </div>
            <Select
              value={settings.model || "claude-sonnet-4-6"}
              onValueChange={handleModelChange}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  <X className="h-4 w-4 mr-2" />
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
              Reddit (social signal)
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestRedditConnection}
              disabled={redditTesting}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${redditTesting ? "animate-spin" : ""}`}
              />
              Test Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {redditStatus && (
            <div className="flex items-center gap-3">
              {redditStatus.configured ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                  <div className="min-w-0">
                    <p>
                      Credentials configured
                      <span className="text-muted-foreground ml-1">
                        ({redditStatus.source === "database"
                          ? "saved in database"
                          : "from environment"})
                      </span>
                    </p>
                    {redditStatus.maskedClientId && (
                      <p className="text-sm text-muted-foreground font-mono">
                        {redditStatus.maskedClientId}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  <p>No Reddit credentials configured — social signal is off</p>
                </>
              )}
            </div>
          )}

          {redditTestResult && (
            <div className="flex items-center gap-3">
              {redditTestResult.ok ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <p>Connection successful — Reddit search is accessible</p>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  <p className="min-w-0 break-words">
                    {redditTestResult.error || "Connection failed"}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reddit-client-id">Client ID</Label>
            <Input
              id="reddit-client-id"
              placeholder="Enter your Reddit app client ID"
              value={redditClientId}
              onChange={(e) => setRedditClientId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reddit-client-secret">Client Secret</Label>
            <Input
              id="reddit-client-secret"
              type="password"
              placeholder="Enter your Reddit app client secret"
              value={redditClientSecret}
              onChange={(e) => setRedditClientSecret(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleSaveRedditCredentials()
              }
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveRedditCredentials}
              disabled={
                redditSaving ||
                !redditClientId.trim() ||
                !redditClientSecret.trim()
              }
            >
              {redditSaving ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {redditSaving ? "Saving..." : "Save"}
            </Button>
            {redditStatus?.source === "database" && (
              <Button
                variant="outline"
                onClick={handleRemoveRedditCredentials}
                disabled={redditRemoving}
              >
                <X className="h-4 w-4 mr-2" />
                Remove
              </Button>
            )}
          </div>
          {redditSaveSuccess && (
            <p className="text-sm text-green-600">Reddit credentials saved</p>
          )}
          <p className="text-sm text-muted-foreground">
            Reddit closed its unauthenticated API, so the social signal needs an
            app credential. Create a <span className="font-medium">script</span>{" "}
            app at reddit.com/prefs/apps — the client ID sits under the app name,
            the secret next to "secret".
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Seeking Alpha (RapidAPI)
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
                      API key configured
                      <span className="text-muted-foreground ml-1">
                        ({saStatus.source === "database"
                          ? "saved in database"
                          : "from environment"})
                      </span>
                    </p>
                    {saStatus.maskedKey && (
                      <p className="text-sm text-muted-foreground font-mono">
                        {saStatus.maskedKey}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  <p>No RapidAPI key configured</p>
                </>
              )}
            </div>
          )}

          {saTestResult && (
            <div className="flex items-center gap-3">
              {saTestResult.ok ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <p>Connection successful — data is accessible</p>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <p>
                    Connection failed — could not fetch data from Seeking Alpha
                  </p>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sa-api-key">RapidAPI Key</Label>
            <Input
              id="sa-api-key"
              type="password"
              placeholder="Enter your RapidAPI key"
              value={saApiKey}
              onChange={(e) => setSaApiKey(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleSaveSACredentials()
              }
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveSACredentials}
              disabled={saSaving || !saApiKey.trim()}
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
                <X className="h-4 w-4 mr-2" />
                Remove
              </Button>
            )}
          </div>
          {saSaveSuccess && (
            <p className="text-sm text-green-600">API key saved</p>
          )}
          <p className="text-sm text-muted-foreground">
            Provide a RapidAPI key for Seeking Alpha data (metrics, articles,
            comments). Get one at rapidapi.com/apidojo/api/seeking-alpha.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
