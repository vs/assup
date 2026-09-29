#!/usr/bin/env node
/**
 * Leak guard — keeps secrets, personal data and portfolio data out of this public repository.
 *
 *   --staged                  pre-commit: scan the staged diff
 *   --commit-msg <file>       commit-msg: scan the commit message
 *   --pre-push                pre-push: read refs from stdin, scan every outgoing commit, refuse
 *                             non-fast-forward pushes to main
 *   --range <base>..<tip>     scan every commit in a range (CI)
 *   --tree                    scan every tracked file as it is now
 *   --claude-hook             Claude Code PreToolUse (Write/Edit/MultiEdit/NotebookEdit), JSON on stdin
 *   --claude-bash             Claude Code PreToolUse (Bash), JSON on stdin
 *
 * Personal rules come from ~/.config/assup-guard/ (never committed):
 *   denylist.txt   "ticker XYZ" / "literal ..." / "regex ..." — build it with refresh-denylist.mjs
 *   secrets.txt    extra secret values, one per line
 * Values from local .env files are blocked verbatim.
 *
 * False positive? Put `guard:allow` in a comment on that line, or run the command yourself with
 * ASSUP_GUARD_ALLOW="exact-match-1,exact-match-2".
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { checkBashCommand, envSecretValues, parseDenylist, scanLines, scanPaths } from "./rules.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO = /^0+$/;
const PROTECTED_REFS = new Set(["refs/heads/main"]);

const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...opts });
const gitOk = (args) => {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
};

const ROOT = git(["rev-parse", "--show-toplevel"]).trim();
const CONFIG_DIR = process.env.ASSUP_GUARD_DIR || join(homedir(), ".config", "assup-guard");

// ---------- context ----------------------------------------------------------------------
function loadContext() {
  const denyFile = join(CONFIG_DIR, "denylist.txt");
  const denylist = existsSync(denyFile) ? parseDenylist(readFileSync(denyFile, "utf8")) : { tickers: [], tickersCi: [], literals: [], regexes: [], words: [] };

  const candidates = [];
  for (const f of [".env", ".env.local", "backend/.env", "backend/.env.local", "frontend/.env", "frontend/.env.local", "desktop/.env"]) {
    const p = join(ROOT, f);
    if (existsSync(p)) candidates.push(...envSecretValues(readFileSync(p, "utf8")));
  }
  const extra = join(CONFIG_DIR, "secrets.txt");
  if (existsSync(extra)) candidates.push(...readFileSync(extra, "utf8").split("\n").map((s) => s.trim()).filter((s) => s.length >= 6 && !s.startsWith("#")));
  // Values that are already public (defaults committed in the repo, e.g. assup_dev) are not secrets.
  const envSecrets = [...new Set(candidates)].filter((v) => !gitOk(["grep", "-q", "-F", "-e", v, "HEAD", "--"]));

  const allow = (process.env.ASSUP_GUARD_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { denylist, envSecrets, allow, hasDenylist: existsSync(denyFile) };
}

// ---------- diff parsing -------------------------------------------------------------------
function addedLines(diff) {
  const out = [];
  let file = null;
  let ln = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.slice(6);
    } else if (raw.startsWith("@@")) {
      const m = raw.match(/\+(\d+)/);
      ln = m ? Number(m[1]) : 0;
    } else if (file && raw.startsWith("+")) {
      out.push({ file, line: ln++, text: raw.slice(1) });
    } else if (file && !raw.startsWith("-") && !raw.startsWith("\\")) {
      ln++;
    }
  }
  return out;
}

function nameStatus(args) {
  const out = git([...args, "--name-status", "--no-renames", "-z"]);
  const parts = out.split("\0").filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i += 2) files.push({ status: parts[i][0], path: parts[i + 1] });
  return files;
}

function blobSize(spec) {
  try {
    return Number(git(["cat-file", "-s", spec]).trim());
  } catch {
    return 0;
  }
}

// ---------- modes --------------------------------------------------------------------------
function scanStaged(ctx) {
  const diff = git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--text"]);
  const files = nameStatus(["diff", "--cached"]).map((f) => ({ ...f, size: f.status === "D" ? 0 : blobSize(`:${f.path}`) }));
  return [...scanPaths(files), ...scanLines(addedLines(diff), ctx)];
}

function scanMessage(text, label, ctx) {
  const lines = text.split("\n").map((t, i) => ({ file: label, line: i + 1, text: t })).filter((l) => !l.text.startsWith("#"));
  return scanLines(lines, ctx);
}

function scanCommit(sha, ctx) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).trim().split(" ").slice(1);
  const base = parents[0] ?? EMPTY_TREE;
  const diff = git(["diff", "-U0", "--no-color", "--no-ext-diff", "--text", base, sha]);
  const files = nameStatus(["diff", base, sha]).map((f) => ({ ...f, size: f.status === "D" ? 0 : blobSize(`${sha}:${f.path}`) }));
  const short = sha.slice(0, 8);
  const tag = (f) => ({ ...f, file: `${short} ${f.file}` });
  return [
    ...scanPaths(files).map(tag),
    ...scanLines(addedLines(diff), ctx).map(tag),
    ...scanMessage(git(["log", "-1", "--format=%B", sha]), `${short} (commit message)`, ctx),
  ];
}

function scanRange(range, ctx) {
  const commits = git(["rev-list", "--reverse", range]).split("\n").filter(Boolean);
  return commits.flatMap((c) => scanCommit(c, ctx));
}

function scanPrePush(ctx, stdin) {
  const findings = [];
  for (const line of stdin.split("\n").filter(Boolean)) {
    const [, localSha, remoteRef, remoteSha] = line.split(" ");
    if (ZERO.test(localSha)) continue; // deletion — main is protected server-side
    if (!ZERO.test(remoteSha) && PROTECTED_REFS.has(remoteRef)) {
      if (!gitOk(["cat-file", "-e", remoteSha]) || !gitOk(["merge-base", "--is-ancestor", remoteSha, localSha])) {
        findings.push({ rule: "non-fast-forward-push", file: remoteRef, line: 0, match: "rewrites published history", severity: "block" });
        continue;
      }
    }
    const range = ZERO.test(remoteSha) ? [localSha, "--not", "--remotes"] : [`${remoteSha}..${localSha}`];
    const commits = git(["rev-list", "--reverse", ...range]).split("\n").filter(Boolean);
    for (const c of commits) findings.push(...scanCommit(c, ctx));
  }
  return findings;
}

function scanTree(ctx) {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const findings = scanPaths(files.map((p) => ({ path: p, status: "T", size: blobSize(`HEAD:${p}`) })));
  for (const p of files) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) continue;
    const lines = buf.toString("utf8").split("\n").map((text, i) => ({ file: p, line: i + 1, text }));
    findings.push(...scanLines(lines, ctx));
  }
  return findings;
}

function claudeWriteHook(ctx, input) {
  const ti = input.tool_input ?? {};
  const filePath = ti.file_path ?? ti.notebook_path;
  if (!filePath) return [];
  const abs = isAbsolute(filePath) ? filePath : resolve(input.cwd ?? process.cwd(), filePath);
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return []; // outside this repository
  if (gitOk(["check-ignore", "-q", "--no-index", rel])) return []; // git-ignored: never committed
  const texts = [ti.content, ti.new_string, ti.new_source, ...(ti.edits ?? []).map((e) => e.new_string)].filter((s) => typeof s === "string");
  const lines = texts.flatMap((t) => t.split("\n")).map((text, i) => ({ file: rel, line: i + 1, text }));
  const exists = existsSync(abs);
  return [...scanPaths([{ path: rel, status: exists ? "M" : "A", size: Buffer.byteLength(texts.join("\n")) }]), ...scanLines(lines, ctx)];
}

// ---------- output -------------------------------------------------------------------------
const HELP = {
  "held-ticker": "a symbol from your portfolio (private denylist) — use a fictional ticker",
  "denylisted-literal": "matches your private denylist",
  "holding-name": "part of the name of a company you hold (private denylist)",
  "local-env-secret-value": "a value copied from your local .env",
  "ibkr-account-id": "looks like a real IBKR account number — use U1234567",
  "email-address": "personal e-mail address",
  "personal-path": "path from your machine — use ~/ or a relative path",
  "data-file-outside-fixtures": "data files belong in __tests__/fixtures/ and must be synthetic",
  "broker-export-filename": "looks like a broker/FLEX export",
  "image-outside-allowed-dirs": "images outside docs/images, frontend/public, icons may be real screenshots",
  "screenshot-check": "make sure this was produced by scripts/screenshots (fictional data only)",
  "fixture-must-be-synthetic": "fixture data must be made up — never a real export, even anonymized",
  "non-fast-forward-push": "force-pushing main is not allowed",
};

function report(findings, ctx, where) {
  const blocking = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");
  const lines = [];
  for (const f of [...blocking, ...warnings]) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    const hint = HELP[f.rule] ? ` — ${HELP[f.rule]}` : "";
    lines.push(`  ${f.severity === "block" ? "✗" : "!"} ${loc}  [${f.rule}] ${f.match}${hint}`);
  }
  if (!ctx.hasDenylist && where !== "ci") lines.push("  ! No private denylist yet — run: node scripts/guard/refresh-denylist.mjs");
  if (lines.length) {
    const head = blocking.length ? `leak-guard: blocked ${where} (${blocking.length} problem${blocking.length > 1 ? "s" : ""})` : `leak-guard: ${where} ok, with warnings`;
    process.stderr.write(`${head}\n${lines.join("\n")}\n`);
    if (blocking.length) process.stderr.write("  False positive? Add `guard:allow` to that line, or rerun with ASSUP_GUARD_ALLOW=\"<match>\".\n");
  }
  return blocking.length;
}

// ---------- main ---------------------------------------------------------------------------
const readStdin = () => readFileSync(0, "utf8");
const [mode, arg] = process.argv.slice(2);
const ctx = loadContext();

switch (mode) {
  case "--staged":
    process.exit(report(scanStaged(ctx), ctx, "commit") ? 1 : 0);
  case "--commit-msg":
    process.exit(report(scanMessage(readFileSync(arg, "utf8"), "commit message", ctx), ctx, "commit message") ? 1 : 0);
  case "--pre-push":
    process.exit(report(scanPrePush(ctx, readStdin()), ctx, "push") ? 1 : 0);
  case "--range":
    process.exit(report(scanRange(arg, ctx), ctx, process.env.CI ? "ci" : "range") ? 1 : 0);
  case "--tree":
    process.exit(report(scanTree(ctx), ctx, process.env.CI ? "ci" : "tree") ? 1 : 0);
  case "--claude-hook": {
    const n = report(claudeWriteHook(ctx, JSON.parse(readStdin() || "{}")), ctx, "write");
    process.exit(n ? 2 : 0); // exit 2 = block the tool call; stderr goes back to Claude
  }
  case "--claude-bash": {
    const input = JSON.parse(readStdin() || "{}");
    const reason = checkBashCommand(input.tool_input?.command ?? "");
    if (reason) {
      process.stderr.write(`leak-guard: blocked command — ${reason}\nIf this is really needed, ask the user to run it themselves.\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  default:
    process.stderr.write("usage: scan.mjs --staged | --commit-msg <file> | --pre-push | --range <a..b> | --tree | --claude-hook | --claude-bash\n");
    process.exit(64);
}
