/**
 * Pure mapping layer between the agent loop's Anthropic-shaped messages
 * (lib/agent/loop.ts's CallTurnFn contract) and Amazon Bedrock's Converse
 * API shapes (@aws-sdk/client-bedrock-runtime). No network calls, no AWS
 * client — every function here is a plain data transform, which is what
 * makes it unit-testable against fixtures without credentials.
 *
 * Scope: the loop's tool surface (lib/agent/tools.ts) is text-only — four
 * read tools plus submit_edit_plan, no images/documents/video. The mapping
 * below only needs to round-trip what that surface actually produces:
 * text, tool_use, tool_result, and (on the way in, for reasoning-capable
 * Bedrock models) reasoningContent. Anything else Converse or Anthropic
 * could in principle carry (images, citations, search results, guardrail
 * content, ...) is defensively dropped rather than thrown on, since a
 * silent drop of content this loop never sends is strictly safer than a
 * crash mid-benchmark run over a block type nobody produces.
 *
 * ---------------------------------------------------------------------
 * Reasoning / thinking blocks — the one genuinely provider-specific
 * mapping decision here, spelled out:
 *
 * INBOUND (a Converse response's reasoningContent -> AgentTurn.content,
 * which is typed Anthropic.ContentBlock[]): mapped to an Anthropic
 * ThinkingBlock ({type: "thinking", thinking, signature}) when the
 * response carries a `reasoningText` member with actual text. Two
 * consumers read AgentTurn.content downstream (see lib/agent/loop.ts and
 * lib/bench/log.ts's serializeTaskLog): the loop itself only ever
 * `.filter()`s for `type === "tool_use"`, so an extra block type is
 * invisible to its control flow; the transcript logger serializes
 * whatever is in `content` verbatim for the submission-grade log. A
 * ThinkingBlock is therefore both loop-safe (ignored) and log-useful (a
 * human reviewing one of the per-task JSONL logs under bench-results sees
 * the model's reasoning instead of a silently dropped field).
 * `redactedContent`
 * (provider-encrypted reasoning bytes) carries nothing renderable, so it
 * is dropped with no substitute block at all, not even an empty one.
 *
 * OUTBOUND (the loop echoes AgentTurn.content back as the next request's
 * assistant history — see loop.ts's `messages.push({role: "assistant",
 * content: turn.content ...})`): every thinking/redacted_thinking block is
 * stripped unconditionally, including ones this module itself produced
 * one turn earlier. Reasoning blocks are the one Anthropic content type
 * with real cross-turn contract obligations (a `signature` the provider
 * may re-verify), and a signature minted by one Bedrock model has no
 * defined meaning to a *different* model on a later Converse call in this
 * harness (models are swapped per --model, not fixed per conversation).
 * Sending it back unconditionally is send-and-hope; not sending it back
 * is a documented, provable no-op. The model always still has its own
 * prior reasoning available implicitly (it emitted the tool_use/text that
 * followed it, which IS echoed back), so nothing the agent loop needs is
 * lost by dropping the thinking block itself outbound.
 * ---------------------------------------------------------------------
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock as BedrockContentBlock,
  ConverseResponse,
  Message as BedrockMessage,
  ReasoningContentBlock,
  SystemContentBlock,
  Tool as BedrockTool,
  TokenUsage,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { Usage } from "@/lib/anthropic/client";
import type { AgentTurn } from "@/lib/agent/loop";

// ---------------------------------------------------------------------------
// Outbound: Anthropic MessageParam[] -> Converse Message[]
// ---------------------------------------------------------------------------

/**
 * One inbound tool_result's `content` (string | Array<TextBlockParam | ...>)
 * flattened to plain text — Converse's ToolResultContentBlock accepts a
 * `text` member directly, so there is no structural loss for the text-only
 * results this loop ever produces (see executeReadTool in lib/agent/tools.ts:
 * every non-submit tool result is a plain string). A non-text element inside
 * an array-form content (defensive only — this loop never builds one) is
 * JSON-stringified rather than dropped, so nothing silently vanishes from a
 * tool result specifically (unlike the assistant-side drops documented
 * above, a dropped tool_result is a dropped fact the model needed).
 */
function flattenToolResultContent(content: Anthropic.ToolResultBlockParam["content"]): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : JSON.stringify(block)))
    .join("\n");
}

function toolResultToConverse(block: Anthropic.ToolResultBlockParam): BedrockContentBlock {
  return {
    toolResult: {
      toolUseId: block.tool_use_id,
      content: [{ text: flattenToolResultContent(block.content) }],
      // Bedrock's ToolResultStatus is "error" | "success"; omitted (not
      // "success") on the non-error path rather than set explicitly, since
      // it is documented as honored only by a subset of models and an
      // absent field is the more conservative default.
      status: block.is_error ? "error" : undefined,
    },
  };
}

/**
 * One outbound content block, or null when this block type is dropped (see
 * the module doc above for thinking/redacted_thinking; every other drop
 * here is for a block type lib/agent/tools.ts's surface never produces).
 */
function toConverseContentBlock(block: Anthropic.ContentBlockParam): BedrockContentBlock | null {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "tool_use":
      // block.input is `unknown` on Anthropic.ToolUseBlockParam (whatever
      // JSON value the model's tool_use call carried) — a same-shaped JSON
      // value is exactly what Converse's DocumentType represents, so this
      // is a representation change, not a real type narrowing; the cast
      // documents that rather than papering over a mismatch.
      return { toolUse: { toolUseId: block.id, name: block.name, input: block.input as DocumentType } };
    case "tool_result":
      return toolResultToConverse(block);
    case "thinking":
    case "redacted_thinking":
      // Never echoed back outbound — see this module's top doc.
      return null;
    default:
      return null;
  }
}

/**
 * Anthropic MessageParam[] (the loop's own `messages` array — see
 * lib/agent/loop.ts) -> Converse Message[]. `system`-role entries are
 * dropped (the loop never produces one; Converse carries system prompt
 * separately — see {@link anthropicSystemToConverse}). A message that ends
 * up with zero content blocks after the drops above (only possible if an
 * assistant turn's content was ENTIRELY a stripped thinking block, with no
 * accompanying text/tool_use — not a shape the loop itself ever produces,
 * since a content-only-thinking turn has no tool_use and so is treated as
 * "stopped talking" and nudged, never pushed to `messages` as its own
 * turn... except the nudge path itself DOES push such a turn, see loop.ts's
 * `nudged` branch) gets a single empty text block instead of an empty
 * array, since Converse rejects empty `content`.
 */
export function anthropicMessagesToConverse(messages: Anthropic.MessageParam[]): BedrockMessage[] {
  const out: BedrockMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const rawBlocks: Anthropic.ContentBlockParam[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    const content = rawBlocks
      .map(toConverseContentBlock)
      .filter((b): b is BedrockContentBlock => b !== null);
    out.push({ role: message.role, content: content.length > 0 ? content : [{ text: "" }] });
  }
  return out;
}

/** System prompt string -> Converse `system` array (a single text block). */
export function anthropicSystemToConverse(system: string): SystemContentBlock[] {
  return [{ text: system }];
}

// ---------------------------------------------------------------------------
// Tools: AGENT_TOOLS -> Converse toolConfig.tools
// ---------------------------------------------------------------------------

/**
 * lib/agent/tools.ts's AGENT_TOOLS -> Converse `toolConfig.tools`. Strips
 * `strict` and `cache_control` (both top-level Anthropic.Tool fields, never
 * inside `input_schema` — see lib/agent/tools.ts's EDIT_PLAN_SCHEMA, which
 * carries neither): Converse's own `strict` flag is a distinct per-provider
 * guarantee (ToolSpecification.strict) this adapter does not opt into, and
 * `cache_control` has no Converse equivalent to carry it to. The JSON
 * schemas (`input_schema`) pass through structurally unchanged — the loop's
 * Zod layer (makeEditPlanSchema in lib/plan/edits.ts) is the semantic
 * authority regardless of what any provider's strict mode does or does not
 * enforce (see this module's doc and lib/agent/tools.ts's own doc comment).
 */
export function agentToolsToConverseTools(tools: Anthropic.Tool[]): BedrockTool[] {
  return tools.map(toConverseTool);
}

/** Named + explicitly-return-typed rather than inlined in a `.map()`
 *  callback: `Tool` is a discriminated union (toolSpec | systemTool |
 *  cachePoint | $unknown), and checking a same-shaped object literal
 *  against a known target type here — instead of letting `.map()`'s
 *  inferred element type get assigned to `Tool[]` after the fact — is what
 *  gives a precise error if this mapping ever drifts out of sync with the
 *  SDK's types, rather than a confusing "not assignable to $UnknownMember"
 *  pointing at the wrong union branch. */
function toConverseTool(tool: Anthropic.Tool): BedrockTool {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      // tool.input_schema is Anthropic's JSON-Schema-shaped InputSchema
      // (properties/required typed as `unknown`/`unknown[]`, not
      // recursively as Converse's DocumentType) — same JSON value, a
      // stricter recursive type on the Converse side, hence the cast
      // rather than a real narrowing (see the tool_use case above for the
      // identical situation on inbound tool input).
      inputSchema: { json: tool.input_schema as unknown as DocumentType },
    },
  };
}

// ---------------------------------------------------------------------------
// Inbound: ConverseResponse -> AgentTurn
// ---------------------------------------------------------------------------

/**
 * Coerces a tool_use `input` that arrived as a JSON string instead of a
 * structured object — observed on some Bedrock third-party models (Kimi,
 * GLM, DeepSeek, MiniMax families all have model versions that emit
 * stringified tool-call arguments rather than the Converse-documented
 * object shape). The loop's schema layer (makeEditPlanSchema /
 * executeReadTool's per-tool Zod schemas) expects an object and will reject
 * a bare string with a confusing "expected object, got string" error — so
 * this coercion happens once, here, before the input ever reaches the loop.
 * A string that fails to parse as JSON is handed back unchanged (not
 * thrown): the loop's own schema validation already turns a malformed
 * submission into a corrective tool_result, which is a far better user
 * (model) experience than this mapping layer crashing the whole turn over
 * it. Anything that is not a string (already an object, or genuinely
 * absent) passes through as-is; an absent/undefined input becomes `{}`,
 * tolerating a tool call with no input at all rather than handing the loop
 * `undefined`.
 */
export function coerceToolUseInput(input: unknown): unknown {
  if (input === undefined) return {};
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

let syntheticToolUseIdCounter = 0;

/** Bedrock's `toolUseId` is documented `string | undefined`; a model that
 *  omits it (never observed, but the type allows it) still needs a stable
 *  id for the tool_result round-trip the loop performs one turn later — see
 *  loop.ts's `tool_use_id: call.id`. Deterministic within a process (a
 *  plain counter, not random), so fixture-based tests stay reproducible. */
function toolUseId(id: string | undefined): string {
  if (id) return id;
  syntheticToolUseIdCounter += 1;
  return `bedrock_missing_id_${syntheticToolUseIdCounter}`;
}

/** See this module's top doc for the reasoning-block mapping decision.
 *  Returns null for `redactedContent` (opaque encrypted bytes, nothing
 *  renderable) or a `reasoningText` member with no actual text. */
function reasoningToThinking(reasoning: ReasoningContentBlock): Anthropic.ThinkingBlock | null {
  if ("reasoningText" in reasoning && reasoning.reasoningText?.text) {
    return {
      type: "thinking",
      thinking: reasoning.reasoningText.text,
      signature: reasoning.reasoningText.signature ?? "",
    };
  }
  return null;
}

/**
 * One Converse response's content blocks -> Anthropic.ContentBlock[]. Tool
 * calls with a stringified `input` are coerced (see coerceToolUseInput); an
 * empty/absent block array (a model that stops without producing any
 * content) maps to `[]`, which the loop already treats as "the model
 * stopped talking" (see loop.ts's `toolUses.length === 0` nudge branch) —
 * no special-casing needed here for that.
 */
export function converseContentToAnthropic(blocks: BedrockContentBlock[] | undefined): Anthropic.ContentBlock[] {
  const out: Anthropic.ContentBlock[] = [];
  for (const block of blocks ?? []) {
    if (block.text !== undefined) {
      out.push({ type: "text", text: block.text, citations: null });
    } else if (block.toolUse) {
      out.push({
        type: "tool_use",
        id: toolUseId(block.toolUse.toolUseId),
        name: block.toolUse.name ?? "",
        input: coerceToolUseInput(block.toolUse.input),
        caller: { type: "direct" },
      });
    } else if (block.reasoningContent) {
      const thinking = reasoningToThinking(block.reasoningContent);
      if (thinking) out.push(thinking);
    }
    // Every other ContentBlock member (image, document, video, toolResult,
    // guardContent, citationsContent, searchResult, toolAddition/Removal,
    // cachePoint, ...) never appears in an ASSISTANT Converse response for
    // this loop's tool surface — dropped defensively rather than thrown on.
  }
  return out;
}

/**
 * Converse's stopReason -> the string AgentTurn.stopReason carries. Only
 * `end_turn`/`tool_use`/`max_tokens`/`stop_sequence` have an established
 * Anthropic-shaped meaning downstream (see lib/agent/loop.ts's doc — nothing
 * in the loop actually branches on this value; app/api/agent-turn/route.ts
 * and scripts/work-cli.ts only echo it through as diagnostics). Every other
 * Converse-specific reason (content_filtered, guardrail_intervened,
 * malformed_model_output, malformed_tool_use,
 * model_context_window_exceeded) is passed through verbatim rather than
 * coerced to a lossy Anthropic equivalent — AgentTurn.stopReason is typed
 * as a bare `string | null`, not the closed Anthropic StopReason union, so
 * there is no type-safety reason to collapse it, and a diagnostics reader
 * is better served by the real reason than a misleading substitute.
 */
export function converseStopReasonToAnthropic(stopReason: string | undefined): string | null {
  return stopReason ?? null;
}

/** Converse TokenUsage -> the Usage shape lib/anthropic/client.ts defines.
 *  Bedrock's Converse API does support prompt-cache accounting for some
 *  models (cacheReadInputTokens/cacheWriteInputTokens on TokenUsage) — those
 *  map straight across when present; a model/response that never populates
 *  them (no caching in play) reports 0, exactly like a fresh Anthropic call
 *  with no cache breakpoints hit. */
export function converseUsageToUsage(usage: TokenUsage | undefined): Usage {
  return {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    cacheRead: usage?.cacheReadInputTokens ?? 0,
    cacheCreation: usage?.cacheWriteInputTokens ?? 0,
  };
}

/** Full inbound mapping: one ConverseResponse -> one AgentTurn, the shape
 *  lib/agent/loop.ts's CallTurnFn contract requires. */
export function converseResponseToAgentTurn(response: ConverseResponse): AgentTurn {
  const message = response.output && "message" in response.output ? response.output.message : undefined;
  return {
    content: converseContentToAnthropic(message?.content),
    stopReason: converseStopReasonToAnthropic(response.stopReason),
    usage: converseUsageToUsage(response.usage),
  };
}
