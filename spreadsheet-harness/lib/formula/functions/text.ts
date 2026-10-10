/**
 * Text and string functions. Ports simulation/functions/text_funcs.py in
 * full — see the plan task this was written from for the exact Python line
 * ranges each export below corresponds to.
 *
 * Every function below uses toDisplayString (lib/formula/coerce.ts) for its
 * string coercion — the one shared implementation, not a second local one.
 * That also means every function here inherits toDisplayString's own
 * deliberately-preserved quirk: it renders an ExcelErrorValue as its error
 * code rather than propagating it, so most functions in this file
 * stringify an upstream error instead of returning it — e.g. LEN(#N/A) is
 * 4, the length of the string "#N/A", not an error. This matches
 * text_funcs.py's own _to_str, which every function here calls (via
 * _to_str's TS equivalent) without an isExcelError check first. TEXT is the
 * one exception: its own Python source explicitly checks isinstance(val,
 * ExcelError) before formatting, so it really does propagate an error in
 * its value argument — see the comment on `text` below.
 */

import { excelError, isExcelError, type CellValue, type ExcelErrorValue } from "../ast";
import { toDisplayString } from "../coerce";
import type { ExcelFunction } from "../evaluator-types";
import { pythonRound } from "./math";

// -- single-arg length/case shape --
// text_funcs.py:26-30
export const len: ExcelFunction = (evaluator, args) => toDisplayString(evaluator.resolveArg(args[0])).length;
// text_funcs.py:61-64
export const upper: ExcelFunction = (evaluator, args) => toDisplayString(evaluator.resolveArg(args[0])).toUpperCase();
// text_funcs.py:66-69
export const lower: ExcelFunction = (evaluator, args) => toDisplayString(evaluator.resolveArg(args[0])).toLowerCase();

// -- substring-with-optional-count shape --
// text_funcs.py:32-37
export const left: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const n = args.length > 1 ? Math.trunc(Number(evaluator.resolveArg(args[1]))) : 1;
  return text.slice(0, n);
};
// text_funcs.py:39-44
export const right: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const n = args.length > 1 ? Math.trunc(Number(evaluator.resolveArg(args[1]))) : 1;
  return n > 0 ? text.slice(-n) : "";
};
// text_funcs.py:46-51
export const mid: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const start = Math.trunc(Number(evaluator.resolveArg(args[1])));
  const numChars = Math.trunc(Number(evaluator.resolveArg(args[2])));
  return text.slice(start - 1, start - 1 + numChars);
};

// text_funcs.py:54-58 — collapses internal runs of ASCII spaces to one,
// after stripping leading/trailing whitespace (not just spaces — matches
// Python's str.strip(), which trims any whitespace, before the regex-based
// internal collapse runs).
export const trim: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  return text.trim().replace(/ +/g, " ");
};

// text_funcs.py:71-73 — ports Python's str.title() as a pragmatic
// whitespace-boundary title-case: uppercase the first character of each
// whitespace-separated word, lowercase the rest. This is a real, narrow
// divergence from actual Python .title() behavior, verified by running
// Python directly: Python's .title() capitalizes after ANY non-letter
// character, not just whitespace — e.g. "it's a test".title() ==
// "It'S A Test" (capital S right after the apostrophe) and
// "a1b2 c3d4".title() == "A1B2 C3D4" (capital after every digit run too),
// where this whitespace-only port instead produces "It's A Test" and
// "A1b2 C3d4". Accepted per the plan task this was written from: the
// common case of plain space-separated words matches exactly, and a
// character-transition port matching Python's real algorithm is more
// machinery than the task calls for.
//
// The final whole-plan review re-examined this and confirmed LEAVE, with a
// harder reason than the original cost argument — do not "fix" it with the
// obvious six-line character-transition loop. That loop (track whether the
// previous character was cased; upper-case the current one if not, lower-
// case it if so) matches str.title() on plain ASCII, but str.title() uses
// Unicode's TITLECASE mapping, which JavaScript does not expose at all —
// String.prototype has only toUpperCase/toLowerCase, no titlecase. They
// genuinely differ: "ß".title() is "Ss" but "ß".toUpperCase() is "SS";
// likewise "ﬁ" -> "Fi" vs "FI", "ﬄ" -> "Ffl" vs "FFL", "ǆ" -> "ǅ" vs "Ǆ".
// Measured: the naive loop disagrees with real Python on 627 of 4000
// randomly generated strings drawn from an alphabet containing ß. So the
// obvious rewrite trades this file's one documented, whitespace-shaped
// divergence for a subtler undocumented one. An exact port needs a Unicode
// titlecase table, which is a real dependency decision, not a cleanup.
export const proper: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
};

// -- variadic-with-error-propagation shape (CONCATENATE stops on the first error, unlike text_funcs' other joiners) --
// text_funcs.py:76-85
export const concatenate: ExcelFunction = (evaluator, args) => {
  const parts: string[] = [];
  for (const arg of args) {
    const val = evaluator.resolveArg(arg);
    if (isExcelError(val)) return val;
    parts.push(toDisplayString(val));
  }
  return parts.join("");
};

// -- range-flattening variadic shape (CONCAT does NOT stop on an error the same way — matches Python's per-cell check inside the flatten) --
// text_funcs.py:87-107
export const concat: ExcelFunction = (evaluator, args) => {
  const parts: string[] = [];
  const visit = (v: CellValue | CellValue[]): ExcelErrorValue | null => {
    if (Array.isArray(v)) {
      for (const item of v) {
        const err = visit(item);
        if (err) return err;
      }
      return null;
    }
    if (isExcelError(v)) return v;
    parts.push(toDisplayString(v));
    return null;
  };
  for (const arg of args) {
    const err = visit(evaluator.resolveArg(arg));
    if (err) return err;
  }
  return parts.join("");
};

// text_funcs.py:110-135 — the same range-flattening shape as CONCAT, but
// never checks isExcelError at all (an error argument is simply
// stringified to its code like every other function in this file) and
// supports an ignore-empty-strings flag driven by Python's own permissive
// bool() truthiness, not this engine's stricter toBoolean (coerce.ts,
// ported from logic_funcs.py's own _to_bool): a nonempty string like
// "FALSE" is still truthy under bool(), and so is an ExcelError argument
// (Python's default object truthiness, since ExcelError defines neither
// __bool__ nor __len__). pythonTruthy below is that different rule, kept
// local to this one call site rather than added to coerce.ts, since it
// isn't a string-coercion concern.
function pythonTruthy(v: CellValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return true;
}

export const textjoin: ExcelFunction = (evaluator, args) => {
  const delimiter = toDisplayString(evaluator.resolveArg(args[0]));
  const ignoreEmpty = pythonTruthy(evaluator.resolveArg(args[1]));
  const parts: string[] = [];
  const visit = (v: CellValue | CellValue[]): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    const s = toDisplayString(v);
    if (ignoreEmpty && s === "") return;
    parts.push(s);
  };
  for (const arg of args.slice(2)) {
    visit(evaluator.resolveArg(arg));
  }
  return parts.join(delimiter);
};

// text_funcs.py:138-168 — a small fixed set of recognized number-format
// strings. Every numeric branch there is either `round(val)` or an
// f-string `f"{val:.Nf}"`, and CPython rounds both by the same rule:
// round-half-to-even (banker's rounding) applied to the double's TRUE
// binary value, not to the decimal literal you typed. JS's
// Math.round/toFixed instead tie-break away from zero, so this needs
// math.ts's pythonRound — the single shared implementation of that rule.
//
// This file used to carry its own copy of it, named bankersRound, which
// was a literal duplicate of pythonRound's OLD scaled-integer version.
// When pythonRound was rewritten (F&S Task 7, commit 6f787e8) to fix a
// confirmed binary-imprecision bug, the copy here was left behind and
// silently kept the bug alive on the TEXT side: TEXT(0.15,"0.0") returned
// "0.2" where Python returns "0.1", and TEXT(2.45,"0.0") returned "2.4"
// where Python returns "2.5". Importing the one implementation removes the
// possibility of that drift recurring.

// True for a negative value INCLUDING negative zero, which a bare
// `v < 0` misses (-0 < 0 is false). This matters because pythonRound
// returns -0 whenever a negative value rounds away to nothing at the
// requested precision, and Python's own f-string formatting keeps the sign
// on that: f"{-0.004:.2f}" == "-0.00", f"{-0.4:,.0f}" == "-0". JS drops it
// twice over — (-0).toFixed(2) is "0.00", and `-0 < 0` is false — so both
// formatting helpers below need this check rather than a plain comparison.
// Verified directly against simulation/functions/text_funcs.py's own TEXT
// across all its format branches.
function isNegativeIncludingZero(v: number): boolean {
  return v < 0 || Object.is(v, -0);
}

// Python's f"{val:.Nf}" on an already-pythonRound-ed value: fixed decimals
// with the sign preserved even for a negative zero (see above).
function pyFixed(rounded: number, digits: number): string {
  return (isNegativeIncludingZero(rounded) ? "-" : "") + Math.abs(rounded).toFixed(digits);
}

// Group the integer part of an already-rounded, fixed-precision number
// string with thousands commas, matching Python's f"{val:,.Nf}".
function withThousands(rounded: number, digits: number): string {
  const fixed = Math.abs(rounded).toFixed(digits);
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fracPart !== undefined ? `${grouped}.${fracPart}` : grouped;
  return (isNegativeIncludingZero(rounded) ? "-" : "") + body;
}

// ---------------------------------------------------------------------------
// Generic custom-format fallback for TEXT() — everything the small literal
// whitelist above (`"0"`, `"0.00"`, `"0.0"`, `"#,##0"`, `"#,##0.00"`) doesn't
// already cover, including a plain `%`-anywhere format like `"0.0%"` and any
// multi-section format like `"0.0x;(0.0x);'-'"`.
//
// Real Excel custom number formats are a rich mini-language (currency
// symbols, fractions, scientific notation, condition brackets, date/time
// codes, …). This implements the slice of it that's realistically present in
// financial-model TEXT() calls — verified against the actual benchmark
// corpus (data/spreadsheetbench-v2/*/spreadsheet/**/*.xlsx, ~470 files, 2069
// TEXT() calls, scanned via a small script): up to four semicolon-delimited
// sections (positive;negative;zero;text — Excel picks by the value's sign),
// a single run of `0`/`#`/`,` digit placeholders per section for the
// numeric token, literal prefix/suffix characters written bare (parens,
// "x", …) or quoted (`'...'` or `"..."` — the corpus actually uses single
// quotes, e.g. `'-'`, not Excel's usual double quotes, so both are
// accepted), percent scaling, and thousands grouping. Date-format sections
// ("h:mm", "mmmm", "mm/dd/yyyy", …, also present in the corpus but only ever
// applied to actual Date-valued cells, never a number) are OUT OF SCOPE —
// this function is only reached for `typeof val === "number"`, and a date
// serial number formatted with a date-shaped format string falls through to
// treating the format string's letters as literal text, same as any other
// pattern with no recognized digit placeholder. That's a pre-existing gap
// (the old generic fallback this replaces produced an equally meaningless
// numeric mangling for the same input), not a regression.

/** Blanks out quoted spans and backslash-escaped characters (replacing each
 *  with a space, preserving length/positions) so a regex or `.includes`
 *  check elsewhere never mistakes a placeholder-shaped character INSIDE a
 *  literal (e.g. a stray "0" in a quoted label) for a real one. */
function blankQuotedSpans(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += " ";
      i += 1;
      while (i < s.length) {
        if (s[i] === quote) {
          if (s[i + 1] === quote) {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i += 1;
          break;
        }
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "\\" && i + 1 < s.length) {
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Renders a literal fragment of a format section: quotes are stripped
 *  (doubled-quote is an escaped literal quote), a backslash escapes the
 *  next character, everything else (parens, "x", "%", …) passes through
 *  as-is. */
function renderLiterals(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < s.length) {
        if (s[i] === quote) {
          if (s[i + 1] === quote) {
            out += quote;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += s[i];
        i += 1;
      }
      continue;
    }
    if (ch === "\\" && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Splits a format string into semicolon-delimited sections, ignoring a
 *  semicolon inside a quoted literal. Always returns at least one section
 *  (a format with no ";" at all is just that one section). */
function splitFormatSections(fmt: string): string[] {
  const blanked = blankQuotedSpans(fmt);
  const sections: string[] = [];
  let start = 0;
  for (let i = 0; i < blanked.length; i++) {
    if (blanked[i] === ";") {
      sections.push(fmt.slice(start, i));
      start = i + 1;
    }
  }
  sections.push(fmt.slice(start));
  return sections;
}

/** True when `section` contains a "%" outside any quoted literal. */
function sectionHasPercent(section: string): boolean {
  return blankQuotedSpans(section).includes("%");
}

const NUMERIC_TOKEN_RE = /[#0][#0,]*(?:\.[#0]*)?|\.[#0]+/;

/** Locates the (first, and for this codebase's scope the only) run of
 *  digit-placeholder characters in `section`, outside any quoted literal —
 *  e.g. "0.0" in "0.0x", or "#,##0" in "$#,##0 total". Null when the
 *  section has no numeric placeholder at all (a pure-literal zero section
 *  like "'-'", or an unsupported date-format section). */
function findNumericToken(section: string): { start: number; end: number; raw: string } | null {
  const blanked = blankQuotedSpans(section);
  const m = NUMERIC_TOKEN_RE.exec(blanked);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length, raw: m[0] };
}

/**
 * Which section governs `val` and how to render its numeric token, per
 * Excel's own selection rule: 1 section applies to every value (a negative
 * one needs an automatic leading "-", since nothing in the format says
 * otherwise); 2 sections are [positive-and-zero, negative]; 3+ are
 * [positive, negative, zero, text — text is irrelevant here, val is always
 * numeric]. `useAbs` tells the caller to render the section's numeric token
 * against |val| (a dedicated negative section, e.g. "(0.0x)", supplies its
 * own presentation and must not ALSO get a sign baked into the number);
 * `autoSign` fires only for the single-section-format-applied-to-a-negative-
 * value case, where no section exists to carry the sign at all.
 */
function selectSection(
  sections: string[],
  val: number,
): { text: string; useAbs: boolean; autoSign: boolean } {
  const isNeg = isNegativeIncludingZero(val);
  if (sections.length >= 3 && val === 0 && !Object.is(val, -0)) {
    return { text: sections[2], useAbs: false, autoSign: false };
  }
  if (isNeg && sections.length >= 2) {
    return { text: sections[1], useAbs: true, autoSign: false };
  }
  if (isNeg) {
    return { text: sections[0], useAbs: true, autoSign: true };
  }
  return { text: sections[0], useAbs: false, autoSign: false };
}

/** Renders one section's text against `magnitude` (already sign-adjusted by
 *  selectSection's useAbs) — the numeric token (if any) becomes a formatted
 *  number via pythonRound/pyFixed/withThousands, scaled x100 first when the
 *  section calls for a percent; everything else in the section is literal
 *  text via renderLiterals, in its original position around the number. */
function renderSection(section: string, magnitude: number): string {
  const token = findNumericToken(section);
  if (!token) return renderLiterals(section);

  const decimalIdx = token.raw.indexOf(".");
  const decimals = decimalIdx === -1 ? 0 : token.raw.length - decimalIdx - 1;
  const grouped = token.raw.includes(",");
  const scaled = sectionHasPercent(section) ? magnitude * 100 : magnitude;
  const rounded = pythonRound(scaled, decimals);
  const numText = grouped ? withThousands(rounded, decimals) : pyFixed(rounded, decimals);

  return renderLiterals(section.slice(0, token.start)) + numText + renderLiterals(section.slice(token.end));
}

/** TEXT()'s generic-format entry point: picks the section, renders it, and
 *  (only for the single-section-negative case) prepends the sign the
 *  section itself has no way to carry. */
function formatCustomNumber(val: number, fmt: string): string {
  const sections = splitFormatSections(fmt);
  const chosen = selectSection(sections, val);
  const rendered = renderSection(chosen.text, chosen.useAbs ? Math.abs(val) : val);
  return (chosen.autoSign && isNegativeIncludingZero(val) ? "-" : "") + rendered;
}

// TEXT explicitly checks isinstance(val, ExcelError) in the Python source
// before ever reaching a format branch, unlike every other function in
// this file — so unlike LEN(#N/A) === 4, TEXT(#N/A, "0") really is #N/A.
// Only the value argument gets this check; the format-string argument
// still goes through plain toDisplayString like everywhere else, so a bad
// format argument just fails to match any recognized branch instead of
// propagating.
export const text: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  const fmt = toDisplayString(evaluator.resolveArg(args[1]));

  if (isExcelError(val)) return val;

  if (typeof val === "number") {
    // The "0" branch alone is NOT pyFixed: its Python source is
    // str(int(round(val))), and int() drops the sign of a negative zero
    // just like String() does here, so f"{-0.4:.0f}" == "-0" but
    // TEXT(-0.4,"0") == "0" on both engines. Deliberately asymmetric with
    // the "#,##0" branch two lines down — verified against text_funcs.py.
    if (fmt === "0") return String(pythonRound(val, 0));
    if (fmt === "0.00") return pyFixed(pythonRound(val, 2), 2);
    if (fmt === "0.0") return pyFixed(pythonRound(val, 1), 1);
    if (fmt === "#,##0") return withThousands(pythonRound(val, 0), 0);
    if (fmt === "#,##0.00") return withThousands(pythonRound(val, 2), 2);
    // Everything else — a plain "%"-anywhere format like "0.0%" (this used
    // to be its own branch here) and any multi-section format like
    // "0.0x;(0.0x);'-'" — goes through the general section-aware formatter.
    // See its own doc above for what it covers and where it stops (date
    // formats).
    return formatCustomNumber(val, fmt);
  }

  return toDisplayString(val);
};

// text_funcs.py:171-195 — instance=0 (the default, i.e. "not given")
// replaces every occurrence; a positive instance replaces only that
// 1-based occurrence, walking the string the same way the Python source's
// own while-loop does rather than a single regex/replaceAll call.
//
// Both branches need an explicit empty-old_text case, found in the final
// whole-plan review. It is NOT an exotic input: old_text goes through
// toDisplayString, which renders a blank cell as "", so the ordinary
// formula =SUBSTITUTE(A1,B1,"x") hits it whenever B1 happens to be empty.
//
//  - instance=0: Python's str.replace with an empty needle inserts
//    new_text at every boundary INCLUDING both ends —
//    "abc".replace("","X") == "XaXbXcX" and "".replace("","X") == "X"
//    (both run directly) — where JS's split("").join(newText) gives
//    "aXbXc" and "". A silent wrong value, so it gets Python's real
//    semantics below, built on Array.from so it iterates code points like
//    Python does rather than UTF-16 units.
//
//  - instance!=0: the Python source's own while-loop never terminates
//    here (i advances by len(old_text), which is 0), so there is no
//    oracle answer to match — it hangs rather than returning anything.
//    Confirmed by running it. Left unguarded, this port hangs identically,
//    except that here it hangs the user's browser tab mid-recalculation
//    while growing an unbounded string. #VALUE! is the same answer this
//    file already gives for REPT/CHAR when a call cannot produce a value
//    (see those comments): engine.py:334-342 wraps every function call in
//    `except Exception -> VALUE_ERROR`, and returning a value the caller
//    can handle is the only option that keeps the engine responsive.
//    A deliberate, documented divergence from a Python "behavior" that
//    has no return value at all — no oracle case can contradict it,
//    because any such case would hang the oracle dump too.
export const substitute: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const oldText = toDisplayString(evaluator.resolveArg(args[1]));
  const newText = toDisplayString(evaluator.resolveArg(args[2]));
  const instance = args.length > 3 ? Math.trunc(Number(evaluator.resolveArg(args[3]))) : 0;

  if (oldText === "") {
    if (instance !== 0) return excelError("#VALUE!");
    return ["", ...Array.from(text), ""].join(newText);
  }

  if (instance === 0) {
    return text.split(oldText).join(newText);
  }

  let count = 0;
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text.slice(i, i + oldText.length) === oldText) {
      count++;
      result += count === instance ? newText : oldText;
      i += oldText.length;
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
};

// text_funcs.py:198-204 — replaces a fixed character range, not a match.
export const replace: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const start = Math.trunc(Number(evaluator.resolveArg(args[1])));
  const numChars = Math.trunc(Number(evaluator.resolveArg(args[2])));
  const newText = toDisplayString(evaluator.resolveArg(args[3]));
  return text.slice(0, start - 1) + newText + text.slice(start - 1 + numChars);
};

// -- criteria-string-search shape, case-insensitive with wildcards (SEARCH) vs case-sensitive literal (FIND) --
// text_funcs.py:207-217
export const find: ExcelFunction = (evaluator, args) => {
  const findText = toDisplayString(evaluator.resolveArg(args[0]));
  const withinText = toDisplayString(evaluator.resolveArg(args[1]));
  const start = args.length > 2 ? Math.trunc(Number(evaluator.resolveArg(args[2]))) : 1;
  const pos = withinText.indexOf(findText, start - 1);
  return pos === -1 ? excelError("#VALUE!") : pos + 1;
};

// text_funcs.py:219-231
export const search: ExcelFunction = (evaluator, args) => {
  const findText = toDisplayString(evaluator.resolveArg(args[0])).toUpperCase();
  const withinText = toDisplayString(evaluator.resolveArg(args[1])).toUpperCase();
  const start = args.length > 2 ? Math.trunc(Number(evaluator.resolveArg(args[2]))) : 1;
  const pattern = findText.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const re = new RegExp(pattern);
  const m = re.exec(withinText.slice(start - 1));
  return m === null ? excelError("#VALUE!") : m.index + start;
};

// text_funcs.py:234-244 — strips commas, then parses. The brief's own
// worked examples elsewhere in this file use plain Number() for numeric
// argument coercion, and this port does the same here; unlike Python's
// float(), Number() accepts a few things Python would reject (e.g. hex
// literals like "0x10"), a narrow, accepted divergence. Number("") and
// Number(whitespace) are 0 in JS, unlike Python's float("") which raises
// ValueError, so that specific case needs an explicit guard to stay
// #VALUE! instead of silently becoming 0.
export const value: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.split(",").join("");
    if (cleaned.trim() === "") return excelError("#VALUE!");
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? excelError("#VALUE!") : parsed;
  }
  return excelError("#VALUE!");
};

// text_funcs.py:247-251 — a negative count is an empty string, not an
// error. String.prototype.repeat throws a RangeError on a non-finite
// count, unlike Python's int()-then-multiply; an upstream-error argument
// coerces to NaN via plain Number(), so this needs an explicit finite
// check to avoid a hard crash where Python would instead raise (and the
// reference engine's outer catch-all would turn into #VALUE!) — since this
// port has no such catch-all around function bodies, producing a graceful
// value here is the safer equivalent.
export const rept: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  const nRaw = Math.trunc(Number(evaluator.resolveArg(args[1])));
  const n = Number.isFinite(nRaw) ? Math.max(0, nRaw) : 0;
  return text.repeat(n);
};

// text_funcs.py:254-258 — case-sensitive equality after toDisplayString.
export const exact: ExcelFunction = (evaluator, args) => {
  const a = toDisplayString(evaluator.resolveArg(args[0]));
  const b = toDisplayString(evaluator.resolveArg(args[1]));
  return a === b;
};

// text_funcs.py:261-264 — no toDisplayString call at all, matching the
// Python source exactly: only a value that IS already a string passes
// through; everything else (numbers, booleans, errors, blanks) becomes "".
export const t: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  return typeof val === "string" ? val : "";
};

// text_funcs.py:267-274 — also no toDisplayString call: a boolean becomes
// 1/0, a number passes through unchanged, and everything else (strings,
// errors, dates, blanks) becomes 0 — an upstream error is simply swallowed
// to 0 here rather than stringified or propagated, a third distinct
// error-handling shape alongside "propagate" (TEXT) and "stringify the
// code" (everywhere else in this file).
export const n: ExcelFunction = (evaluator, args) => {
  const val = evaluator.resolveArg(args[0]);
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "number") return val;
  return 0;
};

// text_funcs.py:277-280 — strips characters with a code point below 32.
// Iterates by Unicode code point (Array.from) rather than UTF-16 code
// unit, matching Python 3's own per-code-point string iteration.
export const clean: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  return Array.from(text)
    .filter((ch) => (ch.codePointAt(0) ?? 0) >= 32)
    .join("");
};

// text_funcs.py:283-289 — #VALUE! outside 1-255. NaN comparisons are
// always false, so an explicit Number.isFinite guard is needed: a
// non-numeric argument would otherwise silently pass the `n < 1 || n >
// 255` check (NaN fails both comparisons) and reach
// String.fromCharCode(NaN), which returns U+0000 instead of the #VALUE!
// Python's own int()-conversion failure would produce.
export const char: ExcelFunction = (evaluator, args) => {
  const codePoint = Math.trunc(Number(evaluator.resolveArg(args[0])));
  if (!Number.isFinite(codePoint) || codePoint < 1 || codePoint > 255) return excelError("#VALUE!");
  return String.fromCharCode(codePoint);
};

// text_funcs.py:291-296
export const code: ExcelFunction = (evaluator, args) => {
  const text = toDisplayString(evaluator.resolveArg(args[0]));
  if (text === "") return excelError("#VALUE!");
  return text.codePointAt(0) ?? 0;
};

// text_funcs.py:299-310 — custom decimal/group separators, default "."/",".
export const numbervalue: ExcelFunction = (evaluator, args) => {
  const rawText = toDisplayString(evaluator.resolveArg(args[0]));
  const decSep = args.length > 1 ? toDisplayString(evaluator.resolveArg(args[1])) : ".";
  const grpSep = args.length > 2 ? toDisplayString(evaluator.resolveArg(args[2])) : ",";
  let cleaned = rawText.trim().split(grpSep).join("");
  if (decSep !== ".") {
    cleaned = cleaned.split(decSep).join(".");
  }
  if (cleaned.trim() === "") return excelError("#VALUE!");
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? excelError("#VALUE!") : parsed;
};
