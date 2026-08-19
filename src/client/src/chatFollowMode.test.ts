import { describe, expect, it } from "vitest";
import {
  anchoredScrollPosition,
  anchoredTurnKey,
  followAnchor,
  followModeAfterReaderPullback,
  followModeAfterScroll,
  followModeAfterTurnOpened,
  followTurn,
  FOLLOW_FREE,
  FOLLOW_TAIL,
  type ChatScrollSnapshot,
} from "./chatFollowMode";

const scroll = (overrides: Partial<ChatScrollSnapshot> = {}): ChatScrollSnapshot => ({
  atBottom: false,
  nearBottom: false,
  scrollingUp: false,
  ...overrides,
});

describe("followModeAfterScroll", () => {
  it("follows the tail once the reader reaches the bottom", () => {
    expect(followModeAfterScroll(FOLLOW_FREE, scroll({ atBottom: true, nearBottom: true }), "reader")).toEqual(FOLLOW_TAIL);
  });

  it("releases the tail when the reader scrolls up", () => {
    expect(followModeAfterScroll(FOLLOW_TAIL, scroll({ scrollingUp: true }), "reader")).toEqual(FOLLOW_FREE);
  });

  it("keeps following the tail from just above the bottom", () => {
    expect(followModeAfterScroll(FOLLOW_TAIL, scroll({ nearBottom: true }), "reader")).toEqual(FOLLOW_TAIL);
  });

  it("keeps an anchored target when the transcript moves itself", () => {
    const turn = followTurn("turn:m:12");
    const passage = followAnchor({ mode: "anchor", anchorId: "m:8", offset: 24 }, "free");

    expect(followModeAfterScroll(turn, scroll({ atBottom: true, nearBottom: true }), "component")).toEqual(turn);
    expect(followModeAfterScroll(passage, scroll({ atBottom: true, nearBottom: true }), "component")).toEqual(passage);
  });

  it("hands an anchored turn back to the tail when the reader scrolls to the bottom", () => {
    expect(followModeAfterScroll(followTurn("turn:m:12"), scroll({ atBottom: true, nearBottom: true }), "reader")).toEqual(FOLLOW_TAIL);
  });

  it("releases an anchored turn when the reader scrolls up", () => {
    expect(followModeAfterScroll(followTurn("turn:m:12"), scroll({ scrollingUp: true }), "reader")).toEqual(FOLLOW_FREE);
  });
});

describe("followModeAfterReaderPullback", () => {
  it("releases the current mode when there is room to scroll up", () => {
    expect(followModeAfterReaderPullback(followTurn("turn:m:4"), true)).toEqual(FOLLOW_FREE);
    expect(followModeAfterReaderPullback(FOLLOW_TAIL, true)).toEqual(FOLLOW_FREE);
  });

  it("keeps the mode when the transcript is already at its top", () => {
    expect(followModeAfterReaderPullback(FOLLOW_TAIL, false)).toEqual(FOLLOW_TAIL);
  });
});

describe("followModeAfterTurnOpened", () => {
  it("anchors a turn that opens while the transcript follows the tail", () => {
    expect(followModeAfterTurnOpened(FOLLOW_TAIL, "turn:m:8", false)).toEqual(followTurn("turn:m:8"));
  });

  it("moves the anchor to the newer turn", () => {
    expect(followModeAfterTurnOpened(followTurn("turn:m:4"), "turn:m:8", false)).toEqual(followTurn("turn:m:8"));
  });

  it("leaves a reader who scrolled away where they are", () => {
    const passage = followAnchor({ mode: "anchor", anchorId: "m:3", offset: 20 }, "free");

    expect(followModeAfterTurnOpened(FOLLOW_FREE, "turn:m:8", false)).toEqual(FOLLOW_FREE);
    expect(followModeAfterTurnOpened(passage, "turn:m:8", false)).toEqual(passage);
  });

  it("anchors a live-tail passage or a turn sent from a free passage", () => {
    const position = { mode: "anchor" as const, anchorId: "m:3", offset: 20 };

    expect(followModeAfterTurnOpened(followAnchor(position, "tail"), "turn:m:8", false)).toEqual(followTurn("turn:m:8"));
    expect(followModeAfterTurnOpened(followAnchor(position, "free"), "turn:m:8", true)).toEqual(followTurn("turn:m:8"));
  });
});

describe("anchored targets", () => {
  it("selects only the target carried by the current mode", () => {
    const position = { mode: "anchor" as const, anchorId: "m:8", offset: 24 };

    expect(anchoredTurnKey(followTurn("turn:m:8"))).toBe("turn:m:8");
    expect(anchoredScrollPosition(followAnchor(position, "free"))).toEqual(position);
    expect(anchoredTurnKey(FOLLOW_TAIL)).toBeUndefined();
    expect(anchoredScrollPosition(FOLLOW_FREE)).toBeUndefined();
  });
});
