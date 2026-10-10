/**
 * The chart spec: a compact, model-friendly description of an Excel chart,
 * designed to be filled out by an LLM from a task instruction and compiled
 * to real `c:chart` DrawingML by lib/charts/compile.ts.
 *
 * Phase 1 scope (see docs/spreadsheetbench-status.md item 4, "Visualization
 * (24 tasks) is not attempted"): SpreadsheetBench v2's Visualization category
 * has 24 tasks. 22 of them render as classic `c:chart` DrawingML — 8 line,
 * 4 column, 2 bubble, 2 scatter, 1 pie, 1 doughnut, 1 combo, plus three
 * variants that are really just classic chart types under a different name
 * (pareto = combo bar+line on a secondary axis, football-field = a stacked
 * horizontal bar with an invisible offset series, dot-plot = a scatter chart
 * with markers only). The remaining 2 (sunburst, waterfall) need `cx:chart`
 * chartEx DrawingML, a completely different XML vocabulary — out of scope
 * here, left for a later phase.
 *
 * This schema's shape was reverse-engineered from real Excel-authored
 * `xl/charts/chartN.xml` parts inside the 24 golden answer files (each
 * task's directory under data/spreadsheetbench-v2/Visualization/spreadsheet
 * has a "[task]_golden.xlsx", not checked in — see docs/spreadsheetbench.md
 * for how to fetch the dataset) and cross-checked against dataset.json's
 * `criteria` for what a
 * grader actually inspects: chart type, title text, series names (legend
 * entries), per-point/per-series colors, axis number formats, marker
 * symbols, data label values, and stacking. Anything Excel writes that no
 * criterion ever asks about — chart-level theme-color styling
 * (`xl/charts/style1.xml` / `colors1.xml`), per-run-of-text rich formatting,
 * 3-D perspective, trendlines, error bars — is deliberately left out. Excel
 * opens a chart missing those parts just fine and falls back to its own
 * defaults; they would triple this schema's size for zero grading benefit.
 *
 * Design choices worth calling out:
 *
 *  - Every data-carrying field (series.values, series.categories, …) is a
 *    `DataRef`: either `{ ref }`, a live A1 range the chart re-reads (an
 *    optional `cache` of literal values can ride along, exactly like real
 *    Excel's `c:numCache`/`c:strCache` — present so the chart renders with
 *    real numbers before Excel's own recalculation touches it, but never
 *    required: `c:f` alone is valid OOXML and Excel repopulates the cache on
 *    open), or `{ values }`, a fully literal array with no live link at all
 *    (compiled to `c:numLit`/`c:strLit`). A model that already knows the
 *    numbers (it read them out of the digest to write the instruction's
 *    answer) can supply `ref` + `cache` in one shot; a model that only knows
 *    the shape of the answer, not a backing range, can fall back to `values`.
 *
 *  - `ref` strings do not require a sheet prefix. `compile.ts` qualifies a
 *    bare range (`"A1:A5"`) against the chart's own `sheet` field, because
 *    OOXML's `c:f` always requires a fully sheet-qualified reference
 *    (`Count!$C$3`, never bare `$C$3`) even when the chart lives on the same
 *    sheet as its data — forcing the model to repeat the sheet name on every
 *    single series field would be pure boilerplate for the common case.
 *
 *  - `chartType: "combo"` is the one case where a per-series `type` field
 *    matters (`"column" | "bar" | "line" | "area"`) — every other chart type
 *    is uniform across all its series and the field is ignored. A combo
 *    series can also set `secondaryAxis: true`, matching the pareto/EPS/
 *    stacked-plus-line pattern seen in three of the 22 golden files (bars on
 *    the primary value axis, a line on a secondary one with its own scale).
 *
 *  - `color: "none"` is not a hex value — it is how a series asks for
 *    `<a:noFill/>`. This exists for exactly one real pattern in the golden
 *    set (Task 129, "football field"): a stacked horizontal bar chart where
 *    the first series in each stack is an invisible offset (its real job is
 *    pushing the second, visible, per-point-colored series to start at the
 *    right X position — the classic Excel "floating bar" trick, with no
 *    dedicated OOXML concept of its own). Modeling it as an ordinary series
 *    with an invisible fill, rather than inventing a `floatingBar` chart
 *    type, keeps the schema's vocabulary the same size as OOXML's own.
 *
 *  - Axis titles/number formats/min/max live under `categoryAxis` /
 *    `valueAxis` / `secondaryValueAxis`, not per-series — every chart type
 *    Phase 1 covers has at most one category axis and one or two value axes
 *    shared across all its series, so per-series axis config would be
 *    dead weight.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Leaf vocabularies — kept as literal enums (not free strings) so a model's
// mistyped value fails Zod validation with a clear "expected one of ..."
// instead of silently producing invalid OOXML compile.ts has to guess about.
// ---------------------------------------------------------------------------

/** A hex color with no leading "#" — the form `a:srgbClr val="..."` takes. */
const hexColorSchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{6}$/, "expected a 6-digit hex color with no leading '#' (e.g. \"FF0000\")");

/** A series or per-point fill: a real color, or the literal "none" for
 *  `<a:noFill/>` — see this module's header doc on the football-field
 *  invisible-offset-series pattern. */
const seriesColorSchema = z.union([z.literal("none"), hexColorSchema]);
export type SeriesColor = z.infer<typeof seriesColorSchema>;

/** ST_MarkerStyle, minus "picture" (an embedded image marker — no task in
 *  the dataset asks for one, and it would need a whole extra media part). */
const markerSymbolSchema = z.enum([
  "none",
  "circle",
  "dash",
  "diamond",
  "dot",
  "plus",
  "square",
  "star",
  "triangle",
  "x",
  "auto",
]);
export type MarkerSymbol = z.infer<typeof markerSymbolSchema>;

/** ST_DLblPos. Not every value is legal on every chart type in real Excel
 *  (e.g. `outEnd` is rejected on a stacked bar) — compile.ts does not
 *  re-validate that nuance; an implausible combination just renders however
 *  Excel's own fallback handles it, which is not a grading risk any task in
 *  the dataset actually exercises. */
const dLblPosSchema = z.enum(["ctr", "inBase", "inEnd", "outEnd", "l", "r", "t", "b", "bestFit"]);
export type DLblPos = z.infer<typeof dLblPosSchema>;

/** ST_LegendPos. "none" is not a member — see legendSchema's `show` flag:
 *  omitting `<c:legend>` entirely is how OOXML actually hides a legend. */
const legendPosSchema = z.enum(["b", "t", "l", "r", "tr"]);
export type LegendPos = z.infer<typeof legendPosSchema>;

/** The public, chart-type-agnostic vocabulary. compile.ts translates
 *  "clustered" to OOXML's `c:grouping val="standard"` for line/area charts
 *  (bar/column is the only chart family that actually uses the word
 *  "clustered" in the schema; line/area's default multi-series look is
 *  called "standard") — see this module's header doc. */
const groupingSchema = z.enum(["clustered", "stacked", "percentStacked"]);
export type Grouping = z.infer<typeof groupingSchema>;

/** Per-series chart type inside a `chartType: "combo"` spec. Restricted to
 *  the four OOXML families that can actually sit inside one `c:plotArea`
 *  sharing a category axis — pie/doughnut/scatter/bubble in a combo make no
 *  structural sense and no task asks for one. */
const comboSeriesTypeSchema = z.enum(["column", "bar", "line", "area"]);
export type ComboSeriesType = z.infer<typeof comboSeriesTypeSchema>;

export const CHART_TYPES = [
  "line",
  "column",
  "bar",
  "pie",
  "doughnut",
  "scatter",
  "bubble",
  "area",
  "combo",
] as const;
const chartTypeSchema = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof chartTypeSchema>;

// ---------------------------------------------------------------------------
// Data references
// ---------------------------------------------------------------------------

/** Numeric data (values / xValues / bubbleSizes are always numeric in
 *  OOXML — only categories can legitimately be text). `ref` compiles to
 *  `c:numRef`, `values` to `c:numLit` — see this module's header doc. */
const numericRefSchema = z
  .object({
    ref: z.string().min(1),
    cache: z.array(z.number()).min(1).optional(),
  })
  .strict();
const numericLiteralSchema = z
  .object({
    values: z.array(z.number()).min(1),
  })
  .strict();
export const numericDataRefSchema = z.union([numericRefSchema, numericLiteralSchema]);
export type NumericDataRef = z.infer<typeof numericDataRefSchema>;

/** Category data: text (product names, quarter labels, …) or numbers/dates
 *  (a date axis's categories are numeric Excel serials under the hood).
 *  Whether a `{ ref, cache }` pair without a cache renders as `c:numRef` or
 *  `c:strRef` is decided by compile.ts from `categoryAxis.dateAxis` when no
 *  cache is present to infer it from — see compile.ts's `catSource`. */
const categoryRefSchema = z
  .object({
    ref: z.string().min(1),
    cache: z.array(z.union([z.string(), z.number()])).min(1).optional(),
  })
  .strict();
const categoryLiteralSchema = z
  .object({
    values: z.array(z.union([z.string(), z.number()])).min(1),
  })
  .strict();
export const categoryDataRefSchema = z.union([categoryRefSchema, categoryLiteralSchema]);
export type CategoryDataRef = z.infer<typeof categoryDataRefSchema>;

// ---------------------------------------------------------------------------
// Data labels, markers, axes, legend, anchor
// ---------------------------------------------------------------------------

const dataLabelsSchema = z
  .object({
    /** Master on/off switch. `false` suppresses labels even if a show*
     *  flag below is also set — compile.ts treats it as "omit c:dLbls". */
    show: z.boolean().optional(),
    showValue: z.boolean().optional(),
    showCategoryName: z.boolean().optional(),
    showSeriesName: z.boolean().optional(),
    /** Pie/doughnut "N% of total" label. */
    showPercent: z.boolean().optional(),
    position: dLblPosSchema.optional(),
  })
  .strict();
export type DataLabelsSpec = z.infer<typeof dataLabelsSchema>;

const markerSchema = z
  .object({
    symbol: markerSymbolSchema.optional(),
    /** Point size in the marker's own units (Excel UI: 2-72). */
    size: z.number().int().min(2).max(72).optional(),
  })
  .strict();
export type MarkerSpec = z.infer<typeof markerSchema>;

const axisSchema = z
  .object({
    title: z.string().optional(),
    /** An Excel number-format code (`"0%"`, `"$#,##0.00"`, `"m/d/yy"`, …),
     *  written verbatim into `c:numFmt formatCode="..."`. */
    numberFormat: z.string().optional(),
    /** valueAxis/secondaryValueAxis only — ignored on categoryAxis, EXCEPT
     *  when categoryAxis is doubling as the X (bottom) value axis for a
     *  scatter/bubble chart (see the `categoryAxis` field doc below and
     *  compile.ts's `buildScatterOrBubble`), where min/max are honored. */
    min: z.number().optional(),
    max: z.number().optional(),
    /** categoryAxis only: emit `c:dateAx` (continuous date scale) instead
     *  of the default `c:catAx` (discrete text scale). */
    dateAxis: z.boolean().optional(),
  })
  .strict();
export type AxisSpec = z.infer<typeof axisSchema>;

const legendSchema = z
  .object({
    /** Default true. Set false to omit `<c:legend>` outright — see Task 95
     *  ("No legend needed") and the bubble/doughnut-gauge/football-field
     *  goldens, none of which carry a `<c:legend>` element at all. */
    show: z.boolean().optional(),
    position: legendPosSchema.optional(),
  })
  .strict();
export type LegendSpec = z.infer<typeof legendSchema>;

/** Top-left anchor cell plus a size in whole grid cells (columns/rows), not
 *  pixels or EMUs. A real `xdr:twoCellAnchor` needs both corners in
 *  col/colOff/row/rowOff form; compile.ts places the "to" corner at
 *  `(fromCol + widthCols, fromRow + heightRows)` with zero offsets, which is
 *  valid OOXML and does not need this module to know the target sheet's
 *  actual column widths (unknowable from the spec alone — that would need
 *  the input workbook's styles, which compile.ts deliberately never reads;
 *  see lib/charts/compile.ts's header doc). The visual result is "chart
 *  spans N default-width columns by M default-height rows", close enough to
 *  match a task's instruction (nothing in the 24 tasks' criteria grades
 *  exact chart pixel dimensions) without over-engineering column-width math
 *  that belongs to a rendering phase, not a compiler. */
const anchorSchema = z
  .object({
    cell: z.string().min(1),
    widthCols: z.number().int().positive().max(60).default(8),
    heightRows: z.number().int().positive().max(200).default(15),
  })
  .strict();
/** The author-facing (pre-validation) shape — `widthCols`/`heightRows`
 *  optional, per their `.default()` above. `z.input`, not `z.infer`
 *  (= `z.output`): the latter would make the defaulted fields required in
 *  every hand-written spec, defeating the point of having a default.
 *  compile.ts's own internals work with `z.output<typeof anchorSchema>`
 *  (via `chartSpecSchema.parse`'s return type) instead, once the default
 *  has actually been applied — see compile.ts's `ResolvedChartSpec`. */
export type AnchorSpec = z.input<typeof anchorSchema>;

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const seriesSchema = z
  .object({
    /** Literal series name — becomes the legend entry / `c:tx` simple
     *  string. Most tasks' criteria name a series by its literal text
     *  ("The legend contains an entry labeled 'Type A'"), so this is the
     *  common case. */
    name: z.string().optional(),
    /** A single-cell A1 ref instead of a literal name (mirrors
     *  `<c:tx><c:strRef>`) — used only when `name` is absent. */
    nameRef: z.string().min(1).optional(),
    /** Required when the chart's `chartType` is `"combo"`; ignored (every
     *  series shares the chart-level type) otherwise. */
    type: comboSeriesTypeSchema.optional(),
    /** Non-XY chart types only (bar/column/line/area/pie/doughnut/combo). */
    categories: categoryDataRefSchema.optional(),
    /** scatter/bubble only. */
    xValues: numericDataRefSchema.optional(),
    /** The one field every chart type needs: y-values for XY charts,
     *  otherwise the plain value series. */
    values: numericDataRefSchema,
    /** bubble only. */
    bubbleSizes: numericDataRefSchema.optional(),
    /** Series-level fill/line color, or `"none"` for an invisible series
     *  (see this module's header doc). Falls back to the chart's theme
     *  default when omitted. */
    color: seriesColorSchema.optional(),
    /** Per-point color overrides (`c:dPt`), keyed by 0-based point index as
     *  a decimal string (JSON object keys are always strings) — e.g.
     *  `{ "0": "00B050", "3": "FF0000" }` colors just the first and fourth
     *  points differently from the rest of the series. Used for "largest
     *  bubble green, smallest red" (Task 95) and per-slice pie/doughnut
     *  coloring. */
    pointColors: z.record(z.string().regex(/^\d+$/, "point index must be a non-negative integer"), seriesColorSchema).optional(),
    marker: markerSchema.optional(),
    /** line/scatter only: Bezier-smoothed line. Defaults false (straight
     *  segments), matching every line-chart golden in the dataset. */
    smooth: z.boolean().optional(),
    /** line/scatter only (area's `c:spPr` styles its fill, not a line, so
     *  this has no effect there). `false` omits the connecting line/border
     *  (`<a:ln><a:noFill/></a:ln>`) — the scatter "markers only" look a
     *  dot-plot needs (Task 1428419: "single square marker positioned
     *  along ..."). Defaults true (theme line shown). */
    line: z.boolean().optional(),
    /** combo only: plot this series against the chart's secondary value
     *  axis (`secondaryValueAxis`) instead of the primary one. */
    secondaryAxis: z.boolean().optional(),
    /** Per-series override of the chart-level `dataLabels` default. */
    dataLabels: dataLabelsSchema.optional(),
  })
  .strict();
export type SeriesSpec = z.infer<typeof seriesSchema>;

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

export const chartSpecSchema = z
  .object({
    chartType: chartTypeSchema,
    title: z.string().optional(),
    /** The worksheet this chart is anchored on. Also the default sheet a
     *  bare (unqualified) `ref` in any DataRef resolves against — see this
     *  module's header doc. */
    sheet: z.string().min(1),
    anchor: anchorSchema,
    series: z.array(seriesSchema).min(1),
    /** bar/column/area/combo only. Ignored (a single implicit series
     *  grouping) on line/scatter/bubble/pie/doughnut. */
    grouping: groupingSchema.optional(),
    /** The chart's category (X) axis for every chart type EXCEPT
     *  scatter/bubble, which have no category axis at all — for those two,
     *  this field's title/numberFormat/min/max double as the X (bottom)
     *  VALUE axis's config instead (see compile.ts's `buildScatterOrBubble`;
     *  `dateAxis` is ignored there, XY axes are never date axes in Phase 1).
     *  Reusing this slot avoids a third axis field in the schema that would
     *  only ever apply to two chart types out of nine. */
    categoryAxis: axisSchema.optional(),
    /** The chart's one value axis — its "Y" axis for scatter/bubble, its
     *  only axis otherwise. */
    valueAxis: axisSchema.optional(),
    /** combo only, and only meaningful when at least one series sets
     *  `secondaryAxis: true`. */
    secondaryValueAxis: axisSchema.optional(),
    legend: legendSchema.optional(),
    /** Chart-level default; a series's own `dataLabels` overrides it. */
    dataLabels: dataLabelsSchema.optional(),
    /** pie/doughnut only. Defaults true (each point/slice gets a distinct
     *  theme color) — matches every pie/doughnut golden in the dataset. */
    varyColors: z.boolean().optional(),
    /** doughnut only, percent of the plot radius (10-90). Also how a
     *  half-doughnut "gauge" is built: a wide hole plus `firstSliceAngle`
     *  and a 3-point series (filled / remainder / invisible other half) —
     *  see Task 133's golden. compile.ts does not build the gauge's
     *  center percentage label itself (Excel renders that as a
     *  `c:userShapes`-anchored text box, a chart-owned drawing layer
     *  distinct from the sheet's own `xl/drawings/drawingN.xml` this phase
     *  writes — left for a later phase; see lib/charts/compile.ts's header
     *  doc). */
    holeSize: z.number().int().min(10).max(90).optional(),
    /** pie/doughnut only, degrees clockwise from 12 o'clock (0-360). 270
     *  is what turns a full doughnut into the bottom-anchored half-circle
     *  a gauge needs. */
    firstSliceAngle: z.number().min(0).max(360).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.chartType === "combo") {
      spec.series.forEach((s, i) => {
        if (!s.type) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["series", i, "type"],
            message: "series.type is required when chartType is \"combo\"",
          });
        }
      });
    }

    if (spec.chartType === "scatter" || spec.chartType === "bubble") {
      spec.series.forEach((s, i) => {
        if (!s.xValues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["series", i, "xValues"],
            message: `series.xValues is required when chartType is "${spec.chartType}"`,
          });
        }
      });
    }

    if (spec.chartType === "bubble") {
      spec.series.forEach((s, i) => {
        if (!s.bubbleSizes) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["series", i, "bubbleSizes"],
            message: "series.bubbleSizes is required when chartType is \"bubble\"",
          });
        }
      });
    }

    // Pie/doughnut are single-ring charts here — a second series would need
    // OOXML's concentric-multi-ring rendering, which no task asks for and
    // which would double compile.ts's pie/doughnut branch for zero benefit.
    if ((spec.chartType === "pie" || spec.chartType === "doughnut") && spec.series.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series"],
        message: `chartType "${spec.chartType}" supports exactly one series (single-ring only)`,
      });
    }

    if (spec.chartType !== "doughnut") {
      if (spec.holeSize !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["holeSize"], message: "holeSize only applies to chartType \"doughnut\"" });
      }
    }
    if (spec.chartType !== "pie" && spec.chartType !== "doughnut" && spec.firstSliceAngle !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstSliceAngle"],
        message: "firstSliceAngle only applies to chartType \"pie\" or \"doughnut\"",
      });
    }
  });

/** The public, author-facing spec type — what a test or a model actually
 *  constructs, `anchor.widthCols`/`heightRows` included as optional (see
 *  `AnchorSpec`'s doc on why this is `z.input`, not `z.infer`/`z.output`).
 *  `compileChart`'s own parameter type. */
export type ChartSpec = z.input<typeof chartSpecSchema>;
