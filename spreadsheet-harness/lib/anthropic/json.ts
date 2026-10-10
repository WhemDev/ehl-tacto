/**
 * The model is asked for bare JSON, but "asked" is not "guaranteed" — there are
 * no structured outputs on Sonnet 4.6, so a stray fence or a sentence of
 * preamble is always possible. This recovers the payload without being clever
 * enough to accept genuinely malformed output.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();

  // ```json ... ``` or ``` ... ```
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1].trim();

  if (s.startsWith("{") && s.endsWith("}")) return s;

  // Fall back to the outermost balanced object, ignoring braces inside strings.
  const start = s.indexOf("{");
  if (start === -1) return s;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

export function parseJsonLoose(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(extractJson(raw)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
