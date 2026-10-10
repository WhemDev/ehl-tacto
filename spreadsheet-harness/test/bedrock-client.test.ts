import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BEDROCK_BASE_DELAY_MS,
  BEDROCK_MAX_DELAY_MS,
  backoffDelayMs,
  hasAwsCredentials,
  isRetryableBedrockError,
  withBedrockRetry,
} from "@/lib/bedrock/client";

// ---------------------------------------------------------------------------
// hasAwsCredentials — presence-only check, no AWS calls. Every env var it
// consults, plus $HOME, is saved and restored around each test so this file
// never leaks state into the rest of the suite (or picks up the real
// developer's ~/.aws files by accident).
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "HOME",
  "USERPROFILE",
] as const;

describe("hasAwsCredentials", () => {
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string>>;
  let scratchHome: string;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      const v = process.env[key];
      if (v !== undefined) saved[key] = v;
      delete process.env[key];
    }
    // A fresh, empty $HOME with no .aws directory — isolates the
    // file-presence checks from whatever the real machine running this
    // suite happens to have configured.
    scratchHome = mkdtempSync(join(tmpdir(), "bedrock-client-test-"));
    process.env.HOME = scratchHome;
  });

  afterEach(() => {
    rmSync(scratchHome, { recursive: true, force: true });
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(saved)) process.env[key] = value;
  });

  it("returns false when nothing at all is configured", () => {
    expect(hasAwsCredentials()).toBe(false);
  });

  it("returns true with an access key + secret pair", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns false with only the access key id set (no secret)", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    expect(hasAwsCredentials()).toBe(false);
  });

  it("returns true with a session token alone (temporary credentials)", () => {
    process.env.AWS_SESSION_TOKEN = "token";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true with AWS_PROFILE set", () => {
    process.env.AWS_PROFILE = "cellwise-bench";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true with AWS_DEFAULT_PROFILE set", () => {
    process.env.AWS_DEFAULT_PROFILE = "default";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true with container credentials (relative URI)", () => {
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/v2/credentials/abc";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true with container credentials (full URI)", () => {
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = "http://169.254.170.2/v2/credentials/abc";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true with a web-identity role (IRSA) — both vars present", () => {
    process.env.AWS_ROLE_ARN = "arn:aws:iam::123456789012:role/bench";
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE = "/var/run/secrets/token";
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns false with only AWS_ROLE_ARN and no token file", () => {
    process.env.AWS_ROLE_ARN = "arn:aws:iam::123456789012:role/bench";
    expect(hasAwsCredentials()).toBe(false);
  });

  it("returns true when ~/.aws/credentials exists (contents never read)", () => {
    mkdirSync(join(scratchHome, ".aws"), { recursive: true });
    writeFileSync(join(scratchHome, ".aws", "credentials"), "[default]\n");
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns true when ~/.aws/config exists", () => {
    mkdirSync(join(scratchHome, ".aws"), { recursive: true });
    writeFileSync(join(scratchHome, ".aws", "config"), "[default]\nregion = us-east-1\n");
    expect(hasAwsCredentials()).toBe(true);
  });

  it("returns false when ~/.aws exists but is empty", () => {
    mkdirSync(join(scratchHome, ".aws"), { recursive: true });
    expect(hasAwsCredentials()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRetryableBedrockError
// ---------------------------------------------------------------------------

describe("isRetryableBedrockError", () => {
  it("is true for ThrottlingException", () => {
    expect(isRetryableBedrockError({ name: "ThrottlingException" })).toBe(true);
  });

  it("is true for ServiceUnavailableException", () => {
    expect(isRetryableBedrockError({ name: "ServiceUnavailableException" })).toBe(true);
  });

  it("is false for other named errors", () => {
    expect(isRetryableBedrockError({ name: "ValidationException" })).toBe(false);
    expect(isRetryableBedrockError(new Error("boom"))).toBe(false);
  });

  it("is false for null/undefined/non-object input", () => {
    expect(isRetryableBedrockError(null)).toBe(false);
    expect(isRetryableBedrockError(undefined)).toBe(false);
    expect(isRetryableBedrockError("ThrottlingException")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// backoffDelayMs
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
  it("stays within [0, min(max, base * 2^attempt)) across attempts", () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const delay = backoffDelayMs(attempt, 100, 1000);
      const cap = Math.min(1000, 100 * 2 ** attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(cap);
    }
  });

  it("respects the max delay cap even at a high attempt count", () => {
    const delay = backoffDelayMs(20, BEDROCK_BASE_DELAY_MS, BEDROCK_MAX_DELAY_MS);
    expect(delay).toBeLessThan(BEDROCK_MAX_DELAY_MS);
  });

  it("uses the module's own default base/max when not overridden", () => {
    // Attempt 0 with the real defaults: base * 2^0 = base, so the result
    // must fall in [0, BEDROCK_BASE_DELAY_MS).
    const delay = backoffDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(BEDROCK_BASE_DELAY_MS);
  });
});

// ---------------------------------------------------------------------------
// withBedrockRetry — scripted failures against a fake, instant sleeper.
// ---------------------------------------------------------------------------

describe("withBedrockRetry", () => {
  it("returns the first attempt's result without sleeping when it succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withBedrockRetry(
      async () => {
        calls++;
        return "ok";
      },
      { sleeper: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("retries a ThrottlingException and returns the eventual success", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withBedrockRetry(
      async () => {
        calls++;
        if (calls < 3) throw { name: "ThrottlingException", message: "rate exceeded" };
        return "recovered";
      },
      { sleeper: async (ms) => void sleeps.push(ms), maxRetries: 5 },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it("retries a ServiceUnavailableException the same way", async () => {
    let calls = 0;
    const result = await withBedrockRetry(
      async () => {
        calls++;
        if (calls < 2) throw { name: "ServiceUnavailableException" };
        return "ok";
      },
      { sleeper: async () => {}, maxRetries: 3 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("exhausts maxRetries and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withBedrockRetry(
        async () => {
          calls++;
          throw { name: "ThrottlingException", attempt: calls };
        },
        { sleeper: async () => {}, maxRetries: 2 },
      ),
    ).rejects.toMatchObject({ name: "ThrottlingException", attempt: 3 });
    expect(calls).toBe(3); // the initial attempt + 2 retries
  });

  it("does not retry a non-retryable error, and never calls the sleeper", async () => {
    let calls = 0;
    const sleeper = async () => {
      throw new Error("sleeper should never be called for a non-retryable error");
    };
    await expect(
      withBedrockRetry(
        async () => {
          calls++;
          throw { name: "ValidationException" };
        },
        { sleeper },
      ),
    ).rejects.toMatchObject({ name: "ValidationException" });
    expect(calls).toBe(1);
  });

  it("honors a custom isRetryable predicate", async () => {
    let calls = 0;
    const result = await withBedrockRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("custom-retryable");
        return "ok";
      },
      { sleeper: async () => {}, isRetryable: (e) => e instanceof Error && e.message === "custom-retryable" },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("uses a real (unfaked) sleeper by default without hanging the test", async () => {
    // maxRetries: 0 means the default sleeper is never actually invoked
    // (there is no retry to sleep before) — this just confirms the
    // production default path doesn't require a sleeper to be passed.
    const result = await withBedrockRetry(async () => "ok", { maxRetries: 0 });
    expect(result).toBe("ok");
  });
});
