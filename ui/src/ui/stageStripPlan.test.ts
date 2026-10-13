import { describe, expect, it } from "vitest";
import type { StageStripSegment, StageStripState } from "./StageStrip";
import { columnsWidth, STRIP_FOLD_WIDTH, STRIP_GAP, STRIP_GRID_SHARE, STRIP_MARK, STRIP_ROWS_MAX, stripGrid, worstState } from "./stageStripPlan";

const stage = (key: string, ...lanes: StageStripState[]): StageStripSegment => ({ key, lanes });
const stages = (count: number, ...lanes: StageStripState[]) => Array.from({ length: count }, (_, index) => stage(`s${String(index)}`, ...lanes));
/** The narrowest inner width whose share holds `width` px of grid. */
const widthFor = (width: number) => Math.ceil(width / STRIP_GRID_SHARE);

describe("stripGrid", () => {
  it("draws nothing without stages", () => {
    expect(stripGrid([], 0)).toEqual({ rows: 0, fold: 0, foldTone: undefined, columns: [] });
    expect(stripGrid([], 600)).toEqual({ rows: 0, fold: 0, foldTone: undefined, columns: [] });
  });

  it("shows every stage while the width is unknown", () => {
    expect(stripGrid(stages(40, "done"), 0)).toMatchObject({ fold: 0, foldTone: undefined });
    expect(stripGrid(stages(40, "done"), 0).columns).toHaveLength(40);
  });

  it("folds only when the columns do not fit the grid's share, one px either side", () => {
    const fits = widthFor(columnsWidth(10));
    expect(stripGrid(stages(10, "done"), fits)).toMatchObject({ fold: 0 });
    expect(stripGrid(stages(10, "done"), fits - 1).fold).toBeGreaterThan(0);
  });

  it("keeps the count and the shown columns inside the share once it folds, one px either side", () => {
    // Seven columns after the count: STRIP_FOLD_WIDTH, then a gap and a mark per column.
    const seven = widthFor(STRIP_FOLD_WIDTH + 7 * (STRIP_MARK + STRIP_GAP));
    expect(stripGrid(stages(20, "done"), seven)).toMatchObject({ fold: 13 });
    expect(stripGrid(stages(20, "done"), seven - 1)).toMatchObject({ fold: 14 });
  });

  it("folds the leading stages and keeps the latest", () => {
    const run = [stage("a", "done"), stage("b", "done"), ...stages(18, "next"), stage("last", "working")];
    const grid = stripGrid(run, 100);
    expect(grid.columns.at(-1)).toEqual(["working"]);
    expect(grid.columns).toHaveLength(run.length - grid.fold);
  });

  it("folds every stage into the count when not one column fits beside it, one px either side", () => {
    // The count, then one gap and one mark: 30 px of grid, so a 75 px inner width.
    const one = widthFor(STRIP_FOLD_WIDTH + STRIP_GAP + STRIP_MARK);
    expect(one).toBe(75);
    expect(stripGrid(stages(5, "done"), one)).toMatchObject({ fold: 4 });
    expect(stripGrid(stages(5, "done"), one).columns).toHaveLength(1);
    expect(stripGrid(stages(5, "done"), one - 1)).toMatchObject({ rows: 1, fold: 5, columns: [] });
  });

  it("gives a count that stands alone the worst state of every stage", () => {
    const run = [stage("a", "done"), stage("b", "failed", "done"), stage("c", "working"), stage("d", "next")];
    expect(stripGrid(run, 50)).toMatchObject({ fold: 4, foldTone: "failed", columns: [] });
    expect(stripGrid([stage("a", "done"), stage("b", "waiting")], 1)).toMatchObject({ fold: 2, foldTone: "waiting", columns: [] });
  });

  it("never draws columns past the share once the count fits in it", () => {
    for (let width = STRIP_FOLD_WIDTH / STRIP_GRID_SHARE; width <= 400; width += 1) {
      const grid = stripGrid(stages(30, "done"), width);
      const drawn = (grid.fold > 0 ? STRIP_FOLD_WIDTH : -STRIP_GAP) + grid.columns.length * (STRIP_MARK + STRIP_GAP);
      expect(drawn, `at ${String(width)}`).toBeLessThanOrEqual(width * STRIP_GRID_SHARE);
    }
  });

  it("is as many rows as the most lanes, up to three", () => {
    expect(stripGrid([stage("a", "done")], 600).rows).toBe(1);
    expect(stripGrid([stage("a", "done"), stage("b", "done", "done")], 600).rows).toBe(2);
    expect(stripGrid([stage("a", "done", "done", "done")], 600).rows).toBe(STRIP_ROWS_MAX);
    expect(stripGrid([stage("a", "done", "done", "done", "done", "done")], 600).rows).toBe(STRIP_ROWS_MAX);
  });

  it("stacks lanes from the floor and fills the rest with empty cells", () => {
    expect(stripGrid([stage("a", "done"), stage("b", "working", "next", "done")], 600).columns)
      .toEqual([["done", "empty", "empty"], ["working", "next", "done"]]);
  });

  it("shows the first rows−1 lanes of a crowded stage and tops it with the worst lane it hides", () => {
    const grid = stripGrid([stage("a", "done", "done", "done", "working", "failed", "done")], 600);
    expect(grid.columns).toEqual([["done", "done", "failed"]]);
    expect(stripGrid([stage("a", "failed", "done", "done", "next")], 600).columns).toEqual([["failed", "done", "next"]]);
  });

  it("gives the count the worst state it hides", () => {
    const hidden = (lanes: StageStripState[]) => stripGrid([stage("a", ...lanes), ...stages(30, "done")], 100);
    expect(hidden(["done", "failed"])).toMatchObject({ foldTone: "failed" });
    expect(hidden(["working", "waiting"])).toMatchObject({ foldTone: "waiting" });
    expect(hidden(["next", "working"])).toMatchObject({ foldTone: "working" });
    expect(hidden(["done", "next"])).toMatchObject({ foldTone: "next" });
    expect(hidden(["done"])).toMatchObject({ foldTone: "done" });
  });
});

describe("worstState", () => {
  it("ranks failed over waiting over working over next over done", () => {
    expect(worstState(["done", "next", "working", "waiting", "failed"])).toBe("failed");
    expect(worstState(["done", "next", "working", "waiting"])).toBe("waiting");
    expect(worstState(["done", "next", "working"])).toBe("working");
    expect(worstState(["done", "next"])).toBe("next");
    expect(worstState(["done"])).toBe("done");
    expect(worstState([])).toBe("done");
  });
});
