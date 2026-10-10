import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { callModel, type CallResult, type Usage } from "./client";
import { parseJsonLoose } from "./json";
import { retryMessage } from "./prompts";
import { formatZodIssues } from "@/lib/ir/schema";

/**
 * Ask the model for JSON, validate it, and give it exactly one chance to fix
 * its own mistakes.
 *
 * Structured outputs aren't wired up here, so validation is the only thing
 * standing between a hallucinated column reference and an animation that
 * highlights nothing. On a second failure we surface the raw text rather than
 * silently degrading — a visible error beats a blank grid.
 */

export class InvalidModelOutput extends Error {
  readonly raw: string;
  readonly issues: string;
  readonly attempts: number;

  constructor(raw: string, issues: string, attempts: number) {
    super("The model did not return a valid workflow.");
    this.name = "InvalidModelOutput";
    this.raw = raw;
    this.issues = issues;
    this.attempts = attempts;
  }
}

export interface RunResult<T> {
  value: T;
  attempts: number;
  usage: Usage;
  /**
   * The raw, un-parsed text of every attempt's response, in order — this is
   * the only place runValidated ever sees that text (`result.text`, below),
   * so surfacing it here is the cheapest way for a caller to log what the
   * model actually said. Best-effort: unlike lib/agent/loop.ts's `messages`
   * (the agentic path, which is what submission-grade runs use), this
   * carries text only, not full content blocks — no thinking blocks, no
   * structured tool_use — since this function never keeps those beyond a
   * single retry echo. See lib/bench/run-task.ts's TaskTranscript for where
   * this lands in a benchmark run's log.
   */
  responses: string[];
}

export async function runValidated<T>(opts: {
  system: string;
  userMessage: string;
  /**
   * Input is `unknown` rather than `T`: schemas with `.default()` have an input
   * type that differs from their output, and what we hand it is always freshly
   * parsed JSON.
   */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: string;
}): Promise<RunResult<T>> {
  const { system, userMessage, schema, effort = "medium", model } = opts;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let last: CallResult | null = null;
  let lastIssues = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  const responses: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await callModel({ system, messages, effort, model });
    last = result;
    inputTokens += result.usage.input;
    outputTokens += result.usage.output;
    cacheReadTokens += result.usage.cacheRead;
    cacheCreationTokens += result.usage.cacheCreation;
    responses.push(result.text);

    const parsed = parseJsonLoose(result.text);
    if (!parsed.ok) {
      lastIssues = `- (root): the response was not valid JSON — ${parsed.error}`;
    } else {
      const validated = schema.safeParse(parsed.value);
      if (validated.success) {
        return {
          value: validated.data,
          attempts: attempt,
          usage: {
            input: inputTokens,
            output: outputTokens,
            cacheRead: cacheReadTokens,
            cacheCreation: cacheCreationTokens,
          },
          responses,
        };
      }
      lastIssues = formatZodIssues(validated.error);
    }

    if (attempt === 1) {
      // Echo the assistant turn back verbatim — including thinking blocks — so
      // the retry continues the same reasoning instead of starting cold.
      messages.push({
        role: "assistant",
        content: result.content as unknown as Anthropic.ContentBlockParam[],
      });
      messages.push({ role: "user", content: retryMessage(lastIssues) });
    }
  }

  throw new InvalidModelOutput(last?.text ?? "", lastIssues, 2);
}
