export interface ChatScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD = 48;
export const CHAT_SCROLL_BOTTOM_THRESHOLD = 2;

export function distanceFromScrollBottom(scroller: Pick<ChatScrollViewport, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}

export function isNearScrollBottom(
  scroller: Pick<ChatScrollViewport, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD,
): boolean {
  return distanceFromScrollBottom(scroller) < threshold;
}
