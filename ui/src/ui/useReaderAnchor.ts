import { useLayoutEffect, type RefObject } from "react";

type Bookmark = { node: HTMLElement; offset: number; scrollTop: number };

/**
 * Keeps a scrolled-up reader's message still as media above it settles.
 * Chromium misses native anchoring inside our size query container. Do not
 * replace assistant-ui's tail, running-turn, or prepend scroll controllers:
 * yield whenever they (or the reader, or native anchoring) have scrolled.
 */
export function useReaderAnchor(column: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const content = column.current;
    const viewport = content?.parentElement;
    if (!content || !viewport) return;
    let bookmark: Bookmark | undefined;
    const offset = (node: HTMLElement) => node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const capture = () => {
      bookmark = undefined;
      if (viewport.clientHeight === 0 || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1) return;
      const { top, bottom } = viewport.getBoundingClientRect();
      for (const node of content.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom <= top) continue;
        if (rect.top >= bottom) break;
        bookmark = { node, offset: rect.top - top, scrollTop: viewport.scrollTop };
        break;
      }
    };
    const onScroll = () => {
      // Our own correction emits a scroll event too. Keep the original offset
      // through it, so fractional rounding cannot accumulate over many draws.
      if (bookmark?.scrollTop !== viewport.scrollTop) capture();
    };
    const observer = new ResizeObserver(() => {
      if (viewport.clientHeight === 0) return;
      if (!bookmark || !content.contains(bookmark.node) || bookmark.scrollTop !== viewport.scrollTop) {
        capture();
        return;
      }
      const delta = offset(bookmark.node) - bookmark.offset;
      if (Math.abs(delta) > 0.5) viewport.scrollTo({ top: viewport.scrollTop + delta, behavior: "instant" });
      bookmark.scrollTop = viewport.scrollTop;
    });
    capture();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(content);
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [column]);
}
