import * as XLSX from "xlsx";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";

export type CellSpec =
  | string
  | number
  | null
  | Date
  | { f: string; v?: number | string }
  /** A formula cell whose source never cached a value — the real shape a
   *  SpreadsheetBench Financial_Model input carries for this (see
   *  lib/workbook.ts's GridCell.uncalculated doc). Deliberately NOT the
   *  same as `{ f, v: undefined }`: writing t:"n" with v left out round-trips
   *  through XLSX.write/XLSX.read as an ERROR-typed cell instead (verified
   *  by hand while building this fixture), not the "z" (Empty) type a real
   *  uncached formula cell comes back as. Setting t:"z" explicitly is what
   *  survives the round-trip byte for byte. */
  | { f: string; uncalculated: true };

/** Real .xlsx bytes with formulas carrying cached values — house pattern. */
export function xlsxBytes(sheets: Record<string, CellSpec[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const aoa = rows.map((row) => row.map((c) => (typeof c === "object" && c !== null ? null : c)));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    rows.forEach((row, r) =>
      row.forEach((c, col) => {
        if (c === null || typeof c !== "object") return;
        const addr = XLSX.utils.encode_cell({ r, c: col });
        // A literal date cell: the same {t:'d', v: Date} shape SheetJS's own
        // cellDates:true parse produces for a real .xlsx date cell (see
        // lib/workbook.ts's parseWorkbook), as opposed to the `f`/`v`
        // formula-cell branch below.
        if (c instanceof Date) {
          ws[addr] = { t: "d", v: c };
        } else if ("uncalculated" in c) {
          ws[addr] = { t: "z", f: c.f };
        } else {
          ws[addr] = { t: typeof c.v === "string" ? "s" : "n", f: c.f, v: c.v };
        }
      }),
    );
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** A1=10, B1==A1*2 (20), C1==B1+5 (25) — a three-cell dependency chain. */
export function chainWb(): ParsedWorkbook {
  return parseWorkbook(
    xlsxBytes({
      Calc: [
        [10, { f: "A1*2", v: 20 }, { f: "B1+5", v: 25 }],
      ],
    }),
    "chain.xlsx",
  );
}
