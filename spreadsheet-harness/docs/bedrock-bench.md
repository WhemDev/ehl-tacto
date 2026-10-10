# Bedrock provider for the benchmark harness

`npm run bench -- --provider bedrock` drives the same agentic loop as the
default Anthropic path (`docs/spreadsheetbench.md`), but calls a model
through [Amazon Bedrock's Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
instead of the Anthropic API. It exists so mid-tier, non-Anthropic models
can be measured against SpreadsheetBench 2 using AWS credits rather than
Anthropic API spend.

This was built and tested entirely offline — see "What was and wasn't
verified" below before pointing it at real credentials.

## Running

```bash
export AWS_REGION=us-east-1   # or pass --region; standard AWS credential
                               # chain (env vars, ~/.aws/credentials, an
                               # IAM role, SSO profile, ...) supplies auth

npm run bench -- --provider bedrock --model <bedrock-model-id> \
    --category Financial_Model --limit 5
```

- `--model` is **required** for `--provider bedrock` (there is no
  Anthropic-style default) — pass the exact Bedrock model id.
- `--region` overrides `$AWS_REGION` / `$AWS_DEFAULT_REGION`; if none of the
  three are set, the AWS SDK's own default region resolution applies.
- `--mode single` is **not supported** for `--provider bedrock` (single-shot
  inference, `lib/anthropic/run.ts`'s `runValidated`, is Anthropic-only) —
  the CLI rejects that combination immediately with a clear error. Use the
  default `--mode tools`.
- Every other flag (`--category`, `--limit`, `--ids`, `--concurrency`,
  `--out`, `--resume`, `--effort`, ...) works exactly as it does for the
  Anthropic path. `--effort` is accepted but has no Bedrock equivalent today
  — it only affects the (unused, for bedrock) Anthropic single-shot branch.
- Omitting `--provider` entirely runs the pre-existing Anthropic path,
  byte-identical to before this flag existed.

## Target model families

Built for four mid-tier model families available on Bedrock:

- **Kimi K2.5** (Moonshot AI)
- **GLM-5** (Zhipu AI)
- **DeepSeek V3.2**
- **MiniMax M2 / M2.5**

## Report output

Per-task `usage` in `report.json` carries `input`/`output` token counts
exactly as the Anthropic path does — no dollar cost is computed or attached.
Bedrock pricing is per-model and varies (and, for third-party models, by
provider licensing terms), so token counts are the only thing this harness
reports; look up the applicable price yourself before extrapolating cost
from a run.

## Model-quirk guardrails already built in

`lib/bedrock/convert.ts` handles a few divergences observed across
Bedrock-hosted, non-Anthropic models:

- **Stringified tool-call input.** Some models emit a tool call's `input` as
  a JSON string rather than Converse's documented structured object. Any
  `toolUse.input` that arrives as a string is `JSON.parse`'d before it
  reaches the agent loop; a string that fails to parse is passed through
  unchanged so the loop's own schema validation produces a corrective
  message instead of this layer crashing.
- **Empty/absent content blocks** are tolerated — an empty or missing
  content array maps to `[]`, which the loop already treats as "the model
  stopped talking" (one nudge, then the task ends).
- **Text + multiple tool calls in one turn** all pass through — the agent
  loop already handles a multi-tool-call turn.
- **Reasoning/thinking content.** A response's `reasoningContent` (models
  that support Bedrock's extended-thinking-equivalent field) is mapped to an
  Anthropic-shaped `thinking` block for the submission-grade transcript log,
  but is *never* echoed back to the model on a later turn — a reasoning
  signature minted by one model has no defined meaning to a different model
  on a later call (this harness swaps `--model` per run, not per
  conversation), so outbound history strips every thinking block
  unconditionally. See the doc comment at the top of `lib/bedrock/convert.ts`
  for the full reasoning.

## Retry/robustness behavior

- `ThrottlingException` / `ServiceUnavailableException` are retried with
  exponential backoff + full jitter (`lib/bedrock/client.ts`'s
  `withBedrockRetry` — 5 retries, 500ms base, 20s cap; Bedrock throttles hard
  on shared on-demand capacity for smaller models).
- A stream/response failure that isn't one of the above gets exactly one
  blind retry (`lib/bedrock/call-turn.ts`'s `withOneRetry`), mirroring
  `lib/bench/agent-infer.ts`'s identical philosophy for the Anthropic path.
- A turn that stops with `max_tokens` throws a `ModelError { retryable: true
  }`, the same shape `lib/bench/agent-infer.ts`'s `makeAgentCallTurn` throws
  for the Anthropic path — so `run-task.ts` diagnostics and
  `scripts/benchmark.ts`'s report stay uniform regardless of provider.

## What was and wasn't verified

This adapter was built with **no AWS credentials available** — every test
in `test/bedrock-*.test.ts` runs fully offline against fixtures and mocks,
and `lib/bedrock/` never makes a live network call except inside
`makeBedrockCallTurn`'s production `ConverseCommand` path (never exercised
during this build). What that means in practice:

- **Model ids are unverified.** No specific Bedrock model id string for any
  of the four families above was confirmed against a real account. Before a
  real run, list what your account actually has enabled and copy the exact
  id from there:

  ```bash
  aws bedrock list-foundation-models --region <region> \
      --query "modelSummaries[?contains(modelId, 'kimi') || contains(modelId, 'glm') \
                || contains(modelId, 'deepseek') || contains(modelId, 'minimax')]"
  ```

  (Cross-region inference profiles, if the model you want is only available
  that way, need the profile id instead of the base model id — see
  `aws bedrock list-inference-profiles`.)

- **Converse-API compatibility per model is unverified.** This adapter
  targets Bedrock's Converse API exclusively (`ConverseCommand`), which is
  the documented, model-agnostic entry point for tool use. Whether every one
  of the four target families is actually served through Converse (versus
  needing `InvokeModel` with a provider-specific request body, or being
  offered only through some other access path) was not something this build
  could confirm without live credentials. If a real run against one of these
  models fails immediately with a validation error on the very first call
  (as opposed to a normal throttling/capacity error), check that model's
  entry in `aws bedrock list-foundation-models` for which inference
  operations it actually supports before assuming the adapter itself is
  broken.

- **Token ceilings are unverified.** `BEDROCK_DEFAULT_MAX_TOKENS` (8192,
  `lib/bedrock/call-turn.ts`) is a conservative floor, not a measured value
  for any of these models — override it via `makeBedrockCallTurn`'s
  `maxTokens` option (not yet wired to a CLI flag) if a model supports and
  needs a larger budget for a complex Financial_Model task.
