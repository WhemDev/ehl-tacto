import type Anthropic from "@anthropic-ai/sdk";
import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import { ModelError } from "@/lib/anthropic/client";
import { BEDROCK_DEFAULT_MAX_TOKENS, makeBedrockCallTurn, withOneRetry } from "@/lib/bedrock/call-turn";
import { agentToolsToConverseTools, anthropicMessagesToConverse, anthropicSystemToConverse } from "@/lib/bedrock/convert";

function okResponse(overrides: Partial<ConverseCommandOutput> = {}): ConverseCommandOutput {
  return {
    output: { message: { role: "assistant", content: [{ text: "done" }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    metrics: { latencyMs: 50 },
    $metadata: {},
    ...overrides,
  };
}

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: [{ type: "text", text: "digest + grid + task" }] },
];

describe("makeBedrockCallTurn", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a ConverseCommand built from system/model/messages/tools and returns the mapped AgentTurn", async () => {
    const send = vi.fn(async (_cmd: ConverseCommand) => okResponse());
    const callTurn = makeBedrockCallTurn({ system: "You are an agent.", model: "some.model-id", client: { send } });

    const turn = await callTurn(messages);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as unknown as ConverseCommand;
    const input = (command as unknown as { input: Record<string, unknown> }).input;
    expect(input.modelId).toBe("some.model-id");
    expect(input.system).toEqual(anthropicSystemToConverse("You are an agent."));
    expect(input.messages).toEqual(anthropicMessagesToConverse(messages));
    expect(input.toolConfig).toEqual({ tools: agentToolsToConverseTools(AGENT_TOOLS) });
    expect(input.inferenceConfig).toEqual({ maxTokens: BEDROCK_DEFAULT_MAX_TOKENS });

    expect(turn).toEqual({
      content: [{ type: "text", text: "done", citations: null }],
      stopReason: "end_turn",
      usage: { input: 12, output: 3, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("passes a custom maxTokens through to inferenceConfig", async () => {
    const send = vi.fn(async (_cmd: ConverseCommand) => okResponse());
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", maxTokens: 4096, client: { send } });
    await callTurn(messages);
    const input = (send.mock.calls[0][0] as unknown as { input: Record<string, unknown> }).input;
    expect(input.inferenceConfig).toEqual({ maxTokens: 4096 });
  });

  it("passes region through to getBedrockClient when no client is injected", () => {
    // Constructing the client must not throw / must not attempt a network
    // call even with no AWS credentials configured — client construction
    // is lazy about credential resolution.
    expect(() => makeBedrockCallTurn({ system: "sys", model: "m", region: "us-east-1" })).not.toThrow();
  });

  it("throws a retryable ModelError when the model exhausts its token budget", async () => {
    const send = vi.fn(async (_cmd: ConverseCommand) => okResponse({ stopReason: "max_tokens" }));
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", client: { send } });

    await expect(callTurn(messages)).rejects.toMatchObject({
      name: "ModelError",
      retryable: true,
    });
    // No blind retry of a ModelError — see withOneRetry's isFatal below;
    // one send() call for the whole rejected turn.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("includes the configured max-tokens budget in the ModelError message", async () => {
    const send = vi.fn(async (_cmd: ConverseCommand) => okResponse({ stopReason: "max_tokens" }));
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", maxTokens: 2048, client: { send } });
    await expect(callTurn(messages)).rejects.toThrow(/2,048/);
  });

  it("retries once (withOneRetry) on a plain thrown error, then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const send = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("stream terminated unexpectedly");
      return okResponse();
    });
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", client: { send } });

    const resultPromise = callTurn(messages);
    await vi.runAllTimersAsync();
    const turn = await resultPromise;

    expect(calls).toBe(2);
    expect(turn.stopReason).toBe("end_turn");
  });

  it("does not retry twice — a second consecutive failure propagates", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const send = vi.fn(async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    });
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", client: { send } });

    // Attach the rejection assertion BEFORE advancing fake timers: it
    // synchronously calls .then/.catch on resultPromise, so there is no
    // window where the eventual rejection is briefly unhandled (which
    // otherwise trips vitest's "Unhandled Errors" reporting even though the
    // rejection itself is expected and correctly asserted below).
    const resultPromise = callTurn(messages);
    const assertion = expect(resultPromise).rejects.toThrow("failure 2");
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(2);
  });

  it("recovers from throttling via withBedrockRetry, wired end-to-end through client.send", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const send = vi.fn(async () => {
      calls++;
      if (calls < 3) throw { name: "ThrottlingException" };
      return okResponse();
    });
    const callTurn = makeBedrockCallTurn({ system: "sys", model: "m", client: { send } });

    const resultPromise = callTurn(messages);
    await vi.runAllTimersAsync();
    const turn = await resultPromise;

    expect(calls).toBe(3);
    expect(turn.stopReason).toBe("end_turn");
  });
});

describe("withOneRetry (Bedrock call-turn's own copy)", () => {
  it("returns the first attempt's result without retrying when it succeeds", async () => {
    let calls = 0;
    const result = await withOneRetry(
      async () => {
        calls++;
        return "ok";
      },
      () => false,
      0,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries once after a non-fatal error and returns the retry's result", async () => {
    let calls = 0;
    const result = await withOneRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("terminated");
        return "recovered";
      },
      () => false,
      0,
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("rethrows a fatal error (ModelError) immediately, without retrying", async () => {
    let calls = 0;
    await expect(
      withOneRetry(
        async () => {
          calls++;
          throw new ModelError("declined", { retryable: false });
        },
        (e) => e instanceof ModelError,
        0,
      ),
    ).rejects.toThrow("declined");
    expect(calls).toBe(1);
  });
});
