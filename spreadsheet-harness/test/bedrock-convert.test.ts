import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock as BedrockContentBlock, ConverseResponse } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, SUBMIT_TOOL } from "@/lib/agent/tools";
import {
  agentToolsToConverseTools,
  anthropicMessagesToConverse,
  anthropicSystemToConverse,
  coerceToolUseInput,
  converseContentToAnthropic,
  converseResponseToAgentTurn,
  converseStopReasonToAnthropic,
  converseUsageToUsage,
} from "@/lib/bedrock/convert";

// ---------------------------------------------------------------------------
// A realistic 3-turn conversation: first user message, assistant tool_use,
// tool_result, assistant submit — the exact shape lib/agent/loop.ts's
// `messages` array takes. Used below to check the outbound mapping's shape
// and, for the two assistant turns, that mapping outbound then back inbound
// (Anthropic -> Converse -> Anthropic) preserves everything the loop cares
// about.
// ---------------------------------------------------------------------------

const conversation: Anthropic.MessageParam[] = [
  {
    role: "user",
    content: [{ type: "text", text: "DIGEST...\nGRID...\nInstruction: fill in Q4 revenue in D2." }],
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check the existing formulas first." },
      {
        type: "tool_use",
        id: "toolu_01ABC",
        name: "read_range",
        input: { sheet: "Summary", range: "B2:D10" },
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_01ABC",
        content: "B2: 100\nB3: 200\nC2: {=B2*1.1} -> 110",
        is_error: false,
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_02XYZ",
        name: SUBMIT_TOOL,
        input: {
          edits: [{ sheet: "Summary", range: "D2", formula: "=C2*1.05" }],
          newSheets: [],
          notes: "Extrapolated Q4 from Q3's growth rate.",
          coverage: [],
          charts: [],
        },
      },
    ],
  },
];

describe("anthropicMessagesToConverse — outbound shape", () => {
  const out = anthropicMessagesToConverse(conversation);

  it("preserves message count and roles", () => {
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("maps the first user text message straight through", () => {
    expect(out[0].content).toEqual([{ text: "DIGEST...\nGRID...\nInstruction: fill in Q4 revenue in D2." }]);
  });

  it("maps an assistant turn's text + tool_use blocks", () => {
    expect(out[1].content).toEqual([
      { text: "Let me check the existing formulas first." },
      { toolUse: { toolUseId: "toolu_01ABC", name: "read_range", input: { sheet: "Summary", range: "B2:D10" } } },
    ]);
  });

  it("maps a tool_result to Converse's toolResult shape, is_error absent -> status undefined", () => {
    expect(out[2].content).toEqual([
      {
        toolResult: {
          toolUseId: "toolu_01ABC",
          content: [{ text: "B2: 100\nB3: 200\nC2: {=B2*1.1} -> 110" }],
          status: undefined,
        },
      },
    ]);
  });

  it("maps is_error: true to status: 'error'", () => {
    const mapped = anthropicMessagesToConverse([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }],
      },
    ]);
    expect(mapped[0].content?.[0]).toEqual({
      toolResult: { toolUseId: "tu_1", content: [{ text: "boom" }], status: "error" },
    });
  });

  it("maps the final submit_edit_plan tool_use with its full input intact", () => {
    expect(out[3].content).toEqual([
      {
        toolUse: {
          toolUseId: "toolu_02XYZ",
          name: SUBMIT_TOOL,
          input: {
            edits: [{ sheet: "Summary", range: "D2", formula: "=C2*1.05" }],
            newSheets: [],
            notes: "Extrapolated Q4 from Q3's growth rate.",
            coverage: [],
            charts: [],
          },
        },
      },
    ]);
  });
});

describe("anthropicMessagesToConverse — round trip through converseContentToAnthropic", () => {
  const out = anthropicMessagesToConverse(conversation);

  it("assistant turn 1 (text + tool_use) round-trips semantically", () => {
    const roundTripped = converseContentToAnthropic(out[1].content);
    expect(roundTripped).toEqual([
      { type: "text", text: "Let me check the existing formulas first.", citations: null },
      {
        type: "tool_use",
        id: "toolu_01ABC",
        name: "read_range",
        input: { sheet: "Summary", range: "B2:D10" },
        caller: { type: "direct" },
      },
    ]);
  });

  it("assistant turn 2 (submit tool_use) round-trips semantically", () => {
    const roundTripped = converseContentToAnthropic(out[3].content);
    const original = conversation[3].content as Anthropic.ToolUseBlockParam[];
    expect(roundTripped).toEqual([
      {
        type: "tool_use",
        id: original[0].id,
        name: original[0].name,
        input: original[0].input,
        caller: { type: "direct" },
      },
    ]);
  });
});

describe("anthropicSystemToConverse", () => {
  it("wraps the system prompt as a single Converse text block", () => {
    expect(anthropicSystemToConverse("You are a spreadsheet agent.")).toEqual([
      { text: "You are a spreadsheet agent." },
    ]);
  });
});

describe("anthropicMessagesToConverse — thinking blocks never echoed outbound", () => {
  it("strips a thinking block, keeping sibling blocks", () => {
    const out = anthropicMessagesToConverse([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning about the layout", signature: "sig123" },
          { type: "text", text: "Here is my plan." },
        ],
      },
    ]);
    expect(out[0].content).toEqual([{ text: "Here is my plan." }]);
  });

  it("strips a redacted_thinking block the same way", () => {
    const out = anthropicMessagesToConverse([
      { role: "assistant", content: [{ type: "redacted_thinking", data: "encrypted-bytes" }] },
    ]);
    // Nothing survives -> the empty-content guard kicks in.
    expect(out[0].content).toEqual([{ text: "" }]);
  });

  it("substitutes a single empty text block when every block strips away", () => {
    const out = anthropicMessagesToConverse([
      { role: "assistant", content: [{ type: "thinking", thinking: "...", signature: "s" }] },
    ]);
    expect(out[0].content).toEqual([{ text: "" }]);
  });
});

describe("anthropicMessagesToConverse — string content", () => {
  it("wraps a bare string message content as a single text block", () => {
    const out = anthropicMessagesToConverse([{ role: "user", content: "plain string message" }]);
    expect(out[0].content).toEqual([{ text: "plain string message" }]);
  });
});

// ---------------------------------------------------------------------------
// Tool config mapping: strict stripped, schemas intact.
// ---------------------------------------------------------------------------

describe("agentToolsToConverseTools", () => {
  const tools = agentToolsToConverseTools(AGENT_TOOLS);

  it("maps every tool, preserving name/description/input_schema, in order", () => {
    expect(tools).toHaveLength(AGENT_TOOLS.length);
    tools.forEach((t, i) => {
      expect(t.toolSpec?.name).toBe(AGENT_TOOLS[i].name);
      expect(t.toolSpec?.description).toBe(AGENT_TOOLS[i].description);
      expect(t.toolSpec?.inputSchema).toEqual({ json: AGENT_TOOLS[i].input_schema });
    });
  });

  it("strips `strict` from the submit tool — no such key anywhere on the mapped tool", () => {
    const submit = tools.find((t) => t.toolSpec?.name === SUBMIT_TOOL);
    expect(submit).toBeDefined();
    expect(submit).not.toHaveProperty("strict");
    expect(submit?.toolSpec).not.toHaveProperty("strict");
    // Confirm the source tool really was strict, so this is testing a real
    // strip and not a tautology over a tool that was never strict.
    const sourceSubmit = AGENT_TOOLS.find((t) => t.name === SUBMIT_TOOL);
    expect(sourceSubmit?.strict).toBe(true);
  });

  it("never carries cache_control on the mapped tool", () => {
    for (const t of tools) {
      expect(t).not.toHaveProperty("cache_control");
    }
  });

  it("read tool schemas pass through additionalProperties/required unchanged", () => {
    const readRange = tools.find((t) => t.toolSpec?.name === "read_range");
    const source = AGENT_TOOLS.find((t) => t.name === "read_range");
    expect(readRange?.toolSpec?.inputSchema).toEqual({ json: source?.input_schema });
  });
});

// ---------------------------------------------------------------------------
// Stringified-input coercion (model-quirk guardrail).
// ---------------------------------------------------------------------------

describe("coerceToolUseInput", () => {
  it("parses a stringified JSON object", () => {
    expect(coerceToolUseInput('{"sheet":"Summary","range":"B2"}')).toEqual({ sheet: "Summary", range: "B2" });
  });

  it("passes an already-structured object through unchanged", () => {
    const input = { sheet: "Summary" };
    expect(coerceToolUseInput(input)).toBe(input);
  });

  it("hands back a malformed JSON string unchanged rather than throwing", () => {
    expect(coerceToolUseInput("{not valid json")).toBe("{not valid json");
  });

  it("treats undefined input as an empty object", () => {
    expect(coerceToolUseInput(undefined)).toEqual({});
  });

  it("treats null input as null (not coerced to {})", () => {
    // Only `undefined` is defaulted; an explicit null is left alone since
    // it is itself a valid (if unusual) DocumentType value, not an absence.
    expect(coerceToolUseInput(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// converseContentToAnthropic: reasoning blocks, empty/absent content, ids.
// ---------------------------------------------------------------------------

describe("converseContentToAnthropic", () => {
  it("maps reasoningText to an Anthropic thinking block", () => {
    const blocks: BedrockContentBlock[] = [
      { reasoningContent: { reasoningText: { text: "working through the formula graph", signature: "sig-abc" } } },
      { text: "Here's my answer." },
    ];
    expect(converseContentToAnthropic(blocks)).toEqual([
      { type: "thinking", thinking: "working through the formula graph", signature: "sig-abc" },
      { type: "text", text: "Here's my answer.", citations: null },
    ]);
  });

  it("defaults a missing reasoning signature to an empty string", () => {
    const blocks: BedrockContentBlock[] = [{ reasoningContent: { reasoningText: { text: "hmm" } } }];
    expect(converseContentToAnthropic(blocks)).toEqual([{ type: "thinking", thinking: "hmm", signature: "" }]);
  });

  it("drops a redactedContent reasoning block entirely (nothing renderable)", () => {
    const blocks: BedrockContentBlock[] = [
      { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } },
      { text: "answer" },
    ];
    expect(converseContentToAnthropic(blocks)).toEqual([{ type: "text", text: "answer", citations: null }]);
  });

  it("drops a reasoningText member with no actual text", () => {
    const blocks: BedrockContentBlock[] = [{ reasoningContent: { reasoningText: { text: "" } } }];
    expect(converseContentToAnthropic(blocks)).toEqual([]);
  });

  it("passes through text + multiple tool_use blocks in one turn (multi-tool turn)", () => {
    const blocks: BedrockContentBlock[] = [
      { text: "Reading two ranges." },
      { toolUse: { toolUseId: "t1", name: "read_range", input: { sheet: "A", range: "B1:B5" } } },
      { toolUse: { toolUseId: "t2", name: "read_range", input: { sheet: "B", range: "C1:C5" } } },
    ];
    const mapped = converseContentToAnthropic(blocks);
    expect(mapped).toHaveLength(3);
    expect(mapped.filter((b) => b.type === "tool_use")).toHaveLength(2);
  });

  it("coerces a stringified tool_use input", () => {
    const blocks: BedrockContentBlock[] = [
      { toolUse: { toolUseId: "t1", name: SUBMIT_TOOL, input: '{"edits":[],"newSheets":[],"notes":"","coverage":[],"charts":[]}' } },
    ];
    const mapped = converseContentToAnthropic(blocks);
    expect(mapped[0]).toMatchObject({
      type: "tool_use",
      input: { edits: [], newSheets: [], notes: "", coverage: [], charts: [] },
    });
  });

  it("synthesizes a stable id when toolUseId is missing", () => {
    const blocks: BedrockContentBlock[] = [{ toolUse: { toolUseId: undefined, name: "read_range", input: {} } }];
    const mapped = converseContentToAnthropic(blocks);
    expect(mapped[0].type).toBe("tool_use");
    expect((mapped[0] as Anthropic.ToolUseBlock).id).toMatch(/^bedrock_missing_id_/);
  });

  it("maps an empty content array to an empty result", () => {
    expect(converseContentToAnthropic([])).toEqual([]);
  });

  it("maps an absent (undefined) content array to an empty result", () => {
    expect(converseContentToAnthropic(undefined)).toEqual([]);
  });

  it("tolerates a tool_use with an absent name/input", () => {
    const blocks: BedrockContentBlock[] = [{ toolUse: { toolUseId: "t1", name: undefined, input: undefined } }];
    const mapped = converseContentToAnthropic(blocks);
    expect(mapped[0]).toEqual({ type: "tool_use", id: "t1", name: "", input: {}, caller: { type: "direct" } });
  });
});

// ---------------------------------------------------------------------------
// Stop-reason mapping.
// ---------------------------------------------------------------------------

describe("converseStopReasonToAnthropic", () => {
  it.each([
    ["end_turn", "end_turn"],
    ["tool_use", "tool_use"],
    ["max_tokens", "max_tokens"],
    ["stop_sequence", "stop_sequence"],
  ])("maps %s straight through", (input, expected) => {
    expect(converseStopReasonToAnthropic(input)).toBe(expected);
  });

  it("passes an unrecognized Converse-specific reason through verbatim", () => {
    expect(converseStopReasonToAnthropic("guardrail_intervened")).toBe("guardrail_intervened");
    expect(converseStopReasonToAnthropic("content_filtered")).toBe("content_filtered");
  });

  it("maps an absent stop reason to null", () => {
    expect(converseStopReasonToAnthropic(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Usage mapping.
// ---------------------------------------------------------------------------

describe("converseUsageToUsage", () => {
  it("maps every field, including cache accounting", () => {
    expect(
      converseUsageToUsage({
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 5,
      }),
    ).toEqual({ input: 100, output: 40, cacheRead: 20, cacheCreation: 5 });
  });

  it("defaults absent cache fields to 0", () => {
    expect(converseUsageToUsage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })).toEqual({
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheCreation: 0,
    });
  });

  it("defaults every field to 0 when usage itself is absent", () => {
    expect(converseUsageToUsage(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });
});

// ---------------------------------------------------------------------------
// Full inbound mapping: one ConverseResponse -> one AgentTurn.
// ---------------------------------------------------------------------------

describe("converseResponseToAgentTurn", () => {
  it("assembles content, stopReason, and usage from a full response", () => {
    const response: ConverseResponse = {
      output: {
        message: {
          role: "assistant",
          content: [
            { text: "Reading the range now." },
            { toolUse: { toolUseId: "t1", name: "read_range", input: { sheet: "Summary", range: "B2:D10" } } },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 500, outputTokens: 80, totalTokens: 580 },
      metrics: { latencyMs: 1200 },
    };
    const turn = converseResponseToAgentTurn(response);
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.usage).toEqual({ input: 500, output: 80, cacheRead: 0, cacheCreation: 0 });
    expect(turn.content).toEqual([
      { type: "text", text: "Reading the range now.", citations: null },
      {
        type: "tool_use",
        id: "t1",
        name: "read_range",
        input: { sheet: "Summary", range: "B2:D10" },
        caller: { type: "direct" },
      },
    ]);
  });

  it("tolerates an absent output.message (empty content, not a crash)", () => {
    const response: ConverseResponse = {
      output: undefined,
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      metrics: { latencyMs: 10 },
    };
    const turn = converseResponseToAgentTurn(response);
    expect(turn.content).toEqual([]);
    expect(turn.stopReason).toBe("end_turn");
  });
});
