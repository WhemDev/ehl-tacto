/**
 * Production callTurn for the agent loop over Amazon Bedrock's Converse API
 * — the Bedrock-side counterpart of lib/bench/agent-infer.ts's
 * makeAgentCallTurn. Built so mid-tier models available through Bedrock
 * (Kimi K2.5, GLM-5, DeepSeek V3.2, MiniMax M2/M2.5 — see
 * docs/bedrock-bench.md) can drive the same agent loop the Anthropic path
 * does, via `--provider bedrock` in scripts/benchmark.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ConverseCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ModelError } from "@/lib/anthropic/client";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import type { AgentTurn, CallTurnFn } from "@/lib/agent/loop";
import { getBedrockClient, withBedrockRetry } from "./client";
import {
  agentToolsToConverseTools,
  anthropicMessagesToConverse,
  anthropicSystemToConverse,
  converseResponseToAgentTurn,
} from "./convert";

/**
 * Conservative default output budget. Unlike lib/anthropic/client.ts's
 * MAX_TOKENS (measured against one specific model, Sonnet 5), the four
 * target Bedrock model families have no single shared, verified ceiling —
 * see docs/bedrock-bench.md's note that model ids and limits need
 * confirming against `aws bedrock list-foundation-models` once credentials
 * are live. 8192 is a widely-supported floor for a tool-using turn; pass
 * `maxTokens` explicitly for a model known to support (and benefit from) a
 * larger budget.
 */
export const BEDROCK_DEFAULT_MAX_TOKENS = 8192;

/** Delay before the single retry in {@link withOneRetry}. A module constant
 *  so tests can pass 0 — mirrors lib/bench/agent-infer.ts's
 *  CALL_TURN_RETRY_DELAY_MS exactly (same value, same role). */
const CALL_TURN_RETRY_DELAY_MS = 2000;

/**
 * Run `attempt`, and on a thrown error that `isFatal` rejects, wait
 * `delayMs` and run it exactly once more — returning or throwing whatever
 * that second attempt produces. Duplicated from lib/bench/agent-infer.ts
 * rather than imported: this module is a peer provider adapter, not a
 * consumer of lib/bench (a benchmark-only module), and the two now stay in
 * lockstep as documented parallel implementations rather than an
 * across-layer dependency. See lib/bedrock/client.ts's withBedrockRetry for
 * the OTHER retry loop this composes with — that one covers
 * ThrottlingException/ServiceUnavailableException with backoff+jitter,
 * this one covers everything else worth one blind retry (e.g. a stream
 * that dies mid-response), never our own ModelError, where an identical
 * retry cannot help. Exported for tests.
 */
export async function withOneRetry<T>(
  attempt: () => Promise<T>,
  isFatal: (error: unknown) => boolean,
  delayMs: number = CALL_TURN_RETRY_DELAY_MS,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (isFatal(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return attempt();
  }
}

export function makeBedrockCallTurn(opts: {
  system: string;
  model: string;
  region?: string;
  maxTokens?: number;
  /** Test-only seam: inject a fake Converse-capable client instead of the
   *  real getBedrockClient(region) singleton. Anything with a `.send`
   *  method compatible with ConverseCommand works — a real
   *  BedrockRuntimeClient satisfies this structurally, so production
   *  callers never need to pass it. */
  client?: Pick<BedrockRuntimeClient, "send">;
}): CallTurnFn {
  const client = opts.client ?? getBedrockClient(opts.region);
  const converseTools = agentToolsToConverseTools(AGENT_TOOLS);
  const system = anthropicSystemToConverse(opts.system);
  const maxTokens = opts.maxTokens ?? BEDROCK_DEFAULT_MAX_TOKENS;

  return async (messages: Anthropic.MessageParam[]): Promise<AgentTurn> => {
    const attempt = async (): Promise<AgentTurn> => {
      const response = await withBedrockRetry(() =>
        client.send(
          new ConverseCommand({
            modelId: opts.model,
            system,
            messages: anthropicMessagesToConverse(messages),
            toolConfig: { tools: converseTools },
            inferenceConfig: { maxTokens },
          }),
        ),
      );

      // Mirrors lib/bench/agent-infer.ts's makeAgentCallTurn exactly: a
      // turn that exhausts its token budget mid-response is not a normal
      // AgentTurn, it's a ModelError — so run-task.ts's diagnostics (and
      // scripts/benchmark.ts's report) see the same shape regardless of
      // which provider produced it. `retryable: true` is metadata only
      // (nothing in this file retries a ModelError — see withOneRetry's
      // isFatal below); it documents to a higher-level caller that a fresh
      // attempt at the whole task might succeed, unlike e.g. a refusal.
      if (response.stopReason === "max_tokens") {
        throw new ModelError(
          `The model used its entire ${maxTokens.toLocaleString()}-token budget mid-turn.`,
          { retryable: true },
        );
      }

      return converseResponseToAgentTurn(response);
    };

    return withOneRetry(attempt, (error) => error instanceof ModelError);
  };
}
