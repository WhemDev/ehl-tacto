/**
 * SpreadsheetBench 2 dataset parsing.
 *
 * The distributed layout (huggingface.co/datasets/KAKA22/SpreadsheetBench-v2)
 * is one folder per category, each holding a `dataset.json` and the
 * spreadsheet files it references:
 *
 *   data/spreadsheetbench-v2/
 *     Debugging/         dataset.json + spreadsheet/…
 *     Financial_Model/   dataset.json + spreadsheet/…
 *     Template/          dataset.json + spreadsheet/…
 *     Visualization/     dataset.json + spreadsheet/…
 *
 * This module is pure — it parses and validates the JSON; the runner script
 * owns all file IO. Field names follow evaluation.py: `id`,
 * `instruction`, `spreadsheet_path`, `golden_response_path`,
 * `answer_position`.
 */

import { z } from "zod";
import { compareModeFor, type CompareMode } from "./compare";

export const CATEGORIES = [
  "Debugging",
  "Financial_Model",
  "Template",
  "Visualization",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Categories this harness can score. Visualization is chart generation,
 *  judged by a VLM checklist over rendered chart images in the official
 *  pipeline — Cellwise has no charting, so those tasks are not attempted. */
export const SCOREABLE_CATEGORIES: Category[] = ["Debugging", "Financial_Model", "Template"];

const rawTaskSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    instruction: z.string().min(1),
    spreadsheet_path: z.string().min(1),
    golden_response_path: z.string().min(1),
    // Visualization tasks are judged on charts and may not carry one.
    answer_position: z.string().optional(),
  })
  .passthrough();

export interface BenchTask {
  id: string;
  instruction: string;
  /** Input .xlsx, relative to the category directory. */
  spreadsheetPath: string;
  /** Golden answer .xlsx, relative to the category directory. */
  goldenResponsePath: string;
  /** Ranges the official evaluator scores. NEVER shown to the model. */
  answerPosition?: string;
  mode: CompareMode;
}

export function parseDatasetJson(text: string, category: string): BenchTask[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`dataset.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const list = z.array(rawTaskSchema).parse(raw);
  return list.map((t) => ({
    id: t.id,
    instruction: t.instruction,
    spreadsheetPath: t.spreadsheet_path,
    goldenResponsePath: t.golden_response_path,
    answerPosition: t.answer_position,
    mode: compareModeFor(category, t.spreadsheet_path),
  }));
}

export interface TaskFilter {
  /** Only these task ids. */
  ids?: string[];
  /** At most this many tasks, applied after the id filter. */
  limit?: number;
}

export function filterTasks(tasks: BenchTask[], filter: TaskFilter): BenchTask[] {
  let out = tasks;
  if (filter.ids?.length) {
    const wanted = new Set(filter.ids.map(String));
    out = out.filter((t) => wanted.has(t.id));
  }
  if (filter.limit !== undefined && filter.limit >= 0) {
    out = out.slice(0, filter.limit);
  }
  return out;
}
