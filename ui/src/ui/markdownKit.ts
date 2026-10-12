import { useEffect, useState } from "react";

/**
 * The rich view's Tiptap half: the Markdown extensions, the fidelity check,
 * and the editor itself. It loads on its own the first time a file is shown
 * formatted, so the app's first load does not carry an editor most visits
 * never show.
 */
const importKit = async () => {
  const [document, core, placeholder] = await Promise.all([
    import("./markdownDocument"), import("@tiptap/core"), import("@tiptap/extension-placeholder"),
  ]);
  return { ...document, Editor: core.Editor, Extension: core.Extension, Placeholder: placeholder.default };
};
export type MarkdownKit = Awaited<ReturnType<typeof importKit>>;

let kit: MarkdownKit | undefined;
let loading: Promise<MarkdownKit> | undefined;

/** Load the rich view's Tiptap half once; every later call gets the same kit. */
export function loadMarkdownKit(): Promise<MarkdownKit> {
  loading ??= importKit().then((loaded) => (kit = loaded));
  return loading;
}

/** The kit once it has loaded; until then undefined, and the caller shows that the file is still opening. */
export function useMarkdownKit(load = true): MarkdownKit | undefined {
  const [value, setValue] = useState(kit);
  useEffect(() => {
    if (value || !load) return;
    let alive = true;
    void loadMarkdownKit().then((loaded) => { if (alive) setValue(loaded); });
    return () => { alive = false; };
  }, [value, load]);
  return value ?? kit;
}
