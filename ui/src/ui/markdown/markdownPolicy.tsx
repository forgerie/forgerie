// One rendering policy for every piece of reply Markdown: the main stream and
// the fragments inside rich blocks. A fragment that skipped it would reopen
// the remote images and unsafe links the stream already blocks.
import { defaultRehypePlugins, type StreamdownProps } from "streamdown";

export const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:"];

type Components = NonNullable<StreamdownProps["components"]>;

/** Drops the hast `node` Streamdown passes, so it never lands on a DOM element. */
export function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

/** Element overrides shared by the stream and its fragments. */
export const markdownElements: Components = {
  // Streamdown's default strong is a Tailwind-styled span. Keep semantic HTML.
  strong: "strong",
  // Keep text-only scope and do not load third-party images from a reply.
  img: ({ src, alt }) => <a href={typeof src === "string" ? src : undefined}>{alt || "Image"}</a>,
  table: (props) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
    <table {...withoutNode(props)} />
  </div>,
};

// Streamdown exports its plugin set, not the hardening function by name. Read
// it back so a fragment hardens links exactly like the stream does.
const sanitizeEntry = defaultRehypePlugins["sanitize"]!;
const hardenEntry = defaultRehypePlugins["harden"]!;
const harden = Array.isArray(hardenEntry) ? hardenEntry[0] : hardenEntry;

/** Rehype plugins for a fragment: sanitize, then harden links. */
export function fragmentRehypePlugins(defaultOrigin: string): NonNullable<StreamdownProps["rehypePlugins"]> {
  return [sanitizeEntry, [harden, {
    allowedImagePrefixes: ["*"], allowedLinkPrefixes: ["*"], allowedProtocols: ALLOWED_PROTOCOLS,
    allowDataImages: false, defaultOrigin,
  }]] as NonNullable<StreamdownProps["rehypePlugins"]>;
}
