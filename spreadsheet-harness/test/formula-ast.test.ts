import { describe, expect, it } from "vitest";
import { excelError, isExcelError, type CellValue } from "@/lib/formula/ast";

describe("excelError / isExcelError", () => {
  it("constructs a tagged error value", () => {
    const e = excelError("#DIV/0!");
    expect(e).toEqual({ kind: "error", code: "#DIV/0!" });
  });

  it("recognises a value built by excelError", () => {
    expect(isExcelError(excelError("#N/A"))).toBe(true);
  });

  it("rejects a plain object that merely looks similar", () => {
    expect(isExcelError({ kind: "error" })).toBe(false); // no `code`
    expect(isExcelError({ code: "#N/A" })).toBe(false); // no `kind`
  });

  it("rejects ordinary CellValues", () => {
    const notErrors: CellValue[] = [1, "text", true, null, new Date(2025, 0, 1)];
    for (const v of notErrors) expect(isExcelError(v)).toBe(false);
  });

  it("rejects null and non-objects without throwing", () => {
    expect(isExcelError(null)).toBe(false);
    expect(isExcelError(undefined)).toBe(false);
    expect(isExcelError(42)).toBe(false);
    expect(isExcelError("error")).toBe(false);
  });
});
