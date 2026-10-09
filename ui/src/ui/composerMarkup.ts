import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** What one line's leading Markdown says: how deep in quotes and lists it sits, and which marker it starts with. */
interface LineMarkup {
  quote: number;
  /** The end of the leading markup that the draft hides. */
  hideTo: number;
  /** Where the innermost marker starts: the last `>`, or the item's `-` or `1.`. */
  innerFrom: number;
  item?: { ordered: boolean; text: string; depth: number };
}

interface MarkupDecorations {
  readonly decorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly lines: ReadonlyMap<number, LineMarkup>;
}

const markupState = StateField.define<MarkupDecorations>({
  create: (state) => markupDecorations(state),
  // The Markdown parse arrives in effects as well as edits, so both rebuild.
  update: (value, transaction) => transaction.docChanged || transaction.effects.length > 0 ? markupDecorations(transaction.state) : value,
});

/**
 * A list item or a quote in the draft reads as the transcript draws it: a
 * bullet or a number in a hanging indent, or a bar beside muted text. The
 * text stays canonical Markdown. The draft only hides the leading `-`, `1.`,
 * or `>` and the space after it, and the caret steps over them as one unit.
 */
export function composerMarkup(): Extension {
  return markupExtension;
}

/** The end of the hidden markup on the caret's line, if the caret is at or before it. */
function hiddenEnd(state: EditorState, position: number): number | undefined {
  const field = state.field(markupState, false);
  const line = state.doc.lineAt(position);
  const markup = field?.lines.get(line.number);
  return markup && markup.hideTo > line.from && position < markup.hideTo ? markup.hideTo : undefined;
}

/** Home on an item or a quote goes to where its text starts. Before the hidden marker, typing would break the item. */
export function composerMarkupLineStart(view: EditorView): boolean {
  const { main } = view.state.selection;
  const line = view.state.doc.lineAt(main.head);
  const markup = view.state.field(markupState, false)?.lines.get(line.number);
  if (!main.empty || !markup || markup.hideTo <= line.from) return false;
  if (main.head !== markup.hideTo) view.dispatch({ selection: { anchor: markup.hideTo }, scrollIntoView: true, userEvent: "select" });
  return true;
}

/** A press left of a marker puts the caret where the text starts, as a press on the marker does. */
const pointerAfterMarker = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.isUserEvent("select.pointer") || transaction.docChanged || !transaction.selection) return transaction;
  const { main } = transaction.selection;
  const end = main.empty ? hiddenEnd(transaction.startState, main.head) : undefined;
  return end === undefined ? transaction : [transaction, { selection: { anchor: end }, sequential: true }];
});

const markupExtension: Extension = [
  markupState,
  pointerAfterMarker,
  EditorView.decorations.from(markupState, (value) => value.decorations),
  EditorView.atomicRanges.of((view) => view.state.field(markupState).atomicRanges),
];

function markupDecorations(state: EditorState): MarkupDecorations {
  const lines = new Map<number, LineMarkup>();
  const lineAt = (position: number): [number, LineMarkup] => {
    const line = state.doc.lineAt(position);
    let markup = lines.get(line.number);
    if (!markup) { markup = { quote: 0, hideTo: line.from, innerFrom: line.from }; lines.set(line.number, markup); }
    return [line.number, markup];
  };
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeBlock") return false;
      if (node.name === "QuoteMark") {
        const [, markup] = lineAt(node.from);
        markup.quote++;
        if (!markup.item) markup.innerFrom = Math.max(markup.innerFrom, node.from);
        markup.hideTo = Math.max(markup.hideTo, afterSpace(state, node.to));
      } else if (node.name === "ListMark") {
        // A marker with nothing after it yet ("-" alone) is still being typed.
        if (!/[ \t]/u.test(state.sliceDoc(node.to, node.to + 1))) return undefined;
        const [, markup] = lineAt(node.from);
        const list = node.node.parent?.parent;
        markup.item = { ordered: list?.name === "OrderedList", text: state.sliceDoc(node.from, node.to), depth: listDepth(node.node) };
        markup.innerFrom = node.from;
        markup.hideTo = Math.max(markup.hideTo, node.to + 1);
      }
      return undefined;
    },
  });
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  for (const [number, markup] of [...lines].sort(([a], [b]) => a - b)) {
    const line = state.doc.line(number);
    const classes = [markup.quote > 0 ? "cm-md-quote" : "", markup.item ? "cm-md-item" : ""].filter(Boolean).join(" ");
    decorations.push(Decoration.line({ class: classes, attributes: { style: `--md-quote: ${markup.quote}; --md-list: ${markup.item?.depth ?? 0}` } }).range(line.from));
    if (markup.hideTo <= line.from) continue;
    const hidden = Decoration.replace(markup.item ? { widget: new ItemMarker(markup.item.ordered, markup.item.text, markup.item.depth) } : {})
      .range(line.from, markup.hideTo);
    decorations.push(hidden);
    atomicRanges.push(hidden);
  }
  return { decorations: Decoration.set(decorations, true), atomicRanges: Decoration.set(atomicRanges, true), lines };
}

/**
 * Backspace where an item's or a quote's text starts takes off what the draft
 * shows there: a nested item moves out one level, a top-level item loses its
 * bullet or number, and a quote loses one level. Hidden spaces never stay behind.
 */
export function deleteComposerMarkup(view: EditorView): boolean {
  const { main } = view.state.selection;
  const field = view.state.field(markupState, false);
  if (!main.empty || !field) return false;
  const line = view.state.doc.lineAt(main.head);
  const markup = field.lines.get(line.number);
  if (!markup || main.head !== markup.hideTo) return false;
  // The indentation right before a nested item's marker. Taking off one indent unit moves it out a level.
  const indent = markup.item && markup.item.depth > 1 ? /[ \t]*$/u.exec(view.state.sliceDoc(line.from, markup.innerFrom))?.[0] ?? "" : "";
  const changes = indent.length > 0
    ? { from: markup.innerFrom - (indent.endsWith("\t") ? 1 : Math.min(indent.length, 2)), to: markup.innerFrom }
    : { from: markup.innerFrom, to: markup.hideTo };
  view.dispatch({ changes, scrollIntoView: true, userEvent: "delete.backward" });
  return true;
}

function afterSpace(state: EditorState, position: number): number {
  return state.sliceDoc(position, position + 1) === " " ? position + 1 : position;
}

function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "ListItem") depth++;
  return Math.max(depth, 1);
}

/** A nested list changes its bullet, as browsers draw `ul ul` and `ul ul ul`. */
const BULLETS = ["•", "◦", "▪"] as const;

class ItemMarker extends WidgetType {
  constructor(private readonly ordered: boolean, private readonly text: string, private readonly depth: number) { super(); }
  override eq(other: ItemMarker): boolean { return this.ordered === other.ordered && this.text === other.text && this.depth === other.depth; }
  override toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.ordered ? "cm-md-marker cm-md-number" : "cm-md-marker";
    marker.textContent = this.ordered ? this.text : BULLETS[(this.depth - 1) % BULLETS.length]!;
    return marker;
  }
  // A press on the marker puts the caret after it, as a press beside text does.
  override ignoreEvent(): boolean { return false; }
}
