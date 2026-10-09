import { createContext, useContext } from "react";

/** The containing document's file URL base, supplied by its binding. Null means files are not available yet. */
export interface MarkdownLinkScope {
  base: string | null;
  error?: string | undefined;
  /** Return true when the containing document handles the file instead of browser navigation. */
  openFile?: ((path: string) => boolean) | undefined;
}
export const MarkdownLinkContext = createContext<MarkdownLinkScope | undefined>(undefined);
export const UNAVAILABLE_FILE_ORIGIN = "https://workspace.invalid/";
/** Decide whether a sanitized URL names a file in the containing document's folder. */
export function markdownFileLink(href: string | undefined, scope: MarkdownLinkScope | undefined, origin: string) {
  if (!href || href.startsWith("#") || scope === undefined) return undefined;
  const url = new URL(href, origin);
  if (url.origin === new URL(UNAVAILABLE_FILE_ORIGIN).origin) return { type: "unavailable" as const };
  if (scope.base === null) return undefined;
  if (!url.href.startsWith(scope.base)) return undefined;
  const encoded = url.pathname.slice(new URL(scope.base).pathname.length);
  let path: string;
  try { path = decodeURIComponent(encoded); } catch { return { type: "unavailable" as const }; }
  return { type: "file" as const, path };
}

export function useMarkdownLinkScope() {
  const scope = useContext(MarkdownLinkContext);
  return { scope, origin: scope === undefined ? window.location.href : scope.base ?? UNAVAILABLE_FILE_ORIGIN };
}
