/**
 * Measures the inbox floor: the panel, the board that yields space, and the
 * shelf that opens into it.
 *
 * Returns boxes only. The runner decides what a box is allowed to be, so a
 * rewrite of the stylesheet that keeps the reading behaviour keeps passing.
 */
export const INBOX_FLOOR_PROBE = `
  JSON.stringify((() => {
    const panel = document.querySelector("session-inbox-panel");
    if (panel === null || panel.shadowRoot === null) return { error: "no inbox panel" };
    const root = panel.shadowRoot;
    const board = root.querySelector(".board-scroll");
    const shelves = root.querySelector("[data-inbox-plugin-shelves]");
    const scroll = root.querySelector("[data-fixture-shelf-scroll]");
    if (board === null || shelves === null || scroll === null) return { error: "no board, shelves or shelf scroller" };

    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const floor = Number.parseFloat(getComputedStyle(panel).getPropertyValue("--inbox-board-floor"));

    return {
      floorPx: Number.isFinite(floor) ? floor : undefined,
      panel: box(panel),
      board: box(board),
      shelves: box(shelves),
      shelfScroll: {
        ...box(scroll),
        clientHeight: scroll.clientHeight,
        scrollHeight: scroll.scrollHeight,
        clientWidth: scroll.clientWidth,
        scrollWidth: scroll.scrollWidth,
      },
    };
  })())
`;
