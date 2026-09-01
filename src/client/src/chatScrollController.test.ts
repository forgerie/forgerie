import { describe, expect, it } from "vitest";
import { ChatScrollController, type ChatScrollFrameScheduler, type ChatScrollViewport } from "./chatScrollController";

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

  releaseNext(): void {
    const next = this.callbacks.entries().next();
    if (next.done === true) return;
    const [id, callback] = next.value;
    this.callbacks.delete(id);
    callback(0);
  }

  releaseAll(): void {
    while (this.callbacks.size > 0) this.releaseNext();
  }
}

function viewport(): ChatScrollViewport {
  let scrollTop = 0;
  const geometry: ChatScrollViewport = {
    get scrollTop() { return scrollTop; },
    set scrollTop(value: number) { scrollTop = Math.max(0, Math.min(value, geometry.scrollHeight - geometry.clientHeight)); },
    scrollHeight: 1_200,
    clientHeight: 400,
  };
  return geometry;
}

describe("ChatScrollController", () => {
  it("owns the tail until an opening has settled", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    controller.readerWheel(-120);
    chat.scrollTop = 500;
    frames.releaseAll();

    expect(chat.scrollTop).toBe(800);
    expect(controller.mode).toBe("tail");

    controller.readerWheel(-120);
    expect(controller.mode).toBe("reader");
  });

  it("re-pins after viewport and transcript geometry changes", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    frames.releaseAll();

    chat.clientHeight = 200;
    controller.contentChanged();
    expect(chat.scrollTop).toBe(1_000);

    chat.scrollHeight = 1_600;
    controller.contentChanged();
    expect(chat.scrollTop).toBe(1_400);
  });

  it("does not mistake browser or programmatic scroll events for reader intent", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    frames.releaseAll();
    chat.scrollTop = 500;

    controller.recordScroll();
    controller.contentChanged();
    frames.releaseAll();

    expect(controller.mode).toBe("tail");
    expect(chat.scrollTop).toBe(800);
  });

  it("lets explicit upward input take control only after opening", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.readerKey("PageUp", false);
    expect(controller.mode).toBe("opening-tail");

    controller.completeOpening();
    frames.releaseAll();
    controller.readerKey("PageDown", false);
    expect(controller.mode).toBe("tail");
    controller.readerKey(" ", true);
    expect(controller.mode).toBe("reader");
  });

  it("uses upward touch movement and scrollbar presses as reader intent", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    frames.releaseAll();

    controller.readerTouchStart(100);
    controller.readerTouchMove(96);
    expect(controller.mode).toBe("tail");
    controller.readerTouchMove(110);
    expect(controller.mode).toBe("reader");

    chat.scrollTop = 800;
    controller.recordScroll();
    expect(controller.mode).toBe("tail");
    controller.readerPointerStart();
    expect(controller.mode).toBe("reader");
  });

  it("keeps opening ownership through a scrollbar drag", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    controller.readerPointerStart();
    chat.scrollTop = 500;
    frames.releaseNext();

    expect(controller.mode).toBe("opening-tail");
    expect(chat.scrollTop).toBe(800);

    chat.scrollTop = 500;
    controller.readerPointerEnd();
    frames.releaseAll();
    expect(controller.mode).toBe("tail");
    expect(chat.scrollTop).toBe(800);
  });

  it("clears an active gesture when the viewport reconnects", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.completeOpening();
    controller.readerPointerStart();
    controller.dispose();
    chat.scrollTop = 500;
    controller.connect(chat);
    frames.releaseAll();

    expect(controller.mode).toBe("tail");
    expect(chat.scrollTop).toBe(800);
  });

  it("holds the reading position until explicit earlier-history loading finishes", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.beginOpening();
    controller.holdPosition();
    chat.scrollHeight = 1_600;
    controller.contentChanged();
    frames.releaseAll();

    expect(controller.mode).toBe("history");
    expect(chat.scrollTop).toBe(800);

    controller.completeHistoryHold();
    expect(controller.mode).toBe("reader");
  });

  it("returns to tail mode when loaded history still fits", () => {
    const frames = new ManualFrameScheduler();
    const chat = viewport();
    chat.scrollHeight = 300;
    const controller = new ChatScrollController({ frames });

    controller.connect(chat);
    controller.holdPosition();
    chat.scrollHeight = 350;
    controller.contentChanged();
    controller.completeHistoryHold();
    frames.releaseAll();

    expect(controller.mode).toBe("tail");
    chat.scrollHeight = 800;
    controller.contentChanged();
    expect(chat.scrollTop).toBe(400);
  });
});
