import { describe, expect, it } from "vitest";
import {
  anchoredReadingPosition,
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

  it("keeps an anchored turn when the transcript moves itself", () => {
    const turn = followTurn("turn:m:12");
    expect(followModeAfterScroll(turn, scroll({ atBottom: true, nearBottom: true }), "component")).toEqual(turn);
  });

  it("keeps a saved passage when the transcript moves itself", () => {
    const passage = followAnchor({ kind: "anchor", anchorId: "m:4", offset: 24 });
    expect(followModeAfterScroll(passage, scroll({ atBottom: true, nearBottom: true }), "component")).toEqual(passage);
  });

  it("hands an anchored turn back to the tail when the reader reaches the bottom", () => {
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
    expect(followModeAfterTurnOpened(FOLLOW_FREE, "turn:m:8", false)).toEqual(FOLLOW_FREE);
  });

  it("leaves a restored passage in place when another device opens a turn", () => {
    const passage = followAnchor({ kind: "anchor", anchorId: "m:4", offset: 24 });
    expect(followModeAfterTurnOpened(passage, "turn:m:8", false)).toEqual(passage);
  });

  it("anchors a turn sent from a free passage", () => {
    expect(followModeAfterTurnOpened(FOLLOW_FREE, "turn:m:8", true)).toEqual(followTurn("turn:m:8"));
  });
});

describe("follow target selection", () => {
  it("returns only the matching target kind", () => {
    const passage = { kind: "anchor" as const, anchorId: "m:4", offset: 24 };
    expect(anchoredTurnKey(followTurn("turn:m:8"))).toBe("turn:m:8");
    expect(anchoredReadingPosition(followAnchor(passage))).toEqual(passage);
    expect(anchoredTurnKey(followAnchor(passage))).toBeUndefined();
    expect(anchoredReadingPosition(FOLLOW_TAIL)).toBeUndefined();
    expect(anchoredTurnKey(FOLLOW_FREE)).toBeUndefined();
  });
});
