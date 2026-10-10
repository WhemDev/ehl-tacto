import { z } from "zod";

/**
 * The intermediate representation (IR) of an inferred manual workflow.
 *
 * This is the contract between the model, the UI, and the animation player.
 * Everything downstream reads and writes this object — nothing else.
 *
 * Design invariants:
 *  - `manual_judgment` is a first-class operation. When the model cannot derive
 *    a rule from the files it must emit that step type instead of inventing
 *    logic. Those steps are the conversation starters with the planner.
 *  - `assumptions`, `unknowns` and `confidence` are mandatory on every step.
 *    They drive the UI affordances (confidence bar, warning icon, chat seeds).
 *  - Ranges are always A1 notation and always qualified by `sourceId`.
 */

export const SOURCE_ROLES = ["input", "reference", "scratch", "output"] as const;

export const OPERATIONS = [
  "read",
  "filter",
  "lookup",
  "join",
  "aggregate",
  "compute",
  "sort",
  "rank",
  "allocate",
  "write",
  "manual_judgment",
] as const;

export type SourceRole = (typeof SOURCE_ROLES)[number];
export type Operation = (typeof OPERATIONS)[number];

/**
 * A1 range, optionally whole-column (`D:D`) or whole-row (`3:3`).
 * Sheet qualification lives in `sourceId`, not in the string, so a bare
 * `Sheet1!B2:F250` is also tolerated and normalised away by `parseRange`.
 */
const A1_RANGE =
  /^(?:'[^']+'!|[A-Za-z0-9_ .]+!)?(?:\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d{1,7}:\$?\d{1,7})$/;

export const rangeString = z
  .string()
  .min(1)
  .refine((s) => A1_RANGE.test(s.trim()), {
    message: "must be an A1 range such as B2:F250, D:D or 3:3",
  });

export const sourceRefSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  sheet: z.string().min(1),
  role: z.enum(SOURCE_ROLES),
});

export const readRefSchema = z.object({
  sourceId: z.string().min(1),
  range: rangeString,
  label: z.string().min(1),
  why: z.string().min(1),
});

export const writeRefSchema = z.object({
  sourceId: z.string().min(1),
  range: rangeString,
  label: z.string().min(1),
});

export const openQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** The step this came from, when it came from one. */
  stepId: z.string().optional(),
  /** What changes once it is answered. Shown under the question. */
  why: z.string().min(1),
  /**
   * Two to four mutually exclusive answers, when the question really is a pick
   * from a closed set. Absent for anything whose honest answer is a sentence.
   * The planner can always type something else, so there is never an "other".
   */
  choices: z.array(z.string().trim().min(1)).min(2).max(4).optional(),
});

/**
 * Accepts the historical bare-string form as well as the object form.
 *
 * Older responses, the committed fixture and the conformance scenario all still
 * send plain strings, and a model that has seen the old shape may too. Coercing
 * is cheaper than a migration and keeps a valid answer from being thrown away.
 */
const openQuestionsField = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v.map((q, i) =>
          typeof q === "string"
            ? { id: `q${i + 1}`, question: q, why: "Not stated." }
            : q,
        )
      : v,
  z.array(openQuestionSchema),
);

export const solveSchema = z.object({
  write: z.object({ sourceId: z.string().min(1), range: rangeString }),
  candidates: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("multiples"),
      ofCell: rangeString,
      maxMultiplier: z.number().int().min(1).max(1000),
    }),
    z.object({
      kind: z.literal("range"),
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
    }),
  ]),
  target: z.object({ sourceId: z.string().min(1), rowOffset: z.number().int() }),
  constraint: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    hardMin: z.number().optional(),
    hardMax: z.number().optional(),
  }),
  direction: z.enum(["sequential", "independent"]),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1),
  operation: z.enum(OPERATIONS),
  reads: z.array(readRefSchema),
  writes: z.array(writeRefSchema),
  params: z.record(z.unknown()).default({}),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  solve: solveSchema.optional(),
});

export const workflowIRSchema = z
  .object({
    version: z.literal("1.0"),
    title: z.string().min(1),
    summary: z.string().min(1),
    sources: z.array(sourceRefSchema).min(1),
    steps: z.array(stepSchema).min(1),
    openQuestions: openQuestionsField,
  })
  .superRefine((ir, ctx) => {
    const sourceIds = new Set(ir.sources.map((s) => s.id));

    const dupSources = ir.sources
      .map((s) => s.id)
      .filter((id, i, arr) => arr.indexOf(id) !== i);
    if (dupSources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: `duplicate source ids: ${[...new Set(dupSources)].join(", ")}`,
      });
    }

    const seenStepIds = new Set<string>();
    ir.steps.forEach((step, i) => {
      if (seenStepIds.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "id"],
          message: `duplicate step id "${step.id}"`,
        });
      }
      seenStepIds.add(step.id);

      for (const [kind, refs] of [
        ["reads", step.reads],
        ["writes", step.writes],
      ] as const) {
        refs.forEach((ref, j) => {
          if (!sourceIds.has(ref.sourceId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", i, kind, j, "sourceId"],
              message: `unknown sourceId "${ref.sourceId}" — must be one of: ${[
                ...sourceIds,
              ].join(", ")}`,
            });
          }
        });
      }

      // `solve` carries two more sourceIds, and they are subject to the same
      // file-wide invariant as the reads/writes ones above: a sourceId must
      // name a declared source. They were not checked when solveSchema was
      // added — the same shape of gap as an unbounded sibling field, caught
      // in the final whole-plan review. Without this, a solve block could
      // name a source that does not exist and validate cleanly, while the
      // identical string in `writes` one line away would be rejected.
      if (step.solve) {
        for (const [field, ref] of [
          ["write", step.solve.write],
          ["target", step.solve.target],
        ] as const) {
          if (!sourceIds.has(ref.sourceId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", i, "solve", field, "sourceId"],
              message: `unknown sourceId "${ref.sourceId}" — must be one of: ${[
                ...sourceIds,
              ].join(", ")}`,
            });
          }
        }
      }

      // A step that claims low confidence but asks nothing is usually the model
      // hedging rather than genuinely uncertain — force it to name the gap.
      if (step.confidence < 0.4 && step.unknowns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "unknowns"],
          message:
            "a step with confidence below 0.4 must list at least one unknown",
        });
      }

      if (step.operation === "manual_judgment" && step.unknowns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "unknowns"],
          message:
            'a "manual_judgment" step must list the question that needs a human answer',
        });
      }
    });

    const orders = ir.steps.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "step `order` values must be unique",
      });
    }

    const seenQuestionIds = new Set<string>();
    const stepIds = new Set(ir.steps.map((s) => s.id));
    ir.openQuestions.forEach((q, i) => {
      if (seenQuestionIds.has(q.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["openQuestions", i, "id"],
          message: `duplicate question id "${q.id}"`,
        });
      }
      seenQuestionIds.add(q.id);

      if (q.stepId && !stepIds.has(q.stepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["openQuestions", i, "stepId"],
          message: `unknown stepId "${q.stepId}" — must be one of: ${[...stepIds].join(", ")}`,
        });
      }

      if (q.choices) {
        const seenChoices = new Set(q.choices.map((c) => c.trim().toLowerCase()));
        if (seenChoices.size !== q.choices.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["openQuestions", i, "choices"],
            message: "duplicate choice — each must be a distinct answer",
          });
        }
      }
    });
  });

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type ReadRef = z.infer<typeof readRefSchema>;
export type WriteRef = z.infer<typeof writeRefSchema>;
export type Step = z.infer<typeof stepSchema>;
export type SolveStepSchema = z.infer<typeof solveSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type WorkflowIR = z.infer<typeof workflowIRSchema>;

export const refineResponseSchema = z.object({
  ir: workflowIRSchema,
  changeSummary: z.string().min(1),
});

export type RefineResponse = z.infer<typeof refineResponseSchema>;

/** Flatten a ZodError into the terse, line-per-issue form we feed back to the model. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}

/** Steps in play order. The model is asked for `order`, but never trusted on sortedness. */
export function stepsInOrder(ir: WorkflowIR): Step[] {
  return [...ir.steps].sort((a, b) => a.order - b.order);
}

export function confidenceBand(c: number): "high" | "medium" | "low" {
  if (c > 0.75) return "high";
  if (c >= 0.4) return "medium";
  return "low";
}
