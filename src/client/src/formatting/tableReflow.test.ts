// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { toSafeMarkdownHtml } from "./markdown";
import { COLUMN_WRAP_TARGET_PX, FIELD_MIN_FLOOR_PX, FIELD_MIN_PROPERTY, fitTablesToColumn, recordFieldMinInlineSize, TABLE_MEASURING_CLASS, TABLE_STACKED_CLASS, tableLayoutFor } from "./tableReflow";

describe("tableLayoutFor", () => {
  it("keeps a table whose columns fit at their natural width", () => {
    expect(tableLayoutFor([120, 160], 576)).toBe("columns");
  });

  it("keeps a table of sentences that fits once its columns are allowed to wrap", () => {
    // Two columns of prose, each wanting 330px unwrapped: 660px of table in a
    // 608px column. Wrapped to the target they need 448px and stay a table.
    expect(tableLayoutFor([330, 330], 608)).toBe("columns");
  });

  it("stacks only when the columns cannot fit even wrapped", () => {
    expect(tableLayoutFor([330, 330], 411)).toBe("stacked");
  });

  it("charges a narrow column what it asks for, not the wrap target", () => {
    // Six short columns: 480px of content is 480px of table, however much a
    // prose column would have been allowed to wrap down to.
    expect(tableLayoutFor([80, 80, 80, 80, 80, 80], 520)).toBe("columns");
    expect(tableLayoutFor([80, 80, 80, 80, 80, 80], 470)).toBe("stacked");
  });

  it("stacks six columns of prose, which no reading column can hold", () => {
    expect(tableLayoutFor([330, 330, 330, 330, 330, 330], 932)).toBe("stacked");
  });

  it("decides at exactly the same width in every column, so no device is a special case", () => {
    const wrapped = COLUMN_WRAP_TARGET_PX * 2;
    expect(tableLayoutFor([330, 330], wrapped - 1)).toBe("columns");
    expect(tableLayoutFor([330, 330], wrapped - 2)).toBe("stacked");
  });

  it("keeps columns while a width is still unmeasured, so nothing stacks on the way in", () => {
    expect(tableLayoutFor([330, 330], 0)).toBe("columns");
    expect(tableLayoutFor([330, 330], Number.NaN)).toBe("columns");
    expect(tableLayoutFor([], 576)).toBe("columns");
    expect(tableLayoutFor([0, 0], 576)).toBe("columns");
  });
});

describe("recordFieldMinInlineSize", () => {
  it("lets short values stand side by side", () => {
    expect(recordFieldMinInlineSize([80, 60, 90, 110, 70, 100])).toBe(FIELD_MIN_FLOOR_PX);
  });

  it("gives a column of prose the whole wrap target, so two sentences never share a row", () => {
    expect(recordFieldMinInlineSize([330, 330])).toBe(COLUMN_WRAP_TARGET_PX);
  });

  it("reads the widest value, because one long field sets the row", () => {
    expect(recordFieldMinInlineSize([80, 60, 300, 70])).toBe(COLUMN_WRAP_TARGET_PX);
    expect(recordFieldMinInlineSize([80, 60, 180, 70])).toBe(180);
  });

  it("ignores the first column, which is the record's title and not a field", () => {
    expect(recordFieldMinInlineSize([330, 60, 80])).toBe(FIELD_MIN_FLOOR_PX);
  });

  it("falls back to the floor when a table has no value column to measure", () => {
    expect(recordFieldMinInlineSize([330])).toBe(FIELD_MIN_FLOOR_PX);
    expect(recordFieldMinInlineSize([])).toBe(FIELD_MIN_FLOOR_PX);
  });
});

describe("fitTablesToColumn", () => {
  afterEach(() => { document.body.replaceChildren(); });

  it("stacks a table the column cannot hold and drops its scroll tab stop", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });

    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(true);
    expect(wrapper?.hasAttribute("tabindex")).toBe(false);
  });

  it("leaves a table that fits wrapped as a table, still reachable as a scroll region", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 608, columnWidths: [330, 330] });

    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(false);
    expect(wrapper?.getAttribute("tabindex")).toBe("0");
  });

  it("returns a table to columns once the space grows enough to hold it", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });
    fitTablesToColumn(column);

    setAvailableWidth(column, 1000);
    fitTablesToColumn(column);

    const wrapper = column.querySelector(".table-scroll");
    expect(wrapper?.classList.contains(TABLE_STACKED_CLASS)).toBe(false);
  });

  it("tells the record grid how wide its fields asked to be", () => {
    const prose = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });
    const short = renderedColumn(TABLE_MARKDOWN, { availableWidth: 120, columnWidths: [90, 80] });

    fitTablesToColumn(prose);
    fitTablesToColumn(short);

    expect(wrapperOf(prose).style.getPropertyValue(FIELD_MIN_PROPERTY)).toBe(`${String(COLUMN_WRAP_TARGET_PX)}px`);
    expect(wrapperOf(short).style.getPropertyValue(FIELD_MIN_PROPERTY)).toBe(`${String(FIELD_MIN_FLOOR_PX)}px`);
  });

  it("takes the field width back off a table that returns to columns", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });
    fitTablesToColumn(column);

    setAvailableWidth(column, 1000);
    fitTablesToColumn(column);

    expect(wrapperOf(column).style.getPropertyValue(FIELD_MIN_PROPERTY)).toBe("");
  });

  it("leaves no measuring state behind, so a reader never sees the measurement", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });

    fitTablesToColumn(column);

    expect(column.querySelector(".table-scroll")?.classList.contains(TABLE_MEASURING_CLASS)).toBe(false);
  });

  it("measures the columns a heading row names", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [330, 330] });
    const headings = [...column.querySelectorAll("thead th")];

    fitTablesToColumn(column);

    // The decision has to read the heading row, because that is the row whose
    // cells resolve to the column widths under a max-content layout.
    expect(headings.length).toBe(2);
    expect(column.querySelector(".table-scroll")?.classList.contains(TABLE_STACKED_CLASS)).toBe(true);
  });

  it("falls back to the first body row when a table has no heading row", () => {
    const column = renderedColumn(TABLE_MARKDOWN, { availableWidth: 300, columnWidths: [0, 0] });
    column.querySelector("thead")?.remove();
    column.querySelectorAll("tbody tr:first-child > *").forEach((cell) => {
      cell.getBoundingClientRect = () => new DOMRect(0, 0, 330, 0);
    });

    fitTablesToColumn(column);

    expect(column.querySelector(".table-scroll")?.classList.contains(TABLE_STACKED_CLASS)).toBe(true);
  });
});

const TABLE_MARKDOWN = "| Option | Cost |\n| --- | --- |\n| Reflow | Tall |";

interface ColumnSizes {
  /** What the wrapper is allowed: the reading column plus the bleed beside it. */
  readonly availableWidth: number;
  /** What each column asks for unwrapped. */
  readonly columnWidths: readonly number[];
}

// happy-dom does no layout, so the widths the decision reads are declared here
// instead of measured. The behaviour under test is the decision and what it does
// to the DOM, not the geometry the browser would supply.
function renderedColumn(markdown: string, sizes: ColumnSizes): HTMLElement {
  const column = document.createElement("div");
  column.className = "formatted";
  column.innerHTML = toSafeMarkdownHtml(markdown);
  document.body.append(column);
  setAvailableWidth(column, sizes.availableWidth);
  const table = column.querySelector("table");
  if (table === null) throw new Error("markdown did not render a table");
  const measured = table.querySelectorAll("thead th").length > 0 ? table.querySelectorAll("thead th") : table.querySelectorAll("tbody tr:first-child > *");
  measured.forEach((cell, index) => {
    const width = sizes.columnWidths[index] ?? 0;
    cell.getBoundingClientRect = () => new DOMRect(0, 0, width, 0);
  });
  return column;
}

function wrapperOf(column: HTMLElement): HTMLElement {
  const wrapper = column.querySelector<HTMLElement>(".table-scroll");
  if (wrapper === null) throw new Error("markdown did not render a table wrapper");
  return wrapper;
}

function setAvailableWidth(column: HTMLElement, clientWidth: number): void {
  const wrapper = column.querySelector(".table-scroll");
  if (wrapper === null) throw new Error("markdown did not render a table wrapper");
  Object.defineProperty(wrapper, "clientWidth", { configurable: true, value: clientWidth });
}
