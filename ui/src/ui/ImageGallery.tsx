import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAuiState } from "@assistant-ui/react";
import { GALLERY_GAP, GALLERY_TILE_MIN, galleryPlan, replyImages, type ViewerImage } from "../images";
import { useImageViewer } from "./ImageViewer";

/** The width an element is given, kept current. 0 until laid out. */
function useInlineSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Molecule: thumbnails that open the shared viewer. `images` are drawn;
 * `browse` is the set the viewer moves through (default: `images`), so a
 * subset can open inside its reply's full set.
 */
export function ImageGallery({ images, browse = images, label }: {
  images: readonly ViewerImage[]; browse?: readonly ViewerImage[]; label: string;
}) {
  const open = useImageViewer();
  const [ref, width] = useInlineSize<HTMLElement>();
  const plan = galleryPlan(width, images.length);
  const show = (image: ViewerImage) => open(browse, Math.max(0, browse.findIndex((item) => item.id === image.id)));
  if (images.length === 0) return null;
  if (plan.kind === "single") {
    const image = images[0]!;
    return <section ref={ref} className="image-gallery" aria-label={label}>
      <button type="button" className="gallery-single" aria-label={`Open ${image.alt}`} title={image.alt} onClick={() => show(image)}>
        <img src={image.src} alt={image.alt} />
      </button>
    </section>;
  }
  const visible = images.slice(0, plan.visible);
  const next = images[plan.visible];
  const style = { "--gallery-columns": plan.columns, "--gallery-tile": `${GALLERY_TILE_MIN}px`, "--gallery-gap": `${GALLERY_GAP}px` } as CSSProperties;
  return <section ref={ref} className="image-gallery" aria-label={label}>
    <div className="gallery-grid" style={style}>
      {visible.map((image) => <button key={image.id} type="button" className="gallery-tile" aria-label={`Open ${image.alt}`}
        title={image.alt} onClick={() => show(image)}><img src={image.src} alt={image.alt} /></button>)}
      {next && <button type="button" className="gallery-tile gallery-more" aria-label={`Show ${plan.overflow} more images`}
        onClick={() => show(next)}>
        <img src={next.src} alt="" />
        <span aria-hidden>+{plan.overflow}</span>
      </button>}
    </div>
  </section>;
}

/** Every image a reply's parts carry. Recomputed only when the parts change. */
export function useReplyImages(): ViewerImage[] {
  const parts = useAuiState((s) => s.message.parts);
  return useMemo(() => replyImages(parts), [parts]);
}

/** Organism: the images one reply produced, gathered after its text. */
export function ReplyGallery() {
  const images = useReplyImages();
  const label = `${images.length} ${images.length === 1 ? "image" : "images"} from this reply`;
  // Mount only with images, so the gallery measures the element it draws.
  return images.length > 0 ? <ImageGallery images={images} label={label} /> : null;
}
