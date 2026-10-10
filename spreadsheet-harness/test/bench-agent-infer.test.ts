import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ModelError } from "@/lib/anthropic/client";
import { decorateWithCache, withOneRetry } from "@/lib/bench/agent-infer";

describe("decorateWithCache", () => {
  it("marks the first user message and the last block, nothing else", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: [{ type: "text", text: "digest + grid + task" }] },
      { role: "assistant", content: [{ type: "text", text: "thinking about it" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: "cells" },
          { type: "tool_result", tool_use_id: "tu_2", content: "more cells" },
        ],
      },
    ];
    const out = decorateWithCache(messages);

    const first = out[0].content as Anthropic.TextBlockParam[];
    expect(first[0].cache_control).toEqual({ type: "ephemeral" });

    const last = out[2].content as Anthropic.ToolResultBlockParam[];
    expect(last[0].cache_control).toBeUndefined();
    expect(last[1].cache_control).toEqual({ type: "ephemeral" });

    // Assistant blocks are never marked, and the input is not mutated.
    const mid = out[1].content as Anthropic.TextBlockParam[];
    expect(mid[0].cache_control).toBeUndefined();
    expect((messages[2].content as Anthropic.ToolResultBlockParam[])[1].cache_control).toBeUndefined();
  });

  it("collapses to one marker when the conversation is a single message", () => {
    const out = decorateWithCache([
      { role: "user", content: [{ type: "text", text: "everything" }] },
    ]);
    const blocks = out[0].content as Anthropic.TextBlockParam[];
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("withOneRetry", () => {
  it("returns the first attempt's result without retrying when it succeeds", async () => {
    let calls = 0;
    const attempt = async () => {
      calls++;
      return "ok";
    };
    const result = await withOneRetry(attempt, () => false, 0);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries once after a non-fatal error and returns the retry's result", async () => {
    let calls = 0;
    const attempt = async () => {
      calls++;
      if (calls === 1) throw new Error("terminated");
      return "recovered";
    };
    const result = await withOneRetry(attempt, () => false, 0);
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("rethrows a fatal error immediately, without retrying", async () => {
    let calls = 0;
    const attempt = async () => {
      calls++;
      throw new ModelError("declined", { retryable: false });
    };
    await expect(
      withOneRetry(attempt, (e) => e instanceof ModelError, 0),
    ).rejects.toThrow("declined");
    expect(calls).toBe(1);
  });

  it("propagates the retry's error when both attempts fail", async () => {
    let calls = 0;
    const attempt = async () => {
      calls++;
      throw new Error(`fail ${calls}`);
    };
    await expect(withOneRetry(attempt, () => false, 0)).rejects.toThrow("fail 2");
    expect(calls).toBe(2);
  });
});
