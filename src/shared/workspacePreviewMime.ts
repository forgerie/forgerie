/** File types the sandboxed workspace preview routes can serve. Shared with link renderers so other files open in the text reader. */
export const IMAGE_PREVIEW_MIME_TYPES: Readonly<Record<string, string | undefined>> = {
  ".avif": "image/avif", ".bmp": "image/bmp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
};
export const DOCUMENT_PREVIEW_MIME_TYPES: Readonly<Record<string, string | undefined>> = {
  ...IMAGE_PREVIEW_MIME_TYPES,
  ".css": "text/css", ".htm": "text/html", ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".mjs": "text/javascript", ".otf": "font/otf", ".ttf": "font/ttf",
  ".woff": "font/woff", ".woff2": "font/woff2",
};
