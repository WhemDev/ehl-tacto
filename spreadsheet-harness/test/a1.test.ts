import { describe, expect, it } from "vitest";
import {
  boxCellCount,
  clampBox,
  colToIndex,
  formatRange,
  indexToCol,
  parseRange,
  shiftRangeRef,
  splitSheetRef,
} from "@/lib/a1";

describe("column letters", () => {
  it("maps letters to indices", () => {
    expect(colToIndex("A")).toBe(0);
    expect(colToIndex("Z")).toBe(25);
    expect(colToIndex("AA")).toBe(26);
    expect(colToIndex("AB")).toBe(27);
    expect(colToIndex("CV")).toBe(99);
  });

  it("round-trips every index up to 1000", () => {
    for (let i = 0; i < 1000; i++) {
      expect(colToIndex(indexToCol(i))).toBe(i);
    }
  });
});

describe("splitSheetRef", () => {
  it("splits qualified refs and strips quotes", () => {
    expect(splitSheetRef("Sheet1!B2:F250")).toEqual({ sheet: "Sheet1", range: "B2:F250" });
    expect(splitSheetRef("'Open Orders'!A1")).toEqual({ sheet: "Open Orders", range: "A1" });
    expect(splitSheetRef("B2:F250")).toEqual({ range: "B2:F250" });
  });
});

describe("parseRange", () => {
  it("parses a single cell", () => {
    expect(parseRange("C14")).toMatchObject({
      startRow: 13,
      endRow: 13,
      startCol: 2,
      endCol: 2,
    });
  });

  it("parses a rectangular range", () => {
    expect(parseRange("B2:F250")).toMatchObject({
      startRow: 1,
      endRow: 249,
      startCol: 1,
      endCol: 5,
    });
  });

  it("normalises reversed and absolute ranges", () => {
    expect(parseRange("$F$250:$B$2")).toMatchObject({
      startRow: 1,
      endRow: 249,
      startCol: 1,
      endCol: 5,
    });
  });

  it("clamps whole-column ranges to the supplied bounds", () => {
    const box = parseRange("D:D", { rows: 400, cols: 20 })!;
    expect(box.wholeColumn).toBe(true);
    expect(box).toMatchObject({ startRow: 0, endRow: 399, startCol: 3, endCol: 3 });
  });

  it("clamps whole-row ranges to the supplied bounds", () => {
    const box = parseRange("3:3", { rows: 400, cols: 20 })!;
    expect(box.wholeRow).toBe(true);
    expect(box).toMatchObject({ startRow: 2, endRow: 2, startCol: 0, endCol: 19 });
  });

  it("ignores a sheet qualifier", () => {
    expect(parseRange("'Weekly Plan'!A1:C3")).toMatchObject({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 2,
    });
  });

  it("returns null for junk", () => {
    expect(parseRange("not a range")).toBeNull();
    expect(parseRange("")).toBeNull();
  });
});

describe("formatRange / clampBox", () => {
  it("collapses a 1x1 box to a single cell", () => {
    expect(formatRange({ startRow: 13, endRow: 13, startCol: 2, endCol: 2 })).toBe("C14");
  });

  it("formats a rectangle", () => {
    expect(formatRange({ startRow: 1, endRow: 249, startCol: 1, endCol: 5 })).toBe("B2:F250");
  });

  it("clamps out-of-bounds boxes into the grid", () => {
    const box = clampBox(parseRange("A1:ZZ99999")!, { rows: 100, cols: 20 });
    expect(box.endRow).toBe(99);
    expect(box.endCol).toBe(19);
    expect(boxCellCount(box)).toBe(2000);
  });
});

describe("shiftRangeRef", () => {
  it("shifts a plain range by (dRow, dCol)", () => {
    expect(shiftRangeRef("B2:D5", 3, 1)).toBe("C5:E8");
  });

  it("collapses to a single cell when the box is 1x1", () => {
    expect(shiftRangeRef("C4", 3, 0)).toBe("C7");
  });

  it("does not preserve $ anchors — same convention as formatRange/formatCell", () => {
    expect(shiftRangeRef("$C$4", 1, 1)).toBe("D5");
  });

  it("is a no-op (modulo $ stripping) for a zero shift", () => {
    expect(shiftRangeRef("C4", 0, 0)).toBe("C4");
    expect(shiftRangeRef("B2:D5", 0, 0)).toBe("B2:D5");
  });

  it("shifts only the specified axis of an open whole-column/whole-row form", () => {
    expect(shiftRangeRef("D:D", 5, 1)).toBe("E:E"); // a row delta has nothing to move
    expect(shiftRangeRef("3:3", 1, 5)).toBe("4"); // a col delta has nothing to move
  });

  it("returns null when the shift pushes a row or column negative", () => {
    expect(shiftRangeRef("A1", -1, 0)).toBeNull();
    expect(shiftRangeRef("A1", 0, -1)).toBeNull();
    expect(shiftRangeRef("A1:B2", -5, 0)).toBeNull();
  });

  it("returns null when the shift pushes past the grid's outer bound", () => {
    expect(shiftRangeRef("A1", 6000, 0)).toBeNull(); // past MAX_ROWS (5000)
    expect(shiftRangeRef("A1", 0, 200)).toBeNull(); // past MAX_COLS (100)
  });

  it("returns null for unparseable input", () => {
    expect(shiftRangeRef("not a range", 1, 1)).toBeNull();
    expect(shiftRangeRef("", 1, 1)).toBeNull();
  });
});
