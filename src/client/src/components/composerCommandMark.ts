import type { Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { leadingSlashCommandSpan } from "../slashCommandText";

/**
 * Dresses the draft's leading command token as the command mark, in place.
 *
 * The token stays ordinary editable text — a mark decoration only styles it —
 * so the caret, selection, and backspace behave exactly as they would over
 * plain characters. The chip is the same reading the completion menu and the
 * queued ghosts use: the draft shows a command about to run, not prose.
 */
export function composerCommandMark(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = commandMarkDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = commandMarkDecorations(update.view);
    }
  }, { decorations: (value) => value.decorations });
}

const COMMAND_MARK = Decoration.mark({ class: "cm-command-mark" });

function commandMarkDecorations(view: EditorView): DecorationSet {
  const span = leadingSlashCommandSpan(view.state.doc.toString());
  if (span === undefined) return Decoration.none;
  return Decoration.set([COMMAND_MARK.range(span.from, span.to)]);
}
