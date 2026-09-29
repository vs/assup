/**
 * Leak-guard rules: detect secrets, personal data and portfolio data before they reach the
 * public repository. Pure functions — no git or filesystem access (see scan.mjs for that).
 *
 * A finding is { rule, file, line, match, severity } where severity is "block" or "warn".
 */

// ---------- generic secret formats -------------------------------------------------------
const SECRET_PATTERNS = [
  ["anthropic-key", /sk-ant-[a-z0-9]{2,8}-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["stripe-key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
  ["rapidapi-key", /\b[0-9a-f]{10}msh[0-9a-f]{15,}jsn[0-9a-f]{10,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  // FLEX Web Service tokens are long numeric strings; conIds and timestamps are far shorter.
  ["long-numeric-token", /\b\d{18,30}\b/g],
];

// Private keys are blocked even on guard:allow lines.
const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g;

// key = "long-random-value" style assignments (not placeholders, not env lookups)
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|auth)[A-Za-z0-9_]*)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi;
const PLACEHOLDER = /^(?:x+|\*+|\.\.\.|<.*>|\$\{.*\}|your[-_].*|changeme|example.*|test[-_].*|dummy.*|placeholder.*|process\.env.*)$/i;

const DB_URL = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:([^@\s]+)@/g;
const DB_PASSWORD_ALLOW = new Set(["assup_dev", "research_dev", "password", "postgres", "test", "secret", "pass", "dummy"]);

// ---------- personal identifiers ---------------------------------------------------------
const IBKR_ACCOUNT = /\b[UDF]\d{7,8}\b/g;
const ACCOUNT_ALLOW = new Set(["U1234567", "U00000000", "U0000000"]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_ALLOW = /(?:noreply|no-reply|^your?|^user|^name)@|@(?:example\.(?:com|org|net)|assup\.local|users\.noreply\.github\.com|anthropic\.com)$/i;

// container users (assup, node, app) and doc placeholders are not personal
const HOME_PATH = /(?:\/Users|\/home)\/(?!(?:you|user|username|runner|me|assup|node|app)\/)[A-Za-z0-9._-]+\/|~\/Desktop\/|C:\\Users\\[^\\\s]+\\/g;

// ---------- file-level rules -------------------------------------------------------------
const DATA_EXPORT_EXT = /\.(?:csv|xml|xlsx?|ods|ofx|qfx|pdf|json)$/i;
const FIXTURE_DIRS = /(?:^|\/)(?:__tests__\/fixtures|test\/fixtures|fixtures)\//;
// static app data (public reference data such as the macro calendar) is fine; its content is still scanned
const ALWAYS_OK_DATA = /(?:^|\/)src\/data\/[^/]+\.json$|(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|components\.json|tauri\.conf\.json|capabilities\/[^/]+\.json|\.vscode\/[^/]+\.json|manifest\.json|[^/]*\.schema\.json|eslint[^/]*\.json)$/;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|heic|tiff?)$/i;
const IMAGE_OK_DIRS = /^(?:docs\/images\/|frontend\/public\/|frontend\/src\/assets\/|desktop\/src-tauri\/icons\/)/;
const SECRET_FILES = /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|[^/]*\.(?:pem|p12|pfx|key|keystore|jks|kdbx)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.netrc|\.npmrc|\.pgpass|credentials(?:\.json)?)$/i;
const SESSION_DIRS = /(?:^|\/)(?:\.sa-session|\.playwright-mcp|\.claude|\.superpowers|\.idea)\//;
const EXPORT_NAMES = /(?:^|\/)[^/]*(?:U\d{7,8}|flex[_-]?(?:report|query|statement)|activity[_-]?statement|dividend[_-]?report|portfolio|positions|trades)[^/]*\.(?:csv|xml|xlsx?|pdf)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function redact(s) {
  if (s.length <= 6) return s[0] + "…";
  return `${s.slice(0, 3)}…${s.slice(-2)} (${s.length} chars)`;
}

/**
 * @param {{file:string,line:number,text:string}[]} lines  added lines (or message lines)
 * @param {{denylist?:{tickers:string[],literals:string[],regexes:RegExp[]}, envSecrets?:string[], allow?:string[]}} ctx
 */
export function scanLines(lines, ctx = {}) {
  const findings = [];
  const allow = new Set(ctx.allow ?? []);
  const deny = ctx.denylist ?? { tickers: [], tickersCi: [], literals: [], regexes: [] };
  const tickerRx = deny.tickers.length ? buildTickerRegex(deny.tickers, deny.tickersCi ?? []) : null;
  const wordRx = deny.words?.length
    ? new RegExp(`(?<![A-Za-z])(${deny.words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z])`, "gi")
    : null;
  const add = (rule, l, match, show = redact(match), severity = "block") => {
    if (allow.has(match)) return;
    findings.push({ rule, file: l.file, line: l.line, match: show, severity });
  };

  for (const l of lines) {
    const t = l.text;
    // Exact values from local .env files are always blocked, even on guard:allow lines.
    for (const v of ctx.envSecrets ?? []) if (t.includes(v)) add("local-env-secret-value", l, v, `[value of a local .env entry, ${v.length} chars]`);
    for (const m of t.matchAll(PRIVATE_KEY)) add("private-key", l, m[0]);
    if (/guard:allow/.test(t)) continue;

    for (const [name, rx] of SECRET_PATTERNS) for (const m of t.matchAll(rx)) add(name, l, m[0]);
    for (const m of t.matchAll(ASSIGNMENT)) {
      const val = m[2];
      // real credentials are random; skip URLs and readable kebab/snake test values like "secret-value-1234"
      if (!PLACEHOLDER.test(val) && !/^https?:\/\//.test(val) && !/^[a-z]+(?:[._-][a-z0-9]+)+$/.test(val) && /\d/.test(val) && /[A-Za-z]/.test(val)) add("hardcoded-credential", l, val);
    }
    for (const m of t.matchAll(DB_URL)) {
      const pw = m[1];
      if (!DB_PASSWORD_ALLOW.has(pw) && !/^\$\{.*\}$|^\$[A-Z_]+$/.test(pw)) add("db-url-password", l, pw);
    }
    for (const m of t.matchAll(IBKR_ACCOUNT)) if (!ACCOUNT_ALLOW.has(m[0])) add("ibkr-account-id", l, m[0], m[0]);
    for (const m of t.matchAll(EMAIL)) if (!EMAIL_ALLOW.test(m[0]) && !/\.(?:png|svg|jpe?g|webp)$/i.test(m[0]) && !/^[^@]+@\d+x\./.test(m[0])) add("email-address", l, m[0], m[0]);
    for (const m of t.matchAll(HOME_PATH)) add("personal-path", l, m[0], m[0]);
    if (tickerRx) for (const m of t.matchAll(tickerRx)) add("held-ticker", l, m[1] ?? m[2], m[1] ?? m[2]);
    if (wordRx) for (const m of t.matchAll(wordRx)) add("holding-name", l, m[1], m[1]);
    for (const lit of deny.literals) if (t.includes(lit)) add("denylisted-literal", l, lit);
    for (const rx of deny.regexes) for (const m of t.matchAll(rx)) add("denylisted-pattern", l, m[0]);
  }
  return findings;
}

function buildTickerRegex(tickers, caseInsensitive = []) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const upper = [...tickers].sort((a, b) => b.length - a.length).map(esc);
  // Lower/Capitalized forms (qzabDiv, Qzab) only for tickers that are not ordinary words in the code.
  const lower = caseInsensitive.flatMap((t) => [t.toLowerCase(), t[0] + t.slice(1).toLowerCase()]).map(esc);
  const parts = [`(?<![A-Za-z0-9_])(${upper.join("|")})(?![A-Za-z0-9_])`];
  if (lower.length) parts.push(`(?<![A-Za-z0-9_])(${lower.join("|")})(?![a-z0-9_])`);
  return new RegExp(parts.join("|"), "g");
}

/**
 * @param {{path:string,status:string,size?:number}[]} files  added/changed paths
 */
export function scanPaths(files) {
  const findings = [];
  for (const f of files) {
    if (f.status === "D") continue;
    const p = f.path;
    const add = (rule, severity = "block") => findings.push({ rule, file: p, line: 0, match: p, severity });
    if (SECRET_FILES.test(p)) add("secret-file");
    if (SESSION_DIRS.test(p)) add("local-session-or-tool-dir");
    if (FIXTURE_DIRS.test(p) && DATA_EXPORT_EXT.test(p)) {
      if (f.status === "A") add("fixture-must-be-synthetic", "warn");
    } else if (EXPORT_NAMES.test(p)) add("broker-export-filename");
    else if (DATA_EXPORT_EXT.test(p) && !ALWAYS_OK_DATA.test(p) && f.status === "A") add("data-file-outside-fixtures");
    if (IMAGE_EXT.test(p) && f.status === "A") {
      if (!IMAGE_OK_DIRS.test(p)) add("image-outside-allowed-dirs");
      else if (p.startsWith("docs/images/")) add("screenshot-check", "warn");
    }
    if ((f.size ?? 0) > MAX_FILE_BYTES) add("file-too-large");
  }
  return findings;
}

/**
 * Parse the private denylist: "ticker XYZ", "ticker-ci XYZ" (also lower/Capitalized forms),
 * "word-ci Word" (company-name word, any case), "literal ...", "regex ...".
 */
export function parseDenylist(text) {
  const out = { tickers: [], tickersCi: [], literals: [], regexes: [], words: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [kind, ...rest] = line.split(/\s+/);
    const value = rest.join(" ");
    if (!value) continue;
    if (kind === "ticker" || kind === "ticker-ci") out.tickers.push(value.toUpperCase());
    if (kind === "ticker-ci") out.tickersCi.push(value.toUpperCase());
    else if (kind === "literal") out.literals.push(value);
    else if (kind === "word-ci") out.words.push(value);
    else if (kind === "regex") out.regexes.push(new RegExp(value, "g"));
  }
  return out;
}

/** Parse KEY=VALUE env files; return values that look like secrets. */
export function envSecretValues(text) {
  const vals = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (v.length < 8 || /^(?:true|false|\d+|localhost|127\.0\.0\.1)$/i.test(v)) continue;
    vals.push(v);
    // also the password inside connection strings
    const pw = v.match(/:\/\/[^:\s/@]+:([^@\s]+)@/);
    if (pw && pw[1].length >= 6) vals.push(pw[1]);
  }
  return vals;
}

/** Bash commands Claude must not run in this repo. Returns a reason string or null. */
export function checkBashCommand(cmd) {
  // Ignore text inside heredocs and quoted strings (commit messages may mention -n or --force).
  const c = cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, " ")
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\s+/g, " ");
  const gitSub = (sub) => new RegExp(`\\bgit\\b(?:\\s+-[cC]\\s+\\S+|\\s+--?[a-z-]+(?:=\\S+)?)*\\s+${sub}\\b`);
  if (/ASSUP_GUARD_(?:ALLOW|SKIP)/.test(c)) return "Overriding the leak guard (ASSUP_GUARD_ALLOW) is reserved for the user.";
  if (/\bgit\b.*\s--no-verify\b/.test(c)) return "--no-verify skips the leak-guard git hooks.";
  if (gitSub("commit").test(c) && /\scommit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(c)) return "`git commit -n` skips the leak-guard git hooks.";
  if (gitSub("push").test(c) && /\s(?:--force(?:-with-lease|-if-includes)?\b|-[a-zA-Z]*f[a-zA-Z]*\b|\+[\w/.-]*(?::|\s|$))/.test(c.slice(c.search(/\bpush\b/)))) return "Force-pushing rewrites public history.";
  if (/core\.hooksPath/.test(c) && !/core\.hooksPath\s+\.githooks\b/.test(c) && !/--get\b|--list\b|\bconfig\s+core\.hooksPath\s*($|[;&|])/.test(c)) return "Changing core.hooksPath would disable the leak-guard hooks.";
  if (/\bgit\b.*\b(?:filter-repo|filter-branch)\b|\bgit-filter-repo\b/.test(c)) return "History rewriting is not allowed on the public repository.";
  if (/\brm\b[^|;&]*\.githooks\b|\brm\b[^|;&]*scripts\/guard\b/.test(c)) return "Deleting the leak guard is not allowed.";
  return null;
}
