/**
 * scripts/benchmark.ts's --provider flag: parseArgs validation, the default
 * ("anthropic") staying byte-identical to the pre-Bedrock wiring, and the
 * bedrock branch calling the right call-turn factory with the right
 * arguments. lib/agent/loop.ts's runAgentLoop is mocked out entirely — this
 * file is testing scripts/benchmark.ts's OWN wiring decision (which factory
 * gets called, with what arguments), not the agent loop itself (that has
 * its own extensive test/bench-agent-loop.test.ts coverage), so a real
 * ParsedWorkbook is never needed here.
 */
import type { ParsedWorkbook } from "@/lib/workbook";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentLoopMock } = vi.hoisted(() => ({
  runAgentLoopMock: vi.fn(async () => ({
    plan: null,
    applied: null,
    planError: undefined,
    result: null,
    diagnostics: {
      turns: 1,
      toolCalls: {},
      submitOutcome: "clean" as const,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    },
    messages: [],
  })),
}));
vi.mock("@/lib/bench/agent-loop", () => ({ runAgentLoop: runAgentLoopMock }));

const { buildAgent, checkCredentials, parseArgs } = await import("@/scripts/benchmark");
type Options = Awaited<ReturnType<typeof parseArgs>>;

const STUB_WORKBOOK = {} as ParsedWorkbook;

class ProcessExitError extends Error {
  code: number | undefined;
  constructor(code: number | undefined) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/** Runs `fn`, catching the process.exit call `usage()` makes on a bad flag
 *  combination — parseArgs's existing convention (see e.g. its --effort/
 *  --mode/--category checks) for every validation failure, unchanged by
 *  this feature. Returns the exit code and everything printed to
 *  console.error, so a test can assert on the message without the process
 *  actually exiting mid test run. */
function captureExit(fn: () => void): { code: number | undefined; stderr: string } {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    fn();
    return { code: undefined, stderr: errorSpy.mock.calls.map((c) => c.join(" ")).join("\n") };
  } catch (err) {
    if (err instanceof ProcessExitError) {
      return { code: err.code, stderr: errorSpy.mock.calls.map((c) => c.join(" ")).join("\n") };
    }
    throw err;
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

beforeEach(() => {
  runAgentLoopMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// parseArgs: --provider default + validation.
// ---------------------------------------------------------------------------

describe("parseArgs — --provider", () => {
  it("defaults to \"anthropic\" and leaves region undefined when nothing is set", () => {
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_DEFAULT_REGION", "");
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    const opts = parseArgs(["--category", "Template", "--baseline"]);
    expect(opts.provider).toBe("anthropic");
    expect(opts.region).toBeUndefined();
  });

  it("accepts --provider bedrock with a --model and default --mode tools", () => {
    const opts = parseArgs(["--category", "Template", "--provider", "bedrock", "--model", "moonshotai.kimi-k2.5"]);
    expect(opts.provider).toBe("bedrock");
    expect(opts.model).toBe("moonshotai.kimi-k2.5");
    expect(opts.mode).toBe("tools");
  });

  it("rejects an unknown --provider value", () => {
    const { code, stderr } = captureExit(() =>
      parseArgs(["--category", "Template", "--provider", "openai"]),
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/Bad --provider "openai"/);
  });

  it("rejects --provider bedrock combined with --mode single", () => {
    const { code, stderr } = captureExit(() =>
      parseArgs(["--category", "Template", "--provider", "bedrock", "--model", "m", "--mode", "single"]),
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/does not support --mode single/);
  });

  it("rejects --provider bedrock with no --model", () => {
    const { code, stderr } = captureExit(() =>
      parseArgs(["--category", "Template", "--provider", "bedrock"]),
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/requires --model/);
  });

  it("does not require --model for --provider anthropic (falls back to MODEL)", () => {
    expect(() => parseArgs(["--category", "Template", "--baseline"])).not.toThrow();
  });
});

describe("parseArgs — --region", () => {
  it("takes --region when given", () => {
    const opts = parseArgs(["--category", "Template", "--provider", "bedrock", "--model", "m", "--region", "eu-west-1"]);
    expect(opts.region).toBe("eu-west-1");
  });

  it("falls back to $AWS_REGION when --region is omitted", () => {
    vi.stubEnv("AWS_REGION", "ap-southeast-2");
    const opts = parseArgs(["--category", "Template", "--baseline"]);
    expect(opts.region).toBe("ap-southeast-2");
  });

  it("falls back to $AWS_DEFAULT_REGION when neither --region nor $AWS_REGION is set", () => {
    vi.stubEnv("AWS_REGION", "");
    delete process.env.AWS_REGION;
    vi.stubEnv("AWS_DEFAULT_REGION", "us-west-2");
    const opts = parseArgs(["--category", "Template", "--baseline"]);
    expect(opts.region).toBe("us-west-2");
  });
});

// ---------------------------------------------------------------------------
// checkCredentials
// ---------------------------------------------------------------------------

describe("checkCredentials", () => {
  it("checks Anthropic credentials for the anthropic provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    delete process.env.AWS_ACCESS_KEY_ID;
    const opts = parseArgs(["--category", "Template"]);
    expect(checkCredentials(opts)).toBe(true);
  });

  it("checks AWS credentials for the bedrock provider, ignoring Anthropic env", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    delete process.env.ANTHROPIC_API_KEY;
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    const opts = parseArgs(["--category", "Template", "--provider", "bedrock", "--model", "m"]);
    expect(checkCredentials(opts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildAgent — the actual "bedrock wiring" the task asks for: mock the
// call-turn factories, invoke the built agent once (with runAgentLoop
// mocked out), and assert on exactly what each factory was called with.
// ---------------------------------------------------------------------------

describe("buildAgent", () => {
  function baseOpts(overrides: Partial<Options> = {}): Options {
    return {
      datasetDir: "/tmp/dataset",
      categories: ["Template"],
      concurrency: 1,
      outDir: "/tmp/out",
      baseline: false,
      resume: false,
      effort: "high",
      mode: "tools",
      provider: "anthropic",
      ...overrides,
    };
  }

  it("anthropic (default provider): wires makeAgentCallTurn exactly as scripts/benchmark.ts did before --provider existed", async () => {
    const fakeCallTurn = vi.fn();
    const makeAgentCallTurn = vi.fn(() => fakeCallTurn);
    const makeBedrockCallTurn = vi.fn();
    const opts = baseOpts({ provider: "anthropic", effort: "max", model: "claude-sonnet-5" });

    const agent = buildAgent(opts, { makeAgentCallTurn, makeBedrockCallTurn });
    await agent({ workbook: STUB_WORKBOOK, system: "SYSTEM PROMPT", userMessage: "USER MESSAGE" });

    expect(makeAgentCallTurn).toHaveBeenCalledTimes(1);
    expect(makeAgentCallTurn).toHaveBeenCalledWith({ system: "SYSTEM PROMPT", effort: "max", model: "claude-sonnet-5" });
    expect(makeBedrockCallTurn).not.toHaveBeenCalled();
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({ workbook: STUB_WORKBOOK, userMessage: "USER MESSAGE", callTurn: fakeCallTurn }),
    );
  });

  it("anthropic branch omits --model, matching runAgentLoop's own MODEL fallback (untouched by this feature)", async () => {
    const makeAgentCallTurn = vi.fn(() => vi.fn());
    const opts = baseOpts({ provider: "anthropic", effort: "high", model: undefined });
    const agent = buildAgent(opts, { makeAgentCallTurn, makeBedrockCallTurn: vi.fn() });
    await agent({ workbook: STUB_WORKBOOK, system: "s", userMessage: "u" });
    expect(makeAgentCallTurn).toHaveBeenCalledWith({ system: "s", effort: "high", model: undefined });
  });

  it("bedrock: wires makeBedrockCallTurn with system/model/region, never touching makeAgentCallTurn", async () => {
    const fakeCallTurn = vi.fn();
    const makeBedrockCallTurn = vi.fn(() => fakeCallTurn);
    const makeAgentCallTurn = vi.fn();
    const opts = baseOpts({
      provider: "bedrock",
      model: "moonshotai.kimi-k2.5",
      region: "us-east-1",
    });

    const agent = buildAgent(opts, { makeAgentCallTurn, makeBedrockCallTurn });
    await agent({ workbook: STUB_WORKBOOK, system: "SYSTEM PROMPT", userMessage: "USER MESSAGE" });

    expect(makeBedrockCallTurn).toHaveBeenCalledTimes(1);
    expect(makeBedrockCallTurn).toHaveBeenCalledWith({
      system: "SYSTEM PROMPT",
      model: "moonshotai.kimi-k2.5",
      region: "us-east-1",
    });
    expect(makeAgentCallTurn).not.toHaveBeenCalled();
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({ workbook: STUB_WORKBOOK, userMessage: "USER MESSAGE", callTurn: fakeCallTurn }),
    );
  });

  it("bedrock: throws synchronously (before ever calling a factory) when --model is missing", () => {
    const makeAgentCallTurn = vi.fn();
    const makeBedrockCallTurn = vi.fn();
    const opts = baseOpts({ provider: "bedrock", model: undefined });
    expect(() => buildAgent(opts, { makeAgentCallTurn, makeBedrockCallTurn })).toThrow(/--model is required/);
    expect(makeBedrockCallTurn).not.toHaveBeenCalled();
  });

  it("bedrock: region is undefined when not configured (passed through as-is, not defaulted here)", async () => {
    const makeBedrockCallTurn = vi.fn(() => vi.fn());
    const opts = baseOpts({ provider: "bedrock", model: "m", region: undefined });
    const agent = buildAgent(opts, { makeAgentCallTurn: vi.fn(), makeBedrockCallTurn });
    await agent({ workbook: STUB_WORKBOOK, system: "s", userMessage: "u" });
    expect(makeBedrockCallTurn).toHaveBeenCalledWith({ system: "s", model: "m", region: undefined });
  });
});
