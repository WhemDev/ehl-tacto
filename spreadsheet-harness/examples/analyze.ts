/**
 * Minimal, model-free tour of the harness: parse a workbook, build the
 * budgeted digest, use the analysis tools, and run a what-if through the
 * formula engine.
 *
 *   npx tsx examples/analyze.ts public/samples/capacity.xlsx
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseWorkbook } from "../lib/workbook";
import { buildFileDigest, estimateTokens } from "../lib/digest";
import { readRange, searchCells, traceCell } from "../lib/analysis/tools";
import { createSimulator } from "../lib/formula/simulate";

const path = process.argv[2] ?? "public/samples/capacity.xlsx";
const wb = parseWorkbook(new Uint8Array(readFileSync(path)), basename(path));

// 1. Digest: the compact description a model sees first (headers, column
//    shapes, collapsed formula patterns), guaranteed to fit the budget.
const digest = buildFileDigest(wb);
console.log(`# ${wb.fileName}: ${wb.sheets.length} sheet(s), digest ≈ ${estimateTokens(digest)} tokens`);
for (const s of digest.sheets) {
  console.log(`- ${s.name}: ${s.formulaPatterns.length} formula pattern(s)`);
  for (const p of s.formulaPatterns.slice(0, 3)) console.log(`    ${p.range} (x${p.count})  ${p.pattern}`);
}

// 2. Retrieval tools: what the agent calls when the digest isn't enough.
const first = wb.sheets[0];
console.log("\nread_range A1:D5 →\n" + readRange(wb, first.name, "A1:D5").text);
const hits = searchCells(wb, "total", { limit: 5 });
console.log(`\nsearch_cells "total" → ${hits.matches.length} match(es)`);

// 3. Formula engine: trace a formula cell, then change an input and recalc.
const sim = createSimulator(wb);
const formulaPattern = digest.sheets.flatMap((s) => s.formulaPatterns.map((p) => ({ s, p })))[0];
if (formulaPattern) {
  const sheet = formulaPattern.s.name;
  const cell = formulaPattern.p.range.split(":")[0];
  console.log(`\ntrace_cell ${sheet}!${cell} precedents →`, traceCell(sim, sheet, cell, "precedents"));
  const [prec] = sim.precedentsOf(sheet, cell);
  if (prec) {
    const [pSheet, pCell] = prec.split("!");
    const before = sim.getValue(sheet, cell);
    await sim.setValue(pSheet, pCell, 0);
    await sim.recalculate();
    console.log(`what-if: ${prec} := 0 → ${sheet}!${cell} ${JSON.stringify(before)} → ${JSON.stringify(sim.getValue(sheet, cell))}`);
  }
}
