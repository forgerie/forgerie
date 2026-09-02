/**
 * Measures where each inbox row draws its columns.
 *
 * The board is one table: the location chip, the live-work counts, the mark
 * and the timestamp each occupy a column shared by every row, whatever that
 * row's own content is. Returns edges only, so the check reads the drawn
 * result rather than the stylesheet that produced it.
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

    return {
      rows: rows.map((row) => ({
        id: row.getAttribute("data-session"),
        shape: row.getAttribute("data-shape"),
        title: edges(row, ".row-title"),
        location: edges(row, ".row-meta"),
        work: edges(row, "[data-live-work]"),
        mark: edges(row, ".row-mark"),
        time: edges(row, ".row-time"),
      })),
    };
  })())
`;
