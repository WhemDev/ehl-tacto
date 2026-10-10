/**
 * Bedrock runtime client + throttling backoff, the Bedrock-side counterpart
 * of lib/anthropic/client.ts. No keys in code: the client is constructed
 * with only a `region` (or none — the standard AWS SDK credential/region
 * chain resolves the rest from the environment, ~/.aws/config, an
 * instance/task role, etc., exactly as documented for @aws-sdk client
 * constructors). This module never calls AWS itself — hasAwsCredentials()
 * is a presence check only (see its own doc).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

let client: BedrockRuntimeClient | null = null;
let clientRegion: string | undefined;

/** Lazily-created, cached per region — a fresh client is only constructed
 *  when the requested region actually changes (matches
 *  lib/anthropic/client.ts's getClient() singleton-cache shape). Region
 *  resolution order: explicit `region` argument, then AWS_REGION, then
 *  AWS_DEFAULT_REGION, then whatever the AWS SDK's own default provider
 *  chain falls back to (undefined is a valid constructor input — the SDK
 *  resolves it itself, e.g. from ~/.aws/config). */
export function getBedrockClient(region?: string): BedrockRuntimeClient {
  const resolvedRegion = region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!client || clientRegion !== resolvedRegion) {
    client = new BedrockRuntimeClient(resolvedRegion ? { region: resolvedRegion } : {});
    clientRegion = resolvedRegion;
  }
  return client;
}

/** Test-only: forces the next getBedrockClient() call to construct a fresh
 *  client rather than reuse the cached singleton. Production code never
 *  needs this — the region-keyed cache above already rebuilds on a real
 *  region change. */
export function resetBedrockClientForTests(): void {
  client = null;
  clientRegion = undefined;
}

/**
 * Presence-only AWS credential check — the Bedrock-path counterpart of
 * lib/anthropic/client.ts's hasCredentials(). Deliberately never calls AWS
 * (no STS GetCallerIdentity, no ListFoundationModels): this harness has no
 * live AWS access to test against at build time (see docs/bedrock-bench.md),
 * so the check is scoped to "does the environment look configured" via the
 * same signals the standard credential provider chain itself consults —
 * explicit access keys, a session token (temporary creds), an SSO/named
 * profile, a container/EKS credential endpoint, web-identity federation
 * (IRSA), or a `~/.aws/credentials` or `~/.aws/config` file's mere
 * existence (its contents are never read here). A caller with none of these
 * set will still fail at the first real `client.send()` call with the AWS
 * SDK's own clear "could not load credentials" error — this function only
 * decides whether scripts/benchmark.ts's `--provider bedrock` path should
 * even attempt that call, exactly as hasCredentials() gates the Anthropic
 * path today.
 */
export function hasAwsCredentials(): boolean {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return true;
  if (process.env.AWS_SESSION_TOKEN) return true;
  if (process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE) return true;
  if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return true;
  }
  if (process.env.AWS_ROLE_ARN && process.env.AWS_WEB_IDENTITY_TOKEN_FILE) return true;
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    try {
      if (existsSync(join(home, ".aws", "credentials")) || existsSync(join(home, ".aws", "config"))) return true;
    } catch {
      // Filesystem access denied/unavailable — fall through to false rather
      // than let an environment quirk masquerade as "credentials found".
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Throttling retry: exponential backoff + full jitter.
// ---------------------------------------------------------------------------

/** Bedrock throttles hard, especially on shared on-demand capacity for the
 *  smaller third-party model families this adapter targets — 5 retries
 *  (6 attempts total) with a 20s cap gives a run real headroom to ride out
 *  a burst without stalling a whole benchmark sweep on one task. */
export const BEDROCK_MAX_RETRIES = 5;
export const BEDROCK_BASE_DELAY_MS = 500;
export const BEDROCK_MAX_DELAY_MS = 20_000;

export type Sleeper = (ms: number) => Promise<void>;

const defaultSleeper: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ThrottlingException and ServiceUnavailableException are the two Bedrock
 *  exceptions this adapter retries — both are named, documented transient
 *  conditions (see @aws-sdk/client-bedrock-runtime's errors.d.ts) where an
 *  identical retry is the correct response. Checked by `.name` rather than
 *  `instanceof` so a plain `{name: "ThrottlingException"}` test double
 *  exercises the exact same code path as the real SDK exception class,
 *  without needing to construct one (its constructor takes internal
 *  `$metadata`/service-exception plumbing no test should need to fake). */
export function isRetryableBedrockError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "ThrottlingException" || name === "ServiceUnavailableException";
}

/** Exponential backoff with full jitter (AWS's own recommended strategy):
 *  a uniformly random delay in [0, min(max, base * 2^attempt)). `attempt`
 *  is 0-indexed (the delay before the FIRST retry, i.e. after the initial
 *  attempt fails, uses attempt=0). Exported for tests that want to assert
 *  on the shape of the curve without going through a full retry loop. */
export function backoffDelayMs(
  attempt: number,
  base: number = BEDROCK_BASE_DELAY_MS,
  max: number = BEDROCK_MAX_DELAY_MS,
): number {
  const cap = Math.min(max, base * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

/**
 * Runs `attempt`, retrying on a retryable error (by default
 * {@link isRetryableBedrockError}) up to `maxRetries` more times, with
 * exponential-backoff-plus-jitter delays via `sleeper` between attempts. A
 * non-retryable error, or exhausting `maxRetries`, rethrows immediately —
 * this never swallows a failure, only delays and repeats it. `sleeper` is
 * injected (defaulting to a real `setTimeout`-based wait) so tests can pass
 * a fake that resolves instantly and records its calls, the same seam
 * pattern as lib/bench/agent-infer.ts's `withOneRetry` uses its `delayMs`
 * parameter for.
 */
export async function withBedrockRetry<T>(
  attempt: () => Promise<T>,
  opts: {
    maxRetries?: number;
    sleeper?: Sleeper;
    isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? BEDROCK_MAX_RETRIES;
  const sleeper = opts.sleeper ?? defaultSleeper;
  const isRetryable = opts.isRetryable ?? isRetryableBedrockError;

  for (let attemptIndex = 0; ; attemptIndex++) {
    try {
      return await attempt();
    } catch (error) {
      if (attemptIndex >= maxRetries || !isRetryable(error)) throw error;
      await sleeper(backoffDelayMs(attemptIndex));
    }
  }
}
