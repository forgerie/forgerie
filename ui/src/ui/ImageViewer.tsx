import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { ImageZoomGesture, type ImageZoomFrame, type ImageZoomPoint, type ImageZoomTransform } from "../imageZoomGesture";
import { swipeStep, type ViewerImage } from "../images";

type OpenViewer = (images: readonly ViewerImage[], index: number) => void;
const ViewerContext = createContext<OpenViewer | undefined>(undefined);

/**
 * System organism: owns the one image viewer. Every image in the thread opens
 * through `useImageViewer`, so attachments, tool output, and reply galleries
 * share navigation, zoom, and focus return.
 */
export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<{ images: readonly ViewerImage[]; index: number }>();
  // The viewer can close by many paths, so the opener gets focus back here.
  const opener = useRef<HTMLElement>(undefined);
  const open = useCallback<OpenViewer>((images, index) => {
    if (!images[index]) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setView({ images, index });
  }, []);
  useEffect(() => {
    if (view || !opener.current) return;
    if (opener.current.isConnected) opener.current.focus();
    opener.current = undefined;
  }, [view]);
  return <ViewerContext.Provider value={open}>
    {children}
    {view && createPortal(<ImageViewer images={view.images} index={view.index}
      onIndex={(index) => setView({ ...view, index })} onClose={() => setView(undefined)} />, document.body)}
  </ViewerContext.Provider>;
}

export function useImageViewer(): OpenViewer {
  const open = useContext(ViewerContext);
  if (!open) throw new Error("useImageViewer must be used inside ImageViewerProvider");
  return open;
}

const ZOOM_STEP = 1.25;
const IDENTITY: ImageZoomTransform = { scale: 1, x: 0, y: 0 };

/**
 * Full-window viewer for one image set. The stage is the only region with
 * `touch-action: none`, so a pinch zooms the image and never the page.
 */
export function ImageViewer({ images, index, onIndex, onClose }: {
  images: readonly ViewerImage[]; index: number; onIndex: (index: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const gesture = useRef(new ImageZoomGesture());
  const swipe = useRef<{ start: ImageZoomPoint; swiped: boolean }>(undefined);
  const [transform, setTransform] = useState(IDENTITY);
  const image = images[index];
  const count = images.length;

  // Native modality gives the top layer, inert background, and Escape.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);
  useEffect(() => { setTransform(gesture.current.reset()); }, [index]);

  const frame = useCallback((): ImageZoomFrame | undefined => {
    const area = stage.current;
    const img = picture.current;
    if (!area || !img) return undefined;
    return { stageWidth: area.clientWidth, stageHeight: area.clientHeight, imageWidth: img.offsetWidth, imageHeight: img.offsetHeight };
  }, []);
  const zoomAt = useCallback((factor: number, point?: ImageZoomPoint) => {
    const current = frame();
    if (!current) return;
    setTransform(gesture.current.zoomBy(factor, point ?? { x: current.stageWidth / 2, y: current.stageHeight / 2 }, current));
  }, [frame]);

  // React registers wheel listeners as passive, so zoom needs its own listener.
  useEffect(() => {
    const area = stage.current;
    if (!area) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.002), pointIn(event, area));
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const step = (delta: number) => { if (images[index + delta]) onIndex(index + delta); };
  const close = () => dialog.current?.open ? dialog.current.close() : onClose();
  if (!image) return null;
  const zoomed = transform.scale > 1;
  return <dialog ref={dialog} className="image-viewer" aria-label="Image viewer" onClose={onClose}
    onKeyDown={(event) => {
      const action = ({
        ArrowLeft: () => step(-1), ArrowRight: () => step(1),
        "+": () => zoomAt(ZOOM_STEP), "=": () => zoomAt(ZOOM_STEP), "-": () => zoomAt(1 / ZOOM_STEP),
        "0": () => setTransform(gesture.current.reset()),
      } as Record<string, () => void>)[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }}>
    <div className="viewer-bar">
      <p className="viewer-count" aria-live="polite">{count > 1 ? `${index + 1} of ${count}` : ""}</p>
      <div className="viewer-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-button quiet-button" aria-label="Zoom out" title="Zoom out"
          disabled={!zoomed} onClick={() => zoomAt(1 / ZOOM_STEP)}><ZoomOutIcon aria-hidden size={18} /></button>
        <button type="button" className="viewer-scale" aria-label="Reset zoom" title="Reset zoom" disabled={!zoomed}
          onClick={() => setTransform(gesture.current.reset())}>{Math.round(transform.scale * 100)}%</button>
        <button type="button" className="icon-button quiet-button" aria-label="Zoom in" title="Zoom in"
          disabled={transform.scale >= 6} onClick={() => zoomAt(ZOOM_STEP)}><ZoomInIcon aria-hidden size={18} /></button>
      </div>
      <button type="button" className="icon-button quiet-button" autoFocus aria-label="Close image viewer" title="Close"
        onClick={close}><XIcon aria-hidden size={20} /></button>
    </div>
    <div ref={stage} className="viewer-stage" data-zoomed={zoomed || undefined}
      onPointerDown={(event) => {
        const current = frame();
        if (!current) return;
        gesture.current.pointerDown(event.pointerId, pointIn(event, event.currentTarget), current);
        swipe.current = !zoomed && event.isPrimary ? { start: { x: event.clientX, y: event.clientY }, swiped: false } : undefined;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = frame();
        if (current) setTransform(gesture.current.pointerMove(event.pointerId, pointIn(event, event.currentTarget), current));
      }}
      onPointerUp={(event) => {
        const current = frame();
        if (current) gesture.current.pointerUp(event.pointerId, current);
        const start = swipe.current?.start;
        const direction = start && !zoomed ? swipeStep(start, { x: event.clientX, y: event.clientY }) : 0;
        if (swipe.current) swipe.current.swiped = direction !== 0;
        if (direction !== 0) step(direction);
      }}
      onPointerCancel={(event) => {
        const current = frame();
        if (current) gesture.current.pointerUp(event.pointerId, current);
        swipe.current = undefined;
      }}
      onDoubleClick={(event) => {
        const current = frame();
        if (current) setTransform(gesture.current.toggle(pointIn(event, event.currentTarget), current));
      }}
      onClick={(event) => {
        // A tap on the empty stage closes; the end of a swipe does not.
        const swiped = swipe.current?.swiped === true;
        swipe.current = undefined;
        if (!swiped && !zoomed && event.target === event.currentTarget) close();
      }}>
      <img ref={picture} src={image.src} alt={image.alt} draggable={false}
        style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }} />
    </div>
    <div className="viewer-bar viewer-foot">
      {count > 1 && <button type="button" className="icon-button quiet-button" aria-label="Previous image" title="Previous image"
        disabled={index === 0} onClick={() => step(-1)}><ChevronLeftIcon aria-hidden size={22} /></button>}
      <p className="viewer-caption" title={image.alt}>{image.alt}</p>
      {count > 1 && <button type="button" className="icon-button quiet-button" aria-label="Next image" title="Next image"
        disabled={index === count - 1} onClick={() => step(1)}><ChevronRightIcon aria-hidden size={22} /></button>}
    </div>
  </dialog>;
}

function pointIn(event: { clientX: number; clientY: number }, element: Element): ImageZoomPoint {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
