import type { ResearchReportPreview } from "@assup/shared";

const STRING_FIELDS = new Set(["recommendation", "summary", "fullReport"]);

/**
 * Pull the report fields out of synthesizer output that is still streaming.
 *
 * The synthesizer answers with one JSON object whose fields arrive in order
 * (recommendation, confidence, summary, fullReport, ...). This walks the
 * top-level object and returns whatever is readable so far, including the
 * prefix of a string that is still being written. A number at the very end
 * is left out because more digits may follow. It is a preview only — the
 * stored report always comes from the strict parser once the stream ends.
 */
export function parsePartialReport(text: string): ResearchReportPreview {
  const preview: ResearchReportPreview = {};
  let i = text.indexOf("{");
  if (i === -1) return preview;
  i++;

  while (i < text.length) {
    i = skipWhitespaceAndCommas(text, i);
    if (text[i] !== '"') break;

    const key = readString(text, i);
    if (!key.complete) break;
    i = skipWhitespace(text, key.end);
    if (text[i] !== ":") break;
    i = skipWhitespace(text, i + 1);
    if (i >= text.length) break;

    const ch = text[i];
    if (ch === '"') {
      const value = readString(text, i);
      if (STRING_FIELDS.has(key.value)) {
        (preview as Record<string, string>)[key.value] = value.value;
      }
      if (!value.complete) break;
      i = value.end;
    } else if (ch === "{" || ch === "[") {
      const end = skipComposite(text, i);
      if (end === -1) break;
      i = end;
    } else {
      let end = i;
      while (end < text.length && !/[,}\s]/.test(text[end])) end++;
      if (end >= text.length) break; // number may still be growing
      const n = Number(text.slice(i, end));
      if (key.value === "confidence" && Number.isFinite(n)) preview.confidence = n;
      i = end;
    }
  }

  return preview;
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

function skipWhitespaceAndCommas(text: string, i: number): number {
  while (i < text.length && (/\s/.test(text[i]) || text[i] === ",")) i++;
  return i;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

/** Read a JSON string starting at the opening quote. `end` is the index after the closing quote. */
function readString(text: string, start: number): { value: string; end: number; complete: boolean } {
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value, end: i + 1, complete: true };
    if (ch !== "\\") {
      value += ch;
      i++;
      continue;
    }
    const esc = text[i + 1];
    if (esc === undefined) break;
    if (esc === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    value += SIMPLE_ESCAPES[esc] ?? esc;
    i += 2;
  }
  return { value, end: text.length, complete: false };
}

/** Skip a balanced object or array. Returns the index after it, or -1 if it is not finished yet. */
function skipComposite(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const s = readString(text, i);
      if (!s.complete) return -1;
      i = s.end;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}
