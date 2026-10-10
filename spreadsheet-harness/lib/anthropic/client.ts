import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-side Anthropic client. This module must never be imported from a
 * client component — the API key lives in the process environment and has no
 * NEXT_PUBLIC_ prefix precisely so a stray import fails loudly at build time.
 */

export const MODEL = "claude-sonnet-5";

/**
 * Thinking and output share this budget, and adaptive thinking on an unfamiliar
 * layout can take most of it before a single character of JSON is written — a
 * real 100-row planning sheet exhausted 32k and returned nothing. Sonnet 5
 * allows up to 128k; 64k leaves generous headroom for the reasoning while
 * staying well short of the ceiling. Requests stream, which is what makes a
 * budget this large safe from HTTP timeouts.
 *
 * Sonnet 5's tokenizer produces roughly 30% more tokens than Sonnet 4.6's for
 * the same text, so this ceiling is carried over from the Sonnet 4.6 value
 * rather than re-derived — pending the measurement in the migration design doc.
 */
export const MAX_TOKENS = 64_000;

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export interface CallOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface CallResult {
  /** Concatenated text blocks — the JSON payload, before parsing. */
  text: string;
  /** Full content array, echoed back verbatim when we retry the same turn. */
  content: Anthropic.ContentBlock[];
  usage: Usage;
}

export async function callModel({
  system,
  messages,
  effort = "medium",
  model = MODEL,
}: CallOptions): Promise<CallResult> {
  const stream = getClient().messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    // The system prompt is ~3.4k static tokens with no per-request
    // interpolation, well above the cacheable minimum — cache it.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    // Adaptive thinking is the supported mode on Sonnet 5; `budget_tokens` is
    // removed there and depth is steered with `effort` instead.
    thinking: { type: "adaptive" },
    output_config: { effort },
    messages,
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "max_tokens") {
    throw new ModelError(
      `The model used its entire ${MAX_TOKENS.toLocaleString()}-token budget before finishing. ` +
        "That usually means the file's layout is unfamiliar enough that it spent the budget working the structure out. " +
        "Try again — and if it recurs, mention the shape of the sheet in your description (\"each product is a block of rows, months across the top\").",
      { retryable: true },
    );
  }
  if (message.stop_reason === "refusal") {
    throw new ModelError(
      "The model declined to answer this request.",
      { retryable: false },
    );
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    content: message.content,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheCreation: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export interface CallTurnOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
}

export interface CallTurnResult {
  /** Full content array — unlike callModel's `text`, a tool-using turn's
   *  payload is tool_use blocks as often as text, so there is no single
   *  string to flatten to. */
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: Usage;
}

/**
 * One streamed model turn with an explicit tool list — the primitive
 * app/api/agent-turn/route.ts's `mode: "generate-work"` handler calls per
 * request, and the server-side twin of lib/bench/agent-infer.ts's
 * makeAgentCallTurn (which wraps this same stream/finalMessage/max_tokens/
 * refusal shape for the benchmark's own agent loop, in-process rather than
 * over HTTP). `messages` is taken as given — the caller decorates cache
 * breakpoints (see agent-infer.ts's decorateWithCache, copied rather than
 * imported into the route to avoid a lib/bench import from app/api) before
 * calling this.
 */
export async function callModelTurn({
  system,
  messages,
  tools,
  effort = "medium",
  model = MODEL,
}: CallTurnOptions): Promise<CallTurnResult> {
  const stream = getClient().messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort },
    tools,
    messages,
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "max_tokens") {
    throw new ModelError(
      `The model used its entire ${MAX_TOKENS.toLocaleString()}-token budget mid-turn.`,
      { retryable: true },
    );
  }
  if (message.stop_reason === "refusal") {
    throw new ModelError("The model declined this task.", { retryable: false });
  }

  return {
    content: message.content,
    stopReason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheCreation: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export class ModelError extends Error {
  retryable: boolean;
  constructor(message: string, opts: { retryable: boolean }) {
    super(message);
    this.name = "ModelError";
    this.retryable = opts.retryable;
  }
}
