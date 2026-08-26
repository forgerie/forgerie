import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { ImageZoomGesture, type ImageZoomFrame, type ImageZoomPoint, type ImageZoomTransform } from "../imageZoomGesture";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";

export interface ImageLightboxItem {
  readonly src: string;
  readonly alt: string;
}

interface ImageLightboxState {
  readonly images: readonly ImageLightboxItem[];
  readonly index: number;
}

/**
 * Shared full-screen image viewer.
 *
 * The viewer owns native modality, image-set navigation, and image-only pan and
 * zoom. Its stage claims multi-pointer gestures with touch-action none, so a
 * pinch transforms the image without changing the application's viewport zoom.
 */
@customElement("image-lightbox")
export class ImageLightbox extends LitElement {
  @query("dialog") private dialog?: HTMLDialogElement;
  @query(".stage") private stage?: HTMLElement;
  @query("img") private image?: HTMLImageElement;

  @state() private lightboxState: ImageLightboxState | undefined;
  @state() private transform: ImageZoomTransform = { scale: 1, x: 0, y: 0 };

  private modalRegistration: RenderedModalRegistration | undefined;
  private readonly gesture = new ImageZoomGesture();

  public open(images: readonly ImageLightboxItem[], index = 0): void {
    if (images.length === 0 || images[index] === undefined) return;
    this.resetZoom();
    this.lightboxState = { images, index };
  }

  public close(): void {
    if (this.lightboxState === undefined) return;
    this.lightboxState = undefined;
    this.resetZoom();
  }

  override disconnectedCallback(): void {
    this.releaseModal();
    super.disconnectedCallback();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("lightboxState")) this.syncDialog();
  }

  override render() {
    const state = this.lightboxState;
    const image = state?.images[state.index];
    const count = state?.images.length ?? 0;
    return html`
      <dialog
        aria-label="Image viewer"
        @click=${(event: MouseEvent) => { if (event.target === this.dialog) this.close(); }}
        @keydown=${(event: KeyboardEvent) => { this.onKeydown(event); }}
        @close=${() => { this.close(); }}
        @cancel=${() => { this.close(); }}
      >
        ${state === undefined || image === undefined ? null : html`
          <div class="toolbar">
            <span class="counter">${String(state.index + 1)} / ${String(count)}</span>
            <div class="controls" aria-label="Image zoom controls">
              <button type="button" aria-label="Zoom out" title="Zoom out" @click=${() => { this.adjustZoom(0.8); }}>−</button>
              <button type="button" class="reset" aria-label="Reset image zoom" title="Reset image zoom" ?disabled=${this.transform.scale === 1} @click=${() => { this.resetZoom(); }}>${String(Math.round(this.transform.scale * 100))}%</button>
              <button type="button" aria-label="Zoom in" title="Zoom in" @click=${() => { this.adjustZoom(1.25); }}>+</button>
              <button type="button" class="close" aria-label="Close image" title="Close image" @click=${() => { this.close(); }}>×</button>
            </div>
          </div>
          <button type="button" class="nav previous" aria-label="Previous image" ?disabled=${state.index === 0} @click=${() => { this.showImage(state.index - 1); }}>‹</button>
          <div
            class="stage"
            @pointerdown=${(event: PointerEvent) => { this.onPointerDown(event); }}
            @pointermove=${(event: PointerEvent) => { this.onPointerMove(event); }}
            @pointerup=${(event: PointerEvent) => { this.onPointerEnd(event); }}
            @pointercancel=${(event: PointerEvent) => { this.onPointerEnd(event); }}
            @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && this.transform.scale === 1) this.close(); }}
            @wheel=${(event: WheelEvent) => { this.onWheel(event); }}
            @dblclick=${(event: MouseEvent) => { this.onDoubleClick(event); }}
          >
            <img
              src=${image.src}
              alt=${image.alt}
              draggable="false"
              style=${this.transformStyle()}
              @dragstart=${(event: DragEvent) => { event.preventDefault(); }}
            />
          </div>
          <button type="button" class="nav next" aria-label="Next image" ?disabled=${state.index === count - 1} @click=${() => { this.showImage(state.index + 1); }}>›</button>
          <span class="hint">Pinch or use + / − to zoom</span>
        `}
      </dialog>
    `;
  }

  private syncDialog(): void {
    const dialog = this.dialog;
    if (dialog === undefined) return;
    if (this.lightboxState !== undefined) {
      if (this.modalRegistration !== undefined) return;
      const registration = registerRenderedModal({
        element: dialog,
        nativeTopLayer: true,
        focus: () => {
          const close = this.renderRoot.querySelector<HTMLElement>(".close");
          (close ?? dialog).focus();
        },
      });
      this.modalRegistration = registration;
      try {
        if (!dialog.open) dialog.showModal();
      } catch (error) {
        this.modalRegistration = undefined;
        registration.unregister();
        throw error;
      }
      registration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseModal();
  }

  private releaseModal(): void {
    const registration = this.modalRegistration;
    this.modalRegistration = undefined;
    registration?.unregister();
  }

  private showImage(index: number): void {
    const state = this.lightboxState;
    if (state?.images[index] === undefined || index === state.index) return;
    this.resetZoom();
    this.lightboxState = { images: state.images, index };
  }

  private onKeydown(event: KeyboardEvent): void {
    const state = this.lightboxState;
    if (state === undefined) return;
    if (event.key === "ArrowLeft") this.showImage(state.index - 1);
    else if (event.key === "ArrowRight") this.showImage(state.index + 1);
    else if (event.key === "+" || event.key === "=") this.adjustZoom(1.25);
    else if (event.key === "-") this.adjustZoom(0.8);
    else if (event.key === "0") this.resetZoom();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  private onPointerDown(event: PointerEvent): void {
    const stage = event.currentTarget;
    if (!(stage instanceof HTMLElement)) return;
    const frame = this.currentFrame(stage);
    if (frame === undefined) return;
    event.preventDefault();
    this.gesture.pointerDown(event.pointerId, this.eventPoint(event, stage), frame);
    if (typeof stage.setPointerCapture === "function") stage.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const stage = event.currentTarget;
    if (!(stage instanceof HTMLElement)) return;
    const frame = this.currentFrame(stage);
    if (frame === undefined) return;
    event.preventDefault();
    this.transform = this.gesture.pointerMove(event.pointerId, this.eventPoint(event, stage), frame);
  }

  private onPointerEnd(event: PointerEvent): void {
    const stage = event.currentTarget;
    if (!(stage instanceof HTMLElement)) return;
    const frame = this.currentFrame(stage);
    if (frame === undefined) return;
    event.preventDefault();
    this.gesture.pointerUp(event.pointerId, frame);
    if (typeof stage.hasPointerCapture === "function" && stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }

  private onWheel(event: WheelEvent): void {
    const stage = event.currentTarget;
    if (!(stage instanceof HTMLElement)) return;
    const frame = this.currentFrame(stage);
    if (frame === undefined) return;
    event.preventDefault();
    this.transform = this.gesture.zoomBy(Math.exp(-event.deltaY * 0.002), this.eventPoint(event, stage), frame);
  }

  private onDoubleClick(event: MouseEvent): void {
    const stage = event.currentTarget;
    if (!(stage instanceof HTMLElement)) return;
    const frame = this.currentFrame(stage);
    if (frame === undefined) return;
    event.preventDefault();
    this.transform = this.gesture.toggle(this.eventPoint(event, stage), frame);
  }

  private adjustZoom(factor: number): void {
    const stage = this.stage;
    const frame = stage === undefined ? undefined : this.currentFrame(stage);
    if (frame === undefined) return;
    this.transform = this.gesture.zoomBy(factor, { x: frame.stageWidth / 2, y: frame.stageHeight / 2 }, frame);
  }

  private resetZoom(): void {
    this.transform = this.gesture.reset();
  }

  private currentFrame(stage: HTMLElement): ImageZoomFrame | undefined {
    const image = this.image;
    if (image === undefined) return undefined;
    return {
      stageWidth: stage.clientWidth,
      stageHeight: stage.clientHeight,
      imageWidth: image.offsetWidth,
      imageHeight: image.offsetHeight,
    };
  }

  private eventPoint(event: Pick<MouseEvent, "clientX" | "clientY">, stage: HTMLElement): ImageZoomPoint {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private transformStyle(): string {
    const { x, y, scale } = this.transform;
    return `transform: translate3d(${String(x)}px, ${String(y)}px, 0) scale(${String(scale)});`;
  }

  static override styles = css`
    :host { display: contents; }
    dialog { position: fixed; inset: 0; width: 100dvw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: var(--pi-bg); color: var(--pi-text); overflow: hidden; overscroll-behavior: none; }
    dialog[open] { display: grid; }
    dialog::backdrop { background: var(--pi-overlay); }
    /* This is the only no-touch-action region. Pointer gestures transform the
       image below, never the app root or the browser viewport. */
    .stage { grid-area: 1 / 1; box-sizing: border-box; min-width: 0; min-height: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: max(58px, calc(env(safe-area-inset-top) + 50px)) max(52px, calc(env(safe-area-inset-right) + 44px)) max(44px, calc(env(safe-area-inset-bottom) + 36px)) max(52px, calc(env(safe-area-inset-left) + 44px)); overflow: hidden; overscroll-behavior: contain; touch-action: none; -webkit-user-select: none; user-select: none; cursor: grab; }
    .stage:active { cursor: grabbing; }
    img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-control); object-fit: contain; transform-origin: center; will-change: transform; -webkit-user-drag: none; user-select: none; }
    .toolbar { position: absolute; z-index: 2; top: max(8px, env(safe-area-inset-top)); left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); display: flex; align-items: center; justify-content: space-between; gap: 12px; pointer-events: none; }
    .counter, .controls, .hint { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: color-mix(in srgb, var(--pi-bg-overlay) 88%, transparent); box-shadow: 0 8px 24px var(--pi-shadow-soft); }
    .counter { padding: 6px 9px; color: var(--pi-text-secondary); font-size: var(--pi-text-xs); }
    .controls { display: flex; align-items: center; overflow: hidden; pointer-events: auto; }
    .controls button, .nav { display: inline-grid; place-items: center; box-sizing: border-box; border: 0; background: transparent; color: var(--pi-text-secondary); cursor: pointer; }
    .controls button { min-width: 34px; height: 34px; padding: 0 8px; border-inline-start: 1px solid var(--pi-border-muted); font: 500 16px/1 system-ui, sans-serif; }
    .controls button:first-child { border-inline-start: 0; }
    .controls .reset { min-width: 54px; font-size: var(--pi-text-xs); }
    .controls button:hover, .controls button:focus-visible, .nav:hover, .nav:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text-bright); }
    .controls button:focus-visible, .nav:focus-visible { position: relative; z-index: 1; outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -2px; }
    .controls button:disabled, .nav:disabled { opacity: .35; cursor: default; }
    .nav { position: absolute; z-index: 2; top: 50%; width: 40px; height: 56px; margin-top: -28px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: color-mix(in srgb, var(--pi-bg-overlay) 88%, transparent); box-shadow: 0 8px 24px var(--pi-shadow-soft); font: 30px/1 system-ui, sans-serif; }
    .previous { left: max(8px, env(safe-area-inset-left)); }
    .next { right: max(8px, env(safe-area-inset-right)); }
    .hint { position: absolute; z-index: 2; left: 50%; bottom: max(8px, env(safe-area-inset-bottom)); padding: 5px 8px; color: var(--pi-muted); font-size: var(--pi-text-xs); transform: translateX(-50%); white-space: nowrap; pointer-events: none; }
    @media (prefers-reduced-motion: reduce) {
      img { will-change: auto; }
    }
  `;
}
