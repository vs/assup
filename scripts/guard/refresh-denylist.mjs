#!/usr/bin/env node
/**
 * Build the private leak-guard denylist (~/.config/assup-guard/denylist.txt) from YOUR local data:
 * every symbol you have traded, received cash for, tracked or assigned, plus your IBKR account ids.
 * The file lives outside the repository and is never committed. Re-run after importing new data.
 *
 * Symbols that already appear in the committed tree are skipped: they are public by now
 * (generic index/ETF names used by the code, or the fictional demo portfolio).
 * Lines below "# --- manual ---" are preserved, so you can add your own entries there.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const DIR = process.env.ASSUP_GUARD_DIR || join(homedir(), ".config", "assup-guard");
const FILE = join(DIR, "denylist.txt");
const MANUAL = "# --- manual ---";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ["backend/.env", ".env"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\n]+)/m);
    if (m) return m[1];
  }
  throw new Error("DATABASE_URL is not set and was not found in backend/.env or .env");
}

const SYMBOL_QUERIES = [
  "SELECT DISTINCT underlying AS s FROM imported_trades WHERE underlying IS NOT NULL",
  "SELECT DISTINCT split_part(symbol, ' ', 1) AS s FROM imported_trades",
  "SELECT DISTINCT split_part(symbol, ' ', 1) AS s FROM cash_transactions WHERE symbol IS NOT NULL",
  "SELECT DISTINCT split_part(symbol, ' ', 1) AS s FROM corporate_actions WHERE symbol IS NOT NULL",
  "SELECT DISTINCT symbol AS s FROM dividend_report_records",
  "SELECT DISTINCT symbol AS s FROM wheel_trackers",
  "SELECT DISTINCT symbol AS s FROM security_assignments",
];

const symbols = new Set();
const accounts = new Set();
let sources = 0;

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
for (const q of SYMBOL_QUERIES) {
  try {
    const { rows } = await client.query(q);
    rows.forEach((r) => r.s && symbols.add(r.s));
    sources++;
  } catch (e) {
    console.warn(`  skipped a source (${e.message.split("\n")[0]})`);
  }
}
try {
  const { rows } = await client.query("SELECT DISTINCT account_number AS a FROM dividend_report_uploads WHERE account_number IS NOT NULL");
  rows.forEach((r) => accounts.add(r.a));
} catch {
  /* table may not exist on older schemas */
}
await client.end();

// Live positions from the running backend, if it is up.
try {
  const res = await fetch("http://localhost:3000/api/positions", { signal: AbortSignal.timeout(20000) });
  if (res.ok) {
    for (const p of await res.json()) {
      symbols.add(p.underlying || String(p.symbol).split(" ")[0]);
      if (p.account) accounts.add(p.account);
    }
    sources++;
  }
} catch {
  console.warn("  backend not reachable on :3000 — live positions not included");
}

const inTree = (t, extra = []) => {
  try {
    execFileSync("git", ["grep", "-q", "-w", ...extra, "-F", "-e", t, "--"], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const clean = [...symbols].map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.]{1,7}$/.test(s));
const tickers = []; // [symbol, caseInsensitive]
let skipped = 0;
for (const t of [...new Set(clean)].sort()) {
  if (inTree(t)) {
    skipped++;
    continue;
  }
  // Lower/Capitalized forms are only matched when they are not ordinary words in the code (a ticker such as LOOP vs the word "loop").
  const ci = t.length >= 4 && !inTree(t, ["-i"]);
  tickers.push([t, ci]);
}
const privateSet = new Set(tickers.map(([t]) => t));

// Distinctive words from the names of your holdings (profile cache + IBKR trade descriptions).
const STOP = new Set(("INC CORP CORPORATION LTD LIMITED PLC NV SA AG SE CO COMPANY HOLDINGS HOLDING GROUP CLASS ETF ETN TRUST FUND " +
  "SHARES SHARE ADR ADS THE AND OF COM NEW ORD REIT LP LLC PHYSICAL GLOBAL INTERNATIONAL SYSTEMS TECHNOLOGIES TECHNOLOGY " +
  "CAPITAL ENERGY RESOURCES FINANCIAL INDUSTRIES PHARMACEUTICALS THERAPEUTICS HEALTH HEALTHCARE SILVER GOLD MINERS MINING " +
  "INDEX ISHARES VANGUARD SPDR SELECT SECTOR MARKET MARKETS INVESTMENT INVESTMENTS PARTNERS BANCORP BANK AMERICA AMERICAN " +
  "NORTH SOUTH EAST WEST UNITED STATES US USA DIVIDEND INCOME GROWTH VALUE EQUITY BOND BONDS TREASURY YEAR SERVICES " +
  "SOLUTIONS WORLD PLATFORMS NETWORKS SOFTWARE DATA CLOUD MEDIA PROPERTIES REALTY OIL GAS POWER STRATEGY ACQUISITION").split(" "));
const nameRows = [];
const client2 = new pg.Client({ connectionString: databaseUrl() });
await client2.connect();
for (const q of [
  "SELECT symbol AS s, company_name AS n FROM ticker_profile WHERE company_name IS NOT NULL",
  "SELECT DISTINCT coalesce(underlying, split_part(symbol, ' ', 1)) AS s, description AS n FROM imported_trades WHERE sec_type = 'STK' AND description IS NOT NULL",
]) {
  try {
    nameRows.push(...(await client2.query(q)).rows);
  } catch {
    /* optional source */
  }
}
await client2.end();
const words = new Set();
for (const { s, n } of nameRows) {
  if (!privateSet.has(String(s).toUpperCase())) continue;
  for (const w of String(n).toUpperCase().split(/[^A-Z]+/)) {
    if (w.length >= 5 && !STOP.has(w) && !privateSet.has(w) && !inTree(w, ["-i"])) words.add(w);
  }
}

const accountIds = [...accounts].filter((a) => a && a !== "U1234567" && a !== "U00000000").sort();

let manual = `${MANUAL}\n# Add your own entries below: "ticker XYZ", "literal some text", "regex pattern".\n`;
if (existsSync(FILE)) {
  const old = readFileSync(FILE, "utf8");
  const i = old.indexOf(MANUAL);
  if (i >= 0) manual = old.slice(i);
}

mkdirSync(DIR, { recursive: true, mode: 0o700 });
chmodSync(DIR, 0o700);
const body = [
  "# assup leak-guard private denylist — generated by scripts/guard/refresh-denylist.mjs",
  `# ${new Date().toISOString()} — DO NOT COMMIT. Regenerate after importing new trades.`,
  ...accountIds.map((a) => `literal ${a}`),
  ...tickers.map(([t, ci]) => `${ci ? "ticker-ci" : "ticker"} ${t}`),
  ...[...words].sort().map((w) => `word-ci ${w}`),
  "",
  manual.trimEnd(),
  "",
].join("\n");
writeFileSync(FILE, body, { mode: 0o600 });
chmodSync(FILE, 0o600);

console.log(`leak-guard denylist written to ${FILE}`);
console.log(`  ${tickers.length} private tickers, ${words.size} company-name words, ${accountIds.length} account id(s) from ${sources} sources`);
console.log(`  ${skipped} symbols skipped because they are already public in the repo`);
