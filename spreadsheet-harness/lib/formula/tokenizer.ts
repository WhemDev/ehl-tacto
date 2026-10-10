/**
 * Excel formula tokenizer. Ports tokenize() from simulation/parser.py
 * character-for-character — same scan order, same fallbacks.
 */

import type { ErrorCode } from "./ast";

export type TokenType =
  | "number" | "string" | "bool" | "error" | "cell" | "func"
  | "lparen" | "rparen" | "comma" | "semicolon" | "colon" | "bang"
  | "plus" | "minus" | "star" | "slash" | "caret" | "amp"
  | "eq" | "neq" | "lt" | "gt" | "lte" | "gte" | "percent" | "sheet" | "eof"
  // Open (whole-column / whole-row) reference halves — "C", "$C" immediately
  // followed by ":", or "3", "$3" immediately followed by ":". See the
  // scan-site comments below for why the colon lookahead makes this
  // unambiguous, and parser.ts for how a pair of these becomes a RangeRef.
  | "colref" | "rowref";

export interface Token {
  readonly type: TokenType;
  readonly value: string | number | boolean | null;
  readonly pos: number;
}

const CELL_RE = /^\$?[A-Za-z]{1,3}\$?\d{1,7}$/;
const FUNC_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
// A bare column ("C", "AB") or bare row ("3"), each optionally $-anchored —
// what's left of "C:C" or "3:3" once CELL_RE (which requires BOTH a column
// AND a row) has already failed to match. Anchored so e.g. "ABC" (too long
// to be a real column but shaped like one) never falls in here by accident.
const COL_ONLY_RE = /^\$?[A-Za-z]{1,3}$/;
const ROW_ONLY_RE = /^\$?\d{1,7}$/;

const ERROR_CODES: ErrorCode[] = [
  "#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NULL!", "#NUM!", "#NAME?",
];

const SIMPLE: Record<string, TokenType> = {
  "(": "lparen", ")": "rparen", ",": "comma", ";": "semicolon",
  ":": "colon", "!": "bang", "+": "plus", "-": "minus",
  "*": "star", "/": "slash", "^": "caret", "&": "amp",
  "=": "eq", "<": "lt", ">": "gt", "%": "percent",
};

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

// Unicode-aware, matching Python's str.isalpha() (simulation/parser.py,
// tokenize()) — an unquoted sheet name like "Ürün" must scan as an
// identifier here, not stop dead at the "Ü". CELL_RE and FUNC_NAME_RE above
// stay ASCII-only on purpose (Excel column letters and canonical function
// names read from a .xlsx are always plain A–Z, even under a localized
// Excel UI); only this broader identifier scan needs Unicode awareness.
function isAlpha(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  const s = formula.replace(/^=+/, "");
  const n = s.length;
  let i = 0;

  while (i < n) {
    const ch = s[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // String literal, with "" as an escaped quote inside it.
    if (ch === '"') {
      let j = i + 1;
      const buf: string[] = [];
      while (j < n) {
        if (s[j] === '"') {
          if (j + 1 < n && s[j + 1] === '"') {
            buf.push('"');
            j += 2;
          } else {
            j += 1;
            break;
          }
        } else {
          buf.push(s[j]);
          j += 1;
        }
      }
      tokens.push({ type: "string", value: buf.join(""), pos: i });
      i = j;
      continue;
    }

    // Error literal.
    if (ch === "#") {
      let matched = false;
      for (const err of ERROR_CODES) {
        if (s.slice(i, i + err.length).toUpperCase() === err.toUpperCase()) {
          tokens.push({ type: "error", value: err, pos: i });
          i += err.length;
          matched = true;
          break;
        }
      }
      if (!matched) i += 1;
      continue;
    }

    // Numbers, including scientific notation.
    if (isDigit(ch) || (ch === "." && i + 1 < n && isDigit(s[i + 1]))) {
      let j = i;
      while (j < n && (isDigit(s[j]) || s[j] === ".")) j++;
      if (j < n && (s[j] === "E" || s[j] === "e")) {
        j++;
        if (j < n && (s[j] === "+" || s[j] === "-")) j++;
        while (j < n && isDigit(s[j])) j++;
      }
      const numText = s.slice(i, j);
      // Whole-row reference half: a bare integer immediately followed by
      // ":" (e.g. the "3" in "3:3"). A bare number token is never itself
      // followed directly by a colon in any other valid Excel grammar —
      // colon is exclusively the range separator — so this lookahead is
      // unambiguous, and the scientific-notation/decimal-point cases above
      // never reach here because /^\d+$/ rejects them (correctly: "3.5:3.5"
      // and "3E2:3E2" are not row references).
      if (j < n && s[j] === ":" && /^\d+$/.test(numText)) {
        tokens.push({ type: "rowref", value: numText, pos: i });
        i = j;
        continue;
      }
      tokens.push({ type: "number", value: Number(numText), pos: i });
      i = j;
      continue;
    }

    // Sheet name in single quotes: 'My Sheet'!
    if (ch === "'") {
      let j = i + 1;
      while (j < n && s[j] !== "'") j++;
      const sheetName = s.slice(i + 1, j);
      j += 1; // skip closing '
      tokens.push({ type: "sheet", value: sheetName, pos: i });
      i = j;
      continue;
    }

    // Two-character operators.
    const two = s.slice(i, i + 2);
    if (two === "<>") { tokens.push({ type: "neq", value: "<>", pos: i }); i += 2; continue; }
    if (two === "<=") { tokens.push({ type: "lte", value: "<=", pos: i }); i += 2; continue; }
    if (two === ">=") { tokens.push({ type: "gte", value: ">=", pos: i }); i += 2; continue; }

    // Single-character operators and punctuation.
    if (ch in SIMPLE) {
      tokens.push({ type: SIMPLE[ch], value: ch, pos: i });
      i += 1;
      continue;
    }

    // Identifiers: TRUE/FALSE, function names, cell references.
    if (ch === "$" || isAlpha(ch) || ch === "_") {
      let j = i;
      const raw: string[] = [];
      while (j < n && (/[\p{L}\p{N}]/u.test(s[j]) || s[j] === "$" || s[j] === "_" || s[j] === ".")) {
        raw.push(s[j]);
        j++;
      }
      const word = raw.join("");

      if (word.toUpperCase() === "TRUE") {
        tokens.push({ type: "bool", value: true, pos: i });
        i = j;
        continue;
      }
      if (word.toUpperCase() === "FALSE") {
        tokens.push({ type: "bool", value: false, pos: i });
        i = j;
        continue;
      }

      // Function call: NAME followed by '('.
      if (j < n && s[j] === "(" && FUNC_NAME_RE.test(word)) {
        tokens.push({ type: "func", value: word.toUpperCase(), pos: i });
        tokens.push({ type: "lparen", value: "(", pos: j });
        i = j + 1;
        continue;
      }

      // Sheet name (unquoted): NAME followed by '!'.
      if (j < n && s[j] === "!") {
        tokens.push({ type: "sheet", value: word, pos: i });
        tokens.push({ type: "bang", value: "!", pos: j });
        i = j + 1;
        continue;
      }

      // Cell reference.
      if (CELL_RE.test(word)) {
        tokens.push({ type: "cell", value: word, pos: i });
        i = j;
        continue;
      }

      // Whole-column reference half: a bare column ("C", "$C") — either
      // side of "C:C"/"$C:$C" (unlike the bare-digit row case above, no
      // colon lookahead is needed here to stay safe: a word shaped like
      // COL_ONLY_RE that reaches this point already failed the "(" and "!"
      // checks above, so as a "func" token it could ONLY ever throw during
      // parsing anyway — funcCall() unconditionally expects "(" right after
      // the name. Reclassifying it as "colref" changes what error a
      // malformed formula gets, never turns a previously-valid parse into
      // an invalid one).
      if (COL_ONLY_RE.test(word)) {
        tokens.push({ type: "colref", value: word, pos: i });
        i = j;
        continue;
      }
      // Whole-row reference half, $-anchored form only ("$3") — same
      // reasoning as colref just above. The bare (non-$) form ("3") never
      // reaches here at all: it's scanned as a number by the digit branch
      // above, which needs the colon lookahead since a bare number is
      // otherwise a completely ordinary numeric literal.
      if (ROW_ONLY_RE.test(word)) {
        tokens.push({ type: "rowref", value: word, pos: i });
        i = j;
        continue;
      }

      // Fallback: treat as a function name without parens.
      tokens.push({ type: "func", value: word.toUpperCase(), pos: i });
      i = j;
      continue;
    }

    // Unknown character — skip.
    i += 1;
  }

  tokens.push({ type: "eof", value: null, pos: i });
  return tokens;
}
