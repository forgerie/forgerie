import { createContext, useContext } from "react";

/**
 * Where window-level surfaces (pickers, suggestion lists, the image viewer)
 * mount. The page uses the body. A native modal dialog makes everything
 * outside itself inert, so a dialog that holds a composer provides itself
 * here and its popovers stay usable.
 *
 * A provider must not have a transform, filter, or container query: those
 * would trap the fixed-position surfaces mounted inside it.
 */
const PortalLayer = createContext<HTMLElement | null>(null);
export const PortalLayerProvider = PortalLayer.Provider;

export function usePortalTarget(): HTMLElement {
  return useContext(PortalLayer) ?? document.body;
}
