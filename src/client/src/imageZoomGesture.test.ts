import { describe, expect, it } from "vitest";
import { ImageZoomGesture, type ImageZoomFrame } from "./imageZoomGesture";

const frame: ImageZoomFrame = {
  stageWidth: 200,
  stageHeight: 100,
  imageWidth: 200,
  imageHeight: 100,
};

describe("ImageZoomGesture", () => {
  it("zooms around a two-pointer pinch without moving the viewport", () => {
    const gesture = new ImageZoomGesture();
    gesture.pointerDown(1, { x: 50, y: 50 }, frame);
    gesture.pointerDown(2, { x: 150, y: 50 }, frame);

    gesture.pointerMove(1, { x: 0, y: 50 }, frame);
    const transform = gesture.pointerMove(2, { x: 200, y: 50 }, frame);

    expect(transform).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it("keeps an off-centre focal point under the same finger while zooming", () => {
    const gesture = new ImageZoomGesture();

    expect(gesture.zoomBy(2, { x: 150, y: 50 }, frame)).toEqual({ scale: 2, x: -50, y: 0 });
  });

  it("pans a zoomed image and clamps it inside the stage", () => {
    const gesture = new ImageZoomGesture();
    gesture.zoomBy(2, { x: 100, y: 50 }, frame);
    gesture.pointerDown(1, { x: 100, y: 50 }, frame);

    const transform = gesture.pointerMove(1, { x: 400, y: 50 }, frame);

    expect(transform).toEqual({ scale: 2, x: 100, y: 0 });
  });

  it("continues as a one-finger pan when one pinching pointer lifts", () => {
    const gesture = new ImageZoomGesture();
    gesture.pointerDown(1, { x: 50, y: 50 }, frame);
    gesture.pointerDown(2, { x: 150, y: 50 }, frame);
    gesture.pointerMove(1, { x: 0, y: 50 }, frame);
    gesture.pointerMove(2, { x: 200, y: 50 }, frame);

    gesture.pointerUp(2, frame);
    const transform = gesture.pointerMove(1, { x: 40, y: 50 }, frame);

    expect(transform).toEqual({ scale: 2, x: 40, y: 0 });
  });

  it("limits zoom and resets all gesture state", () => {
    const gesture = new ImageZoomGesture();

    expect(gesture.zoomBy(100, { x: 100, y: 50 }, frame).scale).toBe(6);
    gesture.pointerDown(1, { x: 20, y: 20 }, frame);
    expect(gesture.reset()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(gesture.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
