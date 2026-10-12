import { useEffect, useState } from "react";

/** The rich view's Tiptap half, loaded on first use. */
export type MarkdownKit = typeof import("./markdownFile");

let kit: MarkdownKit | undefined;
let loading: Promise<MarkdownKit> | undefined;

/** Load the rich view's Tiptap half once; every later call gets the same module. */
export function loadMarkdownKit(): Promise<MarkdownKit> {
  loading ??= import("./markdownFile").then((module) => (kit = module));
  return loading;
}

/** The kit once it has loaded; until then undefined, and the caller shows that the file is still opening. */
export function useMarkdownKit(load = true): MarkdownKit | undefined {
  const [value, setValue] = useState(kit);
  useEffect(() => {
    if (value || !load) return;
    let alive = true;
    void loadMarkdownKit().then((module) => { if (alive) setValue(module); });
    return () => { alive = false; };
  }, [value, load]);
  return value ?? kit;
}

/**
 * Whether a path is Markdown. The same test as `isMarkdownPath` in the
 * Markdown module (markdownKit.test.ts holds them together), here so that
 * deciding whether a file has two views never loads Tiptap.
 */
export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path);

export { markdownView } from "../markdown/markdownView";
