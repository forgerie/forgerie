export const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PREVIEW_LABEL = "10 MB";

export const MAX_DOCUMENT_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_PREVIEW_LABEL = "10 MB";

/**
 * One sandbox policy for rendered workspace documents, shared by the server's
 * CSP `sandbox` directive and the client's iframe `sandbox` attribute so the
 * two can never drift. Scripts and form controls run, links may open real
 * browser tabs, but the document lives in an opaque origin: the app's
 * origin, storage, and API stay out of reach. Subresource egress is
 * deliberately open so pages can embed and hotlink.
 */
export const DOCUMENT_PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
