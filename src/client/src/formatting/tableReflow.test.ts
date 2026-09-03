// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { toSafeMarkdownHtml } from "./markdown";
import { fitTablesToColumn, TABLE_STACKED_CLASS, tableLayoutFor } from "./tableReflow";

describe("tableLayoutFor", () => {
  it("keeps a table that fits its column as a table", () => {
    expect(tableLayoutFor(320, 576)).toBe("columns");
  });

  it("stacks a table wider than its column", () => {
    expect(tableLayoutFor(900, 411)).toBe("stacked");
  });

  it("treats a table that misses its column by a sub-pixel as fitting", () => {
    expect(tableLayoutFor(576.4, 576)).toBe("columns");
  });

  it("stacks at exactly the same width in every column, so no device is a special case", () => {
    expect(tableLayoutFor(700, 699)).toBe("columns");
    expect(tableLayoutFor(700, 698)).toBe("stacked");
  });

  it("keeps columns while a width is still unmeasured, so nothing stacks on the way in", () => {
    expect(tableLayoutFor(0, 576)).toBe("columns");
    expect(tableLayoutFor(900, 0)).toBe("columns");
    expect(tableLayoutFor(Number.NaN, 576)).toBe("columns");
  });
});

describe("fitTablesToColumn", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("stacks a table the column cannot hold and drops its scroll tab stop", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, tableWidth: 900 });

    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(true);
    expect(wrapper?.hasAttribute("tabindex")).toBe(false);
  });

  it("leaves a table that fits as a table, still reachable as a scroll region", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 608, tableWidth: 600 });

    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(false);
    expect(wrapper?.getAttribute("tabindex")).toBe("0");
  });

  it("returns a table to columns once the space grows enough to hold it", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, tableWidth: 900 });
    fitTablesToColumn(column);

    setAvailableWidth(column, 1000);
    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(false);
  });
});

const TABLE_MARKDOWN = "| Option | Cost |\n| --- | --- |\n| Reflow | Tall |";

interface ColumnSizes {
  /** What the wrapper is allowed: the reading column plus the bleed beside it. */
  readonly availableWidth: number;
  readonly tableWidth: number;
}

// happy-dom does no layout, so the two widths the decision reads are declared
// here instead of measured. The behaviour under test is the decision and what it
// does to the DOM, not the geometry the browser would supply.
function renderedColumn(markdown: string, sizes: ColumnSizes): HTMLElement {
  const column = document.createElement("div");
  column.className = "formatted";
  column.innerHTML = toSafeMarkdownHtml(markdown);
  document.body.append(column);
  setAvailableWidth(column, sizes.availableWidth);
  const table = column.querySelector("table");
  if (table === null) throw new Error("markdown did not render a table");
  Object.defineProperty(table, "scrollWidth", { configurable: true, value: sizes.tableWidth });
  return column;
}

function setAvailableWidth(column: HTMLElement, clientWidth: number): void {
  const wrapper = column.querySelector(".table-scroll");
  if (wrapper === null) throw new Error("markdown did not render a table wrapper");
  Object.defineProperty(wrapper, "clientWidth", { configurable: true, value: clientWidth });
}
