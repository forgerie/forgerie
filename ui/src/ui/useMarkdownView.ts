import { useCallback, useState } from "react";
import { useMarkdownKit, type MarkdownKit } from "./markdownKit";
import { isMarkdownPath } from "./markdownText";
import type { ToggleOption } from "./ToggleGroup";

export type MarkdownView = "rich" | "source";

/** The words of the Rich and Source views, the same wherever a Markdown file opens. */
export const MARKDOWN_WORDS = {
  switchLabel: "View",
  rich: "Rich",
  source: "Source",
  tooLarge: "Too large for the rich view.",
  editSource: "Edit source",
  lossy: (changes: number) => `Editing here would rewrite this file's Markdown in ${String(changes)} ${changes === 1 ? "place" : "places"}.`,
} as const;

/** How one open file shows: which view, and what holds the rich view back. */
export interface MarkdownViewPlan {
  /** The file is Markdown, so it has the two views and the switch shows. */
  markdown: boolean;
  /** The rich view was asked for and its editor is still loading. The source view never waits for it. */
  pending: boolean;
  view: MarkdownView;
  /** The rich view is off: the file is too large to format. */
  tooLarge: boolean;
  /** Editing in the rich view would rewrite this many places, so it shows the file read-only. */
  lossy: number | undefined;
  /** The switch's choices. */
  options: readonly ToggleOption<MarkdownView>[];
  /** The reader chose a view with the switch. It becomes the choice for every Markdown file. */
  choose: (view: MarkdownView) => void;
  /** Source for this file only, from the read-only notice. */
  editSource: () => void;
}

type Editability = ReturnType<MarkdownKit["richEditability"]>;

/**
 * Which view a Markdown file opens in, and whether the rich view may edit it.
 * The check runs once each time the reader enters a view of a document, on
 * the text as it is then, so a view never turns read-only under the reader's
 * fingers. `document` names the open file and its read, such as the path and
 * a read count: a new read checks again. The caller keeps the remembered
 * choice and hears a new one through `onPrefer`.
 */
export function useMarkdownView({ path, document, text, preferred, onPrefer }: {
  path: string;
  document: string;
  /** The file's text now, edits included. */
  text: string;
  preferred: MarkdownView;
  onPrefer: (view: MarkdownView) => void;
}): MarkdownViewPlan {
  const markdown = isMarkdownPath(path);
  const kit = useMarkdownKit(markdown);
  const [override, setOverride] = useState<{ document: string; view: MarkdownView }>();
  const requested = override?.document === document ? override.view : preferred;
  const key = `${document}\n${requested}`;
  const [checked, setChecked] = useState<{ key: string; value: Editability }>();
  let value = checked?.key === key ? checked.value : undefined;
  if (markdown && kit && value === undefined) {
    value = kit.richEditability(text);
    setChecked({ key, value });
  }
  const tooLarge = value?.kind === "too-large";
  const view: MarkdownView = !markdown || tooLarge ? "source" : requested;
  const choose = useCallback((next: MarkdownView) => { setOverride(undefined); onPrefer(next); }, [onPrefer]);
  const editSource = useCallback(() => setOverride({ document, view: "source" }), [document]);
  return {
    markdown, view, tooLarge, choose, editSource, pending: markdown && requested === "rich" && value === undefined,
    lossy: view === "rich" && value?.kind === "lossy" ? value.changes : undefined,
    options: [
      { value: "rich", label: MARKDOWN_WORDS.rich, disabled: tooLarge, title: tooLarge ? MARKDOWN_WORDS.tooLarge : "Show the file formatted" },
      { value: "source", label: MARKDOWN_WORDS.source, title: "Show the file's Markdown" },
    ],
  };
}
