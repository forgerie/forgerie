/**
 * Measures where each inbox row draws its columns.
 *
 * The board is one table: the location chip, the live-work counts, the mark
 * and the timestamp each occupy a column shared by every row, whatever that
 * row's own content is. Returns edges only, so the check reads the drawn
 * result rather than the stylesheet that produced it.
 *
 * Also reports what the title's floor is measured against: the pane's width
 * and the width of one character in the title's font.
 */
export const INBOX_COLUMNS_PROBE = `
  JSON.stringify((() => {
    const panel = document.querySelector("session-inbox-panel");
    if (panel === null || panel.shadowRoot === null) return { error: "no inbox panel" };
    const rows = [...panel.shadowRoot.querySelectorAll(".row")];
    if (rows.length === 0) return { error: "no rows" };

    const edges = (row, selector) => {
      const element = row.querySelector(selector);
      if (element === null) return undefined;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return undefined;
      return { left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10 };
    };

    const titleFont = getComputedStyle(rows[0].querySelector(".row-title")).font;
    const context = document.createElement("canvas").getContext("2d");
    context.font = titleFont;

    return {
      paneWidth: panel.getBoundingClientRect().width,
      titleChPx: context.measureText("0").width,
      rows: rows.map((row) => ({
        id: row.getAttribute("data-session"),
        shape: row.getAttribute("data-shape"),
        title: edges(row, ".row-title"),
        location: edges(row, ".row-meta"),
        work: edges(row, "[data-live-work]"),
        mark: edges(row, ".row-mark"),
        action: edges(row, ".row-actions"),
        time: edges(row, ".row-time"),
      })),
    };
  })())
`;
