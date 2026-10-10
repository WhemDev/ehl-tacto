/**
 * Production callTurn for the agent loop: one streamed model turn with the
 * bench tool definitions and the cache layout from the design — breakpoint
 * on the system prompt (tools + system, byte-identical across every task in
 * a run), on the first user message (digest + grid, stable within a task),
 * and a moving breakpoint on the latest block. 3 of the 4 allowed markers.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient, MAX_TOKENS, MODEL, ModelError } from "@/lib/anthropic/client";
import { AGENT_TOOLS } from "./agent-tools";
import type { AgentTurn, CallTurnFn } from "./agent-loop";

type Cacheable = { cache_control?: { type: "ephemeral" } | null };

/** Copy `messages`, marking the first user message's first block and the
 *  final message's last block. Assistant turns are never marked (thinking
 *  blocks cannot carry cache_control). Exported for tests. */
export function decorateWithCache(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = structuredClone(messages);
  const mark = (block: unknown) => {
    (block as Cacheable).cache_control = { type: "ephemeral" };
  };

  const first = out[0];
  if (first?.role === "user" && Array.isArray(first.content) && first.content.length) {
    mark(first.content[0]);
  }
  const last = out[out.length - 1];
  if (last !== first && last?.role === "user" && Array.isArray(last.content) && last.content.length) {
    mark(last.content[last.content.length - 1]);
  }
  return out;
}

/** Delay before the single retry in {@link withOneRetry}, as used by
 *  `makeAgentCallTurn`. A module constant so tests can pass 0 instead. */
const CALL_TURN_RETRY_DELAY_MS = 2000;

/** Run `attempt`, and on a thrown error that `isFatal` rejects, wait
 *  `delayMs` and run it exactly once more — returning or throwing whatever
 *  that second attempt produces. Exported for tests. */
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

export function makeAgentCallTurn(opts: {
  system: string;
  effort: "low" | "medium" | "high" | "max";
  model?: string;
}): CallTurnFn {
  return async (messages): Promise<AgentTurn> => {
    const attempt = async (): Promise<AgentTurn> => {
      const stream = getClient().messages.stream({
        model: opts.model ?? MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort },
        tools: AGENT_TOOLS,
        messages: decorateWithCache(messages),
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
    };

    // A request that fails outright is already retried by the SDK; a stream
    // that dies mid-response (e.g. undici's fetch-terminated error out of
    // stream.finalMessage()) is not, so cover it here — once, and never for
    // our own ModelError, where identical retries can't help.
    return withOneRetry(attempt, (error) => error instanceof ModelError);
  };
}
