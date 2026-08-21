export interface ImageZoomPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageZoomFrame {
  readonly stageWidth: number;
  readonly stageHeight: number;
  /** Untransformed rendered image width. */
  readonly imageWidth: number;
  /** Untransformed rendered image height. */
  readonly imageHeight: number;
}

export interface ImageZoomTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

interface PanStart {
  readonly pointer: ImageZoomPoint;
  readonly transform: ImageZoomTransform;
}

interface PinchStart {
  readonly distance: number;
  readonly contentPoint: ImageZoomPoint;
  readonly scale: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;

function identityTransform(): ImageZoomTransform {
  return { scale: MIN_SCALE, x: 0, y: 0 };
}

/**
 * Image-only pan and zoom state.
 *
 * The browser never receives the gesture as page zoom because the owning image
 * stage declares `touch-action: none`. This class then maps pointer positions
 * to one transform that the view applies to the image element only.
 */
export class ImageZoomGesture {
  private readonly pointers = new Map<number, ImageZoomPoint>();
  private transformValue: ImageZoomTransform = identityTransform();
  private panStart: PanStart | undefined;
  private pinchStart: PinchStart | undefined;

  get transform(): ImageZoomTransform {
    return this.transformValue;
  }

  reset(): ImageZoomTransform {
    this.pointers.clear();
    this.panStart = undefined;
    this.pinchStart = undefined;
    this.transformValue = identityTransform();
    return this.transformValue;
  }

  pointerDown(pointerId: number, point: ImageZoomPoint, frame: ImageZoomFrame): void {
    this.pointers.set(pointerId, point);
    this.restartPointerGesture(frame);
  }

  pointerMove(pointerId: number, point: ImageZoomPoint, frame: ImageZoomFrame): ImageZoomTransform {
    if (!this.pointers.has(pointerId)) return this.transformValue;
    this.pointers.set(pointerId, point);

    if (this.pointers.size >= 2 && this.pinchStart !== undefined) {
      const pair = this.pointerPair();
      if (pair === undefined) return this.transformValue;
      const midpoint = pointMidpoint(pair[0], pair[1]);
      const distance = pointDistance(pair[0], pair[1]);
      const scale = clampScale(this.pinchStart.scale * distance / this.pinchStart.distance);
      const centre = { x: frame.stageWidth / 2, y: frame.stageHeight / 2 };
      return this.setTransform(clampTransform({
        scale,
        x: midpoint.x - centre.x - this.pinchStart.contentPoint.x * scale,
        y: midpoint.y - centre.y - this.pinchStart.contentPoint.y * scale,
      }, frame));
    }

    const pointer = this.singlePointer();
    if (pointer === undefined || this.panStart === undefined || this.transformValue.scale <= MIN_SCALE) return this.transformValue;
    return this.setTransform(clampTransform({
      scale: this.panStart.transform.scale,
      x: this.panStart.transform.x + pointer.x - this.panStart.pointer.x,
      y: this.panStart.transform.y + pointer.y - this.panStart.pointer.y,
    }, frame));
  }

  pointerUp(pointerId: number, frame: ImageZoomFrame): void {
    this.pointers.delete(pointerId);
    this.restartPointerGesture(frame);
  }

  zoomBy(factor: number, focalPoint: ImageZoomPoint, frame: ImageZoomFrame): ImageZoomTransform {
    const previous = this.transformValue;
    const scale = clampScale(previous.scale * factor);
    if (scale === MIN_SCALE) return this.setTransform(identityTransform());
    const centre = { x: frame.stageWidth / 2, y: frame.stageHeight / 2 };
    const contentPoint = {
      x: (focalPoint.x - centre.x - previous.x) / previous.scale,
      y: (focalPoint.y - centre.y - previous.y) / previous.scale,
    };
    return this.setTransform(clampTransform({
      scale,
      x: focalPoint.x - centre.x - contentPoint.x * scale,
      y: focalPoint.y - centre.y - contentPoint.y * scale,
    }, frame));
  }

  toggle(focalPoint: ImageZoomPoint, frame: ImageZoomFrame): ImageZoomTransform {
    if (this.transformValue.scale > MIN_SCALE) return this.setTransform(identityTransform());
    return this.zoomBy(2, focalPoint, frame);
  }

  private restartPointerGesture(frame: ImageZoomFrame): void {
    const pair = this.pointerPair();
    if (pair !== undefined) {
      const midpoint = pointMidpoint(pair[0], pair[1]);
      const centre = { x: frame.stageWidth / 2, y: frame.stageHeight / 2 };
      this.pinchStart = {
        distance: Math.max(1, pointDistance(pair[0], pair[1])),
        contentPoint: {
          x: (midpoint.x - centre.x - this.transformValue.x) / this.transformValue.scale,
          y: (midpoint.y - centre.y - this.transformValue.y) / this.transformValue.scale,
        },
        scale: this.transformValue.scale,
      };
      this.panStart = undefined;
      return;
    }

    this.pinchStart = undefined;
    const pointer = this.singlePointer();
    this.panStart = pointer === undefined ? undefined : { pointer, transform: this.transformValue };
  }

  private pointerPair(): readonly [ImageZoomPoint, ImageZoomPoint] | undefined {
    if (this.pointers.size < 2) return undefined;
    const points = [...this.pointers.values()];
    const first = points[0];
    const second = points[1];
    return first === undefined || second === undefined ? undefined : [first, second];
  }

  private singlePointer(): ImageZoomPoint | undefined {
    if (this.pointers.size !== 1) return undefined;
    const pointer = this.pointers.values().next();
    return pointer.done === true ? undefined : pointer.value;
  }

  private setTransform(transform: ImageZoomTransform): ImageZoomTransform {
    this.transformValue = transform;
    return transform;
  }
}

function pointDistance(left: ImageZoomPoint, right: ImageZoomPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pointMidpoint(left: ImageZoomPoint, right: ImageZoomPoint): ImageZoomPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampTransform(transform: ImageZoomTransform, frame: ImageZoomFrame): ImageZoomTransform {
  if (transform.scale <= MIN_SCALE) return identityTransform();
  const maxX = Math.max(0, (frame.imageWidth * transform.scale - frame.stageWidth) / 2);
  const maxY = Math.max(0, (frame.imageHeight * transform.scale - frame.stageHeight) / 2);
  return {
    scale: transform.scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y)),
  };
}
