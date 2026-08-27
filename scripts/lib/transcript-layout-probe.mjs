/**
 * Measures the transcript's boxes inside the page.
 *
 * The numbers it returns are the ones a reader would describe: how far apart
 * consecutive rows sit, how tall the history control grew, whether the last
 * message reaches the bottom of the scroller, and whether the first message is
 * reachable from the scroll origin. Assertions live with the runner; this only
 * reports what the engine did.
 */
export const TRANSCRIPT_LAYOUT_PROBE = String.raw`
(() => {
  const view = document.querySelector("chat-view");
  const root = view && view.shadowRoot;
  const chat = root && root.querySelector(".chat");
  if (!chat) return JSON.stringify({ error: "no transcript scroller" });

  const chatBox = chat.getBoundingClientRect();
  const styles = getComputedStyle(chat);
  const padTop = parseFloat(styles.paddingTop) || 0;
  const padBottom = parseFloat(styles.paddingBottom) || 0;

  // ::before is the leading spacer and has no box of its own to report.
  const rows = Array.from(chat.children).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      className: typeof element.className === "string" ? element.className : "",
      top: box.top - chatBox.top + chat.scrollTop,
      bottom: box.bottom - chatBox.top + chat.scrollTop,
      height: box.height,
    };
  });

  // The distance between one row's ink and the next row's ink. Authored rhythm
  // shows up here as a handful of pixels; a stretched grid shows up as tens.
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    gaps.push({
      after: rows[index - 1].className,
      before: rows[index].className,
      px: rows[index].top - rows[index - 1].bottom,
    });
  }

  const loadButton = root.querySelector(".history-load-button");
  const emptyState = root.querySelector(".chat-empty-state");

  return JSON.stringify({
    scrollHeight: chat.scrollHeight,
    clientHeight: chat.clientHeight,
    padTop,
    padBottom,
    rows,
    gaps,
    firstRowTop: rows.length > 0 ? rows[0].top : undefined,
    lastRowBottom: rows.length > 0 ? rows[rows.length - 1].bottom : undefined,
    loadButtonHeight: loadButton ? loadButton.getBoundingClientRect().height : undefined,
    emptyStateCentreOffset: emptyState
      ? (() => {
          const box = emptyState.getBoundingClientRect();
          return (box.top + box.height / 2) - (chatBox.top + chatBox.height / 2);
        })()
      : undefined,
  });
})()
`;
