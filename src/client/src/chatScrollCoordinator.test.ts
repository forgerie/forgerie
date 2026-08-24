import { describe, expect, it } from "vitest";
import { ChatScrollCoordinator, type ChatScrollFrameScheduler } from "./chatScrollCoordinator";
import { followAnchor, followTurn, FOLLOW_FREE } from "./chatFollowMode";
import type { ChatScrollViewport } from "./chatScrollPosition";

class ManualFrameScheduler implements ChatScrollFrameScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  request(callback: FrameRequestCallback): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.callbacks.delete(id);
  }

  releaseAll(): void {
    while (this.callbacks.size > 0) {
      const next = this.callbacks.entries().next();
      if (next.done === true) return;
      const [id, callback] = next.value;
      this.callbacks.delete(id);
      callback(0);
    }
  }
}

const viewport = (scrollTop = 400): ChatScrollViewport => ({
  scrollTop,
  scrollHeight: 1_200,
  clientHeight: 400,
});

describe("ChatScrollCoordinator", () => {
  it("lets the latest automatic placement replace older movement", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const placements: string[] = [];
    let settlementApplications = 0;
    coordinator.settle({ frames: 3, immediate: true, apply: () => { settlementApplications += 1; } });

    coordinator.schedulePlacement(() => { placements.push("old"); });
    coordinator.schedulePlacement(() => { placements.push("latest"); });
    frames.releaseAll();

    expect(settlementApplications).toBe(1);
    expect(placements).toEqual(["latest"]);

    placements.length = 0;
    coordinator.schedulePlacement(() => { placements.push("superseded"); });
    coordinator.settle({ frames: 1, immediate: true, apply: () => { settlementApplications += 1; } });
    frames.releaseAll();

    expect(settlementApplications).toBe(2);
    expect(placements).toEqual([]);
  });

  it("lets a loading-time gesture claim control before scrolling is possible", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    let placements = 0;
    coordinator.schedulePlacement(() => { placements += 1; });

    expect(coordinator.readerWheel(-0.6, false, true)).toBeUndefined();
    const gesture = coordinator.readerWheel(-0.6, false, true);
    frames.releaseAll();

    expect(gesture).toEqual({ direction: "older", readerOwned: true });
    expect(placements).toBe(0);
    expect(coordinator.mode).toEqual(FOLLOW_FREE);
  });

  it("ignores touch jitter before accepting a loading-time takeover", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    coordinator.readerTouchStart(100);

    expect(coordinator.readerTouchMove(96, false, true)).toBeUndefined();
    expect(coordinator.mode).not.toEqual(FOLLOW_FREE);
    expect(coordinator.readerTouchMove(94, false, true)).toEqual({ direction: "newer", readerOwned: true });
    expect(coordinator.mode).toEqual(FOLLOW_FREE);
  });

  it("reports older intent when the transcript cannot scroll yet", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());

    expect(coordinator.readerWheel(-1, false)).toEqual({ direction: "older", readerOwned: false });
    expect(coordinator.mode).toEqual({ kind: "tail" });

    coordinator.readerTouchStart(100);
    expect(coordinator.readerTouchMove(106, false)).toEqual({ direction: "older", readerOwned: false });
    expect(coordinator.mode).toEqual({ kind: "tail" });
  });

  it("reports touch reversal from the latest meaningful position", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    coordinator.readerTouchStart(100);

    expect(coordinator.readerTouchMove(106, true)).toEqual({ direction: "older", readerOwned: true });
    expect(coordinator.readerTouchMove(100, true)).toEqual({ direction: "newer", readerOwned: true });
  });

  it("releases a restored passage for wheel movement toward newer content", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    coordinator.follow(followAnchor({ kind: "anchor", anchorId: "message:4:0", offset: 20 }));

    expect(coordinator.readerWheel(120, true)).toEqual({ direction: "newer", readerOwned: true });
    expect(coordinator.mode).toEqual(FOLLOW_FREE);
  });

  it("releases a restored passage for touch movement toward newer content", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    coordinator.follow(followAnchor({ kind: "anchor", anchorId: "message:4:0", offset: 20 }));
    coordinator.readerTouchStart(100);

    expect(coordinator.readerTouchMove(90, true)).toEqual({ direction: "newer", readerOwned: true });
    expect(coordinator.mode).toEqual(FOLLOW_FREE);
  });

  it("cancels queued movement as soon as the reader pulls back", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const chat = viewport();
    let placements = 0;
    coordinator.follow(followTurn("turn:m:4"));
    coordinator.schedulePlacement(() => { placements += 1; });
    coordinator.withProgrammaticScroll(chat, () => { chat.scrollTop = 500; });

    coordinator.readerWheel(-120, true);
    frames.releaseAll();

    expect(placements).toBe(0);
    expect(coordinator.mode).toEqual(FOLLOW_FREE);
  });

  it("does not treat an unlatched layout scroll as reader intent", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const chat = viewport(20);
    let placements = 0;
    coordinator.schedulePlacement(() => { placements += 1; });

    expect(coordinator.recordScroll(chat, false).driver).toBe("none");
    frames.releaseAll();

    expect(placements).toBe(1);
    expect(coordinator.mode).toEqual({ kind: "tail" });
  });

  it("keeps tail ownership when content grows after a component placement", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    const chat = viewport(800);
    coordinator.withProgrammaticScroll(chat, () => { chat.scrollTop = 800; });

    chat.scrollHeight = 2_000;

    expect(coordinator.recordScroll(chat, false).driver).toBe("component");
    expect(coordinator.mode).toEqual({ kind: "tail" });
  });

  it("returns reader-owned scrolling to the tail at the bottom", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    const chat = viewport(800);
    coordinator.follow(FOLLOW_FREE);

    expect(coordinator.recordScroll(chat, false).driver).toBe("none");
    expect(coordinator.mode).toEqual({ kind: "tail" });
  });

  it("contains repeated layout settlement and releases its suppression", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    let applications = 0;

    coordinator.settle({
      frames: 3,
      immediate: true,
      suppressLoadMore: true,
      apply: () => { applications += 1; },
    });
    expect(coordinator.canLoadMore).toBe(false);

    frames.releaseAll();

    expect(applications).toBe(3);
    expect(coordinator.canLoadMore).toBe(true);
  });
});
