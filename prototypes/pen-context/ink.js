/**
 * PROTOTYPE — the shared ink layer.
 *
 * One canvas floats over a host element. Strokes are stored in host
 * coordinates, so ink stays glued to the content when the page scrolls.
 *
 * Two scroll strategies are on offer, because the first one has a real defect:
 *
 * - "hover" (the original bet): the canvas is inert until a pen hovers, then it
 *   takes pointer events and blocks panning. Defect found on the tablet: when
 *   the pen touches down without a hover event first, the browser has already
 *   decided that gesture is a scroll. The stroke is lost, and only the next
 *   stroke draws. That is the "works after the first release" bug.
 *
 * - "always" (now the default): the ink layer listens on the host at all times
 *   and the host never pans by itself (`touch-action: none`). A finger scrolls
 *   through code here instead of through the browser, so a pen stroke can never
 *   be swallowed by a scroll gesture. The cost is momentum quality — this is a
 *   hand-written flick, not the platform's.
 */

import { classify } from "./geometry.js";

const ERASER_BUTTONS = 32;
const BARREL_BUTTONS = 2;
const FRICTION = 0.94;

export class InkLayer {
  /**
   * @param {HTMLElement} host element the ink sits on top of
   * @param {{ scroller?: HTMLElement, onStroke?: (stroke: object) => void, onStrokeStart?: (event: PointerEvent) => void, onHoverMove?: (event: PointerEvent) => void, onArmChange?: (armed: boolean) => void, onErase?: () => void, color?: string }} options
   */
  constructor(host, options = {}) {
    this.host = host;
    this.options = options;
    this.scroller = options.scroller ?? host.closest(".scroller") ?? undefined;
    this.strokes = [];
    this.active = undefined;
    this.armed = false;
    this.disarmTimer = 0;
    this.touchDraws = false;
    this.scrollMode = "always";
    this.pan = undefined;
    this.momentum = 0;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "ink-canvas";
    host.appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");

    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);

    host.addEventListener("pointerdown", (event) => this.down(event));
    host.addEventListener("pointermove", (event) => this.move(event));
    host.addEventListener("pointerup", (event) => this.up(event));
    host.addEventListener("pointercancel", (event) => this.up(event));
    host.addEventListener("pointerleave", (event) => this.up(event));

    this.applyScrollMode();
  }

  setTouchDraws(value) {
    this.touchDraws = value;
  }

  /** "always" keeps ink live and scrolls by hand; "hover" restores the arming experiment. */
  setScrollMode(mode) {
    this.scrollMode = mode;
    this.applyScrollMode();
  }

  applyScrollMode() {
    const always = this.scrollMode === "always";
    this.host.classList.toggle("ink-live", always);
    if (always) this.setArmed(true);
    else this.setArmed(false);
  }

  setArmed(value) {
    if (this.armed === value) return;
    this.armed = value;
    this.host.classList.toggle("ink-armed", value);
    this.options.onArmChange?.(value);
  }

  scheduleDisarm(delay) {
    if (this.scrollMode === "always") return;
    window.clearTimeout(this.disarmTimer);
    this.disarmTimer = window.setTimeout(() => {
      if (this.active === undefined) this.setArmed(false);
    }, delay);
  }

  draws(event) {
    if (event.pointerType === "pen") return true;
    if (event.pointerType === "mouse") return event.buttons !== 0;
    return this.touchDraws;
  }

  down(event) {
    if (this.scrollMode === "hover" && event.pointerType === "pen") {
      this.setArmed(true);
      this.scheduleDisarm(2400);
    }

    if (!this.draws(event)) {
      if (this.scrollMode === "always" && event.pointerType === "touch") this.beginPan(event);
      return;
    }
    if (this.scrollMode === "hover" && !this.armed) return;

    if (event.pointerType === "pen" && (event.buttons & ERASER_BUTTONS) !== 0) {
      this.erasing = true;
      this.eraseAt(this.toLocal(event));
      this.host.setPointerCapture(event.pointerId);
      return;
    }

    this.momentum = 0;
    this.erasing = false;
    this.host.setPointerCapture(event.pointerId);
    this.active = {
      points: [this.toLocal(event)],
      pointerType: event.pointerType,
      barrel: (event.buttons & BARREL_BUTTONS) !== 0,
      maxPressure: event.pressure,
      tilt: { x: event.tiltX, y: event.tiltY },
    };
    this.options.onStrokeStart?.(event);
    event.preventDefault();
  }

  move(event) {
    if (event.pointerType === "pen" && event.pressure === 0 && event.buttons === 0) {
      this.options.onHoverMove?.(event);
      if (this.scrollMode === "hover") {
        this.setArmed(true);
        this.scheduleDisarm(2400);
      }
      return;
    }
    if (this.pan !== undefined && event.pointerId === this.pan.id) {
      this.extendPan(event);
      return;
    }
    if (this.erasing === true) {
      this.eraseAt(this.toLocal(event));
      return;
    }
    if (this.active === undefined) return;

    const batch = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    for (const sample of batch.length > 0 ? batch : [event]) {
      const point = this.toLocal(sample);
      this.active.points.push(point);
      if (point.p > this.active.maxPressure) this.active.maxPressure = point.p;
    }
    this.redraw();
    event.preventDefault();
  }

  up(event) {
    if (this.pan !== undefined && event.pointerId === this.pan.id) {
      this.endPan();
      return;
    }
    if (this.erasing === true) {
      this.erasing = false;
      return;
    }
    if (this.active === undefined) return;
    const stroke = this.active;
    this.active = undefined;
    const gesture = classify(stroke.points);
    const record = { ...stroke, ...gesture, id: `stroke-${String(Date.now())}-${String(this.strokes.length)}` };
    if (gesture.kind !== "tap") this.strokes.push(record);
    this.redraw();
    this.options.onStroke?.(record);
    this.scheduleDisarm(2400);
  }

  /* --- hand-rolled finger scrolling (only in "always" mode) --------------- */

  beginPan(event) {
    if (this.scroller === undefined) return;
    this.momentum = 0;
    this.pan = { id: event.pointerId, y: event.clientY, top: this.scroller.scrollTop, at: event.timeStamp, velocity: 0 };
  }

  extendPan(event) {
    const pan = this.pan;
    if (pan === undefined || this.scroller === undefined) return;
    const delta = event.clientY - pan.y;
    this.scroller.scrollTop = pan.top - delta;
    const gap = Math.max(event.timeStamp - pan.at, 1);
    pan.velocity = (event.clientY - (pan.lastY ?? pan.y)) / gap;
    pan.lastY = event.clientY;
    pan.at = event.timeStamp;
  }

  endPan() {
    const pan = this.pan;
    this.pan = undefined;
    if (pan === undefined || this.scroller === undefined) return;
    this.momentum = -(pan.velocity ?? 0) * 16;
    const step = () => {
      if (Math.abs(this.momentum) < 0.4 || this.pan !== undefined) return;
      this.scroller.scrollTop += this.momentum;
      this.momentum *= FRICTION;
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  /* --- canvas ------------------------------------------------------------ */

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = this.host.clientWidth;
    const height = Math.max(this.host.scrollHeight, this.host.clientHeight);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${String(width)}px`;
    this.canvas.style.height = `${String(height)}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.redraw();
  }

  toLocal(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, p: event.pressure, t: event.timeStamp };
  }

  eraseAt(point) {
    const before = this.strokes.length;
    this.strokes = this.strokes.filter((stroke) => !stroke.points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 18));
    if (this.strokes.length !== before) {
      this.redraw();
      this.options.onErase?.();
    }
  }

  removeStroke(id) {
    this.strokes = this.strokes.filter((stroke) => stroke.id !== id);
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.redraw();
  }

  rectFor(element) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - canvasRect.left,
      top: rect.top - canvasRect.top,
      right: rect.right - canvasRect.left,
      bottom: rect.bottom - canvasRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  redraw() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const all = this.active === undefined ? this.strokes : [...this.strokes, this.active];
    for (const stroke of all) this.paint(stroke);
  }

  paint(stroke) {
    const context = this.context;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = stroke.barrel === true ? "#ff4f7b" : (this.options.color ?? "#b7a2ff");
    context.globalAlpha = 0.92;
    for (let index = 1; index < stroke.points.length; index += 1) {
      const previous = stroke.points[index - 1];
      const point = stroke.points[index];
      const pressure = point.p > 0 ? point.p : 0.5;
      context.lineWidth = 1.2 + pressure * 4.4;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  toDataUrl() {
    return this.canvas.toDataURL("image/png");
  }
}
