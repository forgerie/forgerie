import { describe, expect, it } from "vitest";
import { ChatScrollCoordinator, type ChatScrollFrameScheduler, type ChatScrollViewport } from "./chatScrollCoordinator";

class ManualFrameScheduler implements ChatScrollFrameScheduler {
  private nextId = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();

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
    for (const [id, callback] of [...this.callbacks]) {
      this.callbacks.delete(id);
      callback(0);
    }
  }
}

const viewport = (scrollTop = 800): ChatScrollViewport => ({
  scrollTop,
  scrollHeight: 1_200,
  clientHeight: 400,
});

describe("ChatScrollCoordinator", () => {
  it("follows the tail until the reader scrolls away", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());

    expect(coordinator.followsTail).toBe(true);

    coordinator.recordScroll(viewport(500));

    expect(coordinator.followsTail).toBe(false);
  });

  it("resumes tail following when the reader returns to the bottom", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());
    coordinator.recordScroll(viewport(500));

    coordinator.recordScroll(viewport(800));

    expect(coordinator.followsTail).toBe(true);
  });

  it("blocks tail placement until reader input has settled", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const chat = viewport();
    let placements = 0;
    coordinator.scheduleTailPlacement(() => { placements += 1; });

    coordinator.readerIntent(chat);

    expect(coordinator.followsTail).toBe(false);
    coordinator.scheduleTailPlacement(() => { placements += 1; });
    frames.releaseAll();

    expect(placements).toBe(0);
    expect(coordinator.followsTail).toBe(true);
  });

  it("leaves tail ownership with the reader when input moves them away", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const chat = viewport();

    coordinator.readerIntent(chat);
    chat.scrollTop = 500;
    frames.releaseAll();

    expect(coordinator.followsTail).toBe(false);
  });

  it("holds the current position for an explicit reader action", () => {
    const coordinator = new ChatScrollCoordinator(new ManualFrameScheduler());

    coordinator.holdPosition();

    expect(coordinator.followsTail).toBe(false);
  });

  it("does not schedule placement while the reader owns the position", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    coordinator.recordScroll(viewport(500));
    let placements = 0;

    coordinator.scheduleTailPlacement(() => { placements += 1; });
    frames.releaseAll();

    expect(placements).toBe(0);
  });

  it("lets the latest tail placement replace an older one", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    const placements: string[] = [];

    coordinator.scheduleTailPlacement(() => { placements.push("old"); });
    coordinator.scheduleTailPlacement(() => { placements.push("new"); });
    frames.releaseAll();

    expect(placements).toEqual(["new"]);
  });

  it("reset restores tail ownership and cancels pending placement", () => {
    const frames = new ManualFrameScheduler();
    const coordinator = new ChatScrollCoordinator(frames);
    coordinator.recordScroll(viewport(500));
    let placements = 0;
    coordinator.scheduleTailPlacement(() => { placements += 1; });

    coordinator.reset();
    frames.releaseAll();

    expect(coordinator.followsTail).toBe(true);
    expect(placements).toBe(0);
  });
});
