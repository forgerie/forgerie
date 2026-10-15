import { useEffect, useLayoutEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { codeHighlighter } from "./codeTokens";
import "./CodeEditor.css";

/** Texts larger than this stay plain: one parse of them would hold up the page. The diff editor uses the same limit. */
const PLAIN_ABOVE = 1_000_000;

/**
 * CodeMirror draws its own elements, so their look is a CodeMirror theme
 * here rather than selectors in CodeEditor.css. Values are theme tokens.
 */
const look = EditorView.theme({
  "&": { flex: "1 1 auto", background: "transparent", color: "var(--foreground)", fontSize: "var(--code-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--code-font)", lineHeight: "1.6", fontVariantLigatures: "none", tabSize: "4", overflow: "visible" },
  ".cm-content": { paddingBlock: "0", caretColor: "var(--foreground)" },
  // 1.6 × the code size plus this padding gives each line a 1.5rem target for a finger.
  ".cm-line": { padding: "0.125rem var(--tree-pad, var(--space-4)) 0.125rem var(--space-2)" },
  ".cm-cursor": { borderInlineStartColor: "var(--foreground)" },
  ".cm-gutters": { minHeight: "100%", border: "0", background: "var(--background)", color: "var(--muted-foreground)" },
  // CodeMirror sets each number's height to its line's; border-box keeps the top padding, which matches the line's, inside it.
  ".cm-lineNumbers .cm-gutterElement": { boxSizing: "border-box", padding: "0.125rem var(--space-2) 0 var(--tree-pad, var(--space-4))",
    minWidth: "3ch", fontVariantNumeric: "tabular-nums", userSelect: "none" },
  ".cm-activeLine": { background: "var(--caret-line)" },
  ".cm-activeLineGutter": { background: "transparent", color: "var(--foreground)" },
  "&.cm-focused .cm-matchingBracket": { background: "var(--bracket-match)" },
  "&.cm-focused .cm-nonmatchingBracket": { background: "var(--bracket-miss)" },
  ".tok-keyword": { color: "var(--code-keyword)" },
  ".tok-string": { color: "var(--code-string)" },
  ".tok-number": { color: "var(--code-number)" },
  ".tok-comment": { color: "var(--code-comment)" },
  ".tok-title": { color: "var(--code-title)" },
  // A line the host marks, such as one a parser refused: a wash and a rule at its start in the failure ink.
  ".cm-line.code-editor-marked": { background: "color-mix(in oklab, var(--destructive) 9%, transparent)",
    boxShadow: "inset 0.1875rem 0 0 var(--ink-bad)" },
});

/** The line in a document, clamped to its lines. */
const lineAt = (state: EditorState, number: number) => state.doc.line(Math.min(Math.max(1, number), state.doc.lines));
/** The mark on one line, or nothing. */
const markOf = (state: EditorState, line: number | undefined) => line === undefined ? []
  : [EditorView.decorations.of(Decoration.set([Decoration.line({ class: "code-editor-marked" }).range(lineAt(state, line).from)]))];

/**
 * Molecule: an editable code editor: line numbers, undo, Tab to indent,
 * matching brackets, and syntax colour from the file name, loaded after the
 * text shows. The caller keys it by document, so a new document is a new
 * editor and undo never crosses into another one. `markLine` marks one line,
 * such as one a parser refused; `goToLine` opens the editor with the caret on
 * that line and the line in view, so a "show line" action lands there. A change
 * of `readOnly` or `markLine` keeps the editor, its caret and its undo.
 */
export function CodeEditor({ label, fileName, text, readOnly = false, markLine, goToLine, onChange, onSave }: {
  /** The editor's accessible name. */
  label: string;
  /** Picks the language, such as `index.ts`. */
  fileName: string;
  /** The text the editor starts from. Later changes are ignored: the editor owns the document from then on. */
  text: string;
  /** Shows the text with its colour and line numbers, and refuses edits; selecting and copying still work. */
  readOnly?: boolean;
  /** A 1-based line to mark. */
  markLine?: number | undefined;
  /** A 1-based line to put the caret on, in view and focused, when the editor mounts. */
  goToLine?: number | undefined;
  onChange: (text: string) => void;
  /** Control or Command with S. */
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onChange, onSave });
  latest.current = { onChange, onSave };
  const live = useRef<{ view: EditorView; locked: Compartment; mark: Compartment }>(undefined);
  // What the editor mounts with; later values reach it through its compartments.
  const initial = useRef({ readOnly, markLine });
  initial.current = { readOnly, markLine };

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const language = new Compartment();
    const locked = new Compartment();
    const mark = new Compartment();
    const start = EditorState.create({ doc: text });
    const caret = goToLine === undefined ? undefined : lineAt(start, goToLine).from;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        ...caret === undefined ? {} : { selection: { anchor: caret } },
        extensions: [mark.of(markOf(start, initial.current.markLine)),
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(), indentOnInput(), bracketMatching(),
          EditorView.lineWrapping, syntaxHighlighting(codeHighlighter), look, language.of([]),
          EditorView.contentAttributes.of({ "aria-label": label }),
          locked.of(EditorState.readOnly.of(initial.current.readOnly)),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { latest.current.onSave(); return true; } },
            // Tab indents. Escape, then Tab, moves focus out, as CodeMirror documents for indentWithTab.
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => { if (update.docChanged) latest.current.onChange(update.state.doc.toString()); }),
        ],
      }),
    });
    live.current = { view, locked, mark };
    if (caret !== undefined) {
      view.dispatch({ effects: EditorView.scrollIntoView(caret, { y: "center" }) });
      view.focus();
    }
    let alive = true;
    const description = text.length > PLAIN_ABOVE ? undefined : LanguageDescription.matchFilename(languages, fileName);
    void description?.load().then((support) => { if (alive) view.dispatch({ effects: language.reconfigure(support) }); }, () => undefined);
    return () => { alive = false; live.current = undefined; view.destroy(); };
    // The text and the caret's line are only where the editor starts; a new document or a new jump remounts it through its key.
  }, [fileName, label]);
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    current.view.dispatch({ effects: [current.locked.reconfigure(EditorState.readOnly.of(readOnly)), current.mark.reconfigure(markOf(current.view.state, markLine))] });
  }, [readOnly, markLine]);

  return <div className="code-editor" ref={host} />;
}
