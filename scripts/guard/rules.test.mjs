// Run with: npm run guard:test
// Fake secrets are assembled at runtime so this file itself passes the leak guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBashCommand, envSecretValues, parseDenylist, scanLines, scanPaths } from "./rules.mjs";

const line = (text, file = "src/x.ts") => ({ file, line: 1, text });
const rules = (text, ctx) => scanLines([line(text)], ctx).map((f) => f.rule);
const rand = (n) => "aZ3kQ9xW2mP7vL5nR8tY".repeat(4).slice(0, n);

test("generic secret formats", () => {
  assert.deepEqual(rules(`key = "${"sk-ant-" + "api03-" + rand(40)}"`).includes("anthropic-key"), true);
  assert.ok(rules("gh" + "p_" + rand(36)).includes("github-token"));
  assert.ok(rules("AKIA" + "ABCDEFGHIJKLMNOP").includes("aws-access-key"));
  assert.ok(rules("token " + "1234567890".repeat(2) + "1234").includes("long-numeric-token"));
  assert.deepEqual(rules("const conId = 1234567890;"), []);
});

test("private keys are blocked even on guard:allow lines", () => {
  assert.ok(rules("-----BEGIN RSA " + "PRIVATE KEY----- // guard:allow").includes("private-key"));
});

test("hardcoded credentials: random values yes, readable test values no", () => {
  assert.ok(rules(`apiKey: "${rand(24)}"`).includes("hardcoded-credential"));
  assert.deepEqual(rules('clientSecret: "secret-value-1234"'), []);
  assert.deepEqual(rules('const TOKEN_URL = "https://example.com/api/v1/access_token";'), []);
  assert.deepEqual(rules('password: "${DB_PASSWORD}"'), []);
});

test("database URLs with real passwords", () => {
  assert.ok(rules("postgresql://assup:" + "Tr0ub4dor&3@db:5432/assup").includes("db-url-password"));
  assert.deepEqual(rules("postgresql://assup:assup_dev@localhost:5432/assup"), []);
  assert.deepEqual(rules("postgresql://dummy:dummy@localhost:5432/dummy"), []);
});

test("IBKR account ids, e-mails and personal paths", () => {
  assert.ok(rules("account U" + "7654321").includes("ibkr-account-id"));
  assert.deepEqual(rules("account U1234567 / U00000000"), []);
  assert.ok(rules("mail " + "jane.doe" + "@gmail.com").includes("email-address"));
  assert.deepEqual(rules("noreply@anthropic.com research@assup.local"), []);
  assert.ok(rules("/Users/" + "jane/Desktop/export.csv").includes("personal-path"));
  assert.deepEqual(rules("COPY . /home/assup/app"), []);
});

test("private denylist: tickers, case-insensitive tickers, company words, literals", () => {
  const denylist = parseDenylist("ticker-ci QZAB\nticker LOOP\nword-ci Contoso\nliteral acct-42\n");
  const ctx = { denylist };
  assert.ok(rules('symbol: "QZAB"', ctx).includes("held-ticker"));
  assert.ok(rules("const qzabDiv = 1;", ctx).includes("held-ticker"));
  assert.ok(rules("LOOP dividend", ctx).includes("held-ticker"));
  assert.deepEqual(rules("for (const loop of loops) {}", ctx), []); // plain ticker: uppercase only
  assert.deepEqual(rules("const QZABX = 1; PERIOD_LOOP_RE", ctx), []); // longer tokens are different symbols
  assert.ok(rules("CONTOSO LTD SPLIT", ctx).includes("holding-name"));
  assert.ok(rules("ref acct-42", ctx).includes("denylisted-literal"));
});

test("guard:allow and ASSUP_GUARD_ALLOW", () => {
  const ctx = { denylist: parseDenylist("ticker QZAB\n") };
  assert.deepEqual(rules('symbol: "QZAB" // guard:allow', ctx), []);
  assert.deepEqual(rules('symbol: "QZAB"', { ...ctx, allow: ["QZAB"] }), []);
});

test("values from local .env files are blocked verbatim, even on guard:allow lines", () => {
  const secret = rand(20);
  const envSecrets = envSecretValues(`ANTHROPIC_API_KEY=${secret}\nIB_PORT=7496\nFLAG=true\n`);
  assert.deepEqual(envSecrets, [secret]);
  assert.ok(rules(`x ${secret} // guard:allow`, { envSecrets }).includes("local-env-secret-value"));
  const withUrl = envSecretValues(`DATABASE_URL=postgresql://assup:${"Hunter" + "2Pass"}@localhost/assup\n`);
  assert.ok(withUrl.includes("Hunter2Pass"));
});

test("file rules", () => {
  const r = (path, status = "A", size = 10) => scanPaths([{ path, status, size }]).map((f) => `${f.rule}:${f.severity}`);
  assert.deepEqual(r(".env"), ["secret-file:block"]);
  assert.deepEqual(r("backend/.env.production"), ["secret-file:block"]);
  assert.deepEqual(r(".env.example"), []);
  assert.deepEqual(r("certs/server.pem"), ["secret-file:block"]);
  assert.deepEqual(r("backend/.sa-session/cookies.txt"), ["local-session-or-tool-dir:block"]);
  assert.deepEqual(r(`exports/U${7654321}.2025.dividends.csv`), ["broker-export-filename:block"]);
  assert.deepEqual(r("data/trades.csv"), ["broker-export-filename:block"]);
  assert.deepEqual(r("notes/report.xml"), ["data-file-outside-fixtures:block"]);
  assert.deepEqual(r("backend/src/__tests__/fixtures/sample.csv"), ["fixture-must-be-synthetic:warn"]);
  assert.deepEqual(r("screenshots/Screenshot 1.png"), ["image-outside-allowed-dirs:block"]);
  assert.deepEqual(r("docs/images/new.png"), ["screenshot-check:warn"]);
  assert.deepEqual(r("frontend/package.json", "M"), []);
  assert.deepEqual(r("big.bin", "A", 3 * 1024 * 1024), ["file-too-large:block"]);
});

test("bash commands Claude may not run", () => {
  const blocked = [
    "git commit --no-verify -m x",
    "git commit -nm fix",
    "git push --force origin main",
    "git push -f",
    "git push --force-with-lease origin main",
    "git push origin +main",
    "git config core.hooksPath /dev/null",
    "git -c core.hooksPath=/tmp commit -m x",
    "git filter-repo --path x --invert-paths",
    "ASSUP_GUARD_ALLOW=QZAB git commit -m x",
    "rm -rf .githooks",
  ];
  for (const c of blocked) assert.ok(checkBashCommand(c), `should block: ${c}`);
  const allowed = [
    "git push origin feat/leak-guard",
    'git commit -m "document the -n flag and --force pushes"',
    "git commit -m \"$(cat <<'EOF'\nexplain --no-verify\nEOF\n)\"",
    "git log -n 5",
    "git clean -n",
    "git config core.hooksPath",
    "git config core.hooksPath .githooks",
    "npm test",
  ];
  for (const c of allowed) assert.equal(checkBashCommand(c), null, `should allow: ${c}`);
});
