import { describe, expect, it } from "vitest";
import { inferSystemPrompt, refineSystemPrompt, retryMessage } from "@/lib/anthropic/prompts";

describe("the inference prompt teaches the solve block", () => {
  const prompt = inferSystemPrompt();

  it("documents solve in the IR shape", () => {
    expect(prompt).toContain('"solve"');
  });

  it("names both candidate kinds and every constraint bound", () => {
    expect(prompt).toContain("multiples");
    expect(prompt).toContain("hardMin");
    expect(prompt).toContain("hardMax");
  });

  it("names both directions", () => {
    expect(prompt).toContain("sequential");
    expect(prompt).toContain("independent");
  });

  it("tells the model to ask rather than invent a constraint band", () => {
    // The whole IR design rests on "an honest question beats a confident
    // guess" — a solve block with a made-up band would silently produce
    // authoritative-looking wrong numbers, the worst possible failure here.
    const lower = prompt.toLowerCase();
    expect(lower).toContain("openquestions");
    expect(/do not invent|don't invent|never invent|do not guess/.test(lower)).toBe(true);
  });

  it("states the maxMultiplier ceiling the schema actually enforces", () => {
    expect(prompt).toContain("1000");
  });
});

describe("the refine prompt handles solve too", () => {
  it("says an answered constraint question can become a solve block", () => {
    expect(refineSystemPrompt()).toContain("solve");
  });
});

describe("retryMessage", () => {
  it("reminds the model of the solve sourceId rule", () => {
    // schema.ts validates solve.write.sourceId and solve.target.sourceId
    // against declared sources, so a retry needs to know that too.
    expect(retryMessage("some error")).toContain("solve");
  });
});
