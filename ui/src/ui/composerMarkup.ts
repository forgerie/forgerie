import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { tagHighlighter, tags } from "@lezer/highlight";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** What one line's leading Markdown says: how deep in quotes and lists it sits, and which marker it starts with. */
interface LineMarkup {
  quote: number;
  /** The end of the leading markup that the draft hides. */
  hideTo: number;
  /** Where the innermost marker starts: the last `>`, or the item's `-` or `1.`. */
  innerFrom: number;
  item?: { ordered: boolean; text: string; depth: number };
  /** A task item's `[ ]` or `[x]`: where it starts, and whether it is checked. */
  task?: { from: number; done: boolean };
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
 * Inline Markdown keeps its markers, muted, and its text takes the look the
 * transcript gives it. A heading stays the draft's size, so lines never jump.
 */
const proseHighlighter = tagHighlighter([
  { tag: tags.strong, class: "cm-md-strong" },
  { tag: tags.emphasis, class: "cm-md-em" },
  { tag: tags.strikethrough, class: "cm-md-strike" },
  { tag: tags.link, class: "cm-md-link" },
  { tag: tags.url, class: "cm-md-url" },
  { tag: tags.heading, class: "cm-md-heading" },
  { tag: tags.processingInstruction, class: "cm-md-mark" },
]);

/**
 * Markdown in the draft reads as the transcript draws it. A list item shows a
 * bullet, a number, or a checkbox in a hanging indent. A quote shows a bar
 * beside muted text. Bold, italic, struck, code, and link text take their
 * look, with their markers muted. The text stays canonical Markdown: the draft
 * only hides the leading `-`, `1.`, `[ ]`, or `>` and the space after it, and
 * the caret steps over them as one unit.
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

/** Checks or clears the task item at `position`, the caret's line by default. */
export function toggleComposerTask(view: EditorView, position = view.state.selection.main.head): boolean {
  const line = view.state.doc.lineAt(position);
  const task = view.state.field(markupState, false)?.lines.get(line.number)?.task;
  if (!task) return false;
  view.dispatch({ changes: { from: task.from + 1, to: task.from + 2, insert: task.done ? " " : "x" }, userEvent: "input" });
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
  syntaxHighlighting(proseHighlighter),
  EditorView.decorations.from(markupState, (value) => value.decorations),
  EditorView.atomicRanges.of((view) => view.state.field(markupState).atomicRanges),
];

function markupDecorations(state: EditorState): MarkupDecorations {
  const lines = new Map<number, LineMarkup>();
  // Inline code text, between its backticks. The highlighter cannot tell it from a code block's text.
  const inlineCode: { from: number; to: number }[] = [];
  const lineAt = (position: number): LineMarkup => {
    const line = state.doc.lineAt(position);
    let markup = lines.get(line.number);
    if (!markup) { markup = { quote: 0, hideTo: line.from, innerFrom: line.from }; lines.set(line.number, markup); }
    return markup;
  };
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeBlock") return false;
      if (node.name === "InlineCode") {
        const open = node.node.firstChild, close = node.node.lastChild;
        if (open?.name === "CodeMark" && close?.name === "CodeMark" && close.from > open.to) inlineCode.push({ from: open.to, to: close.from });
        return false;
      }
      if (node.name === "QuoteMark") {
        const markup = lineAt(node.from);
        markup.quote++;
        if (!markup.item) markup.innerFrom = Math.max(markup.innerFrom, node.from);
        markup.hideTo = Math.max(markup.hideTo, afterSpace(state, node.to));
      } else if (node.name === "ListMark") {
        // A marker with nothing after it yet ("-" alone) is still being typed.
        if (!/[ \t]/u.test(state.sliceDoc(node.to, node.to + 1))) return undefined;
        const markup = lineAt(node.from);
        const list = node.node.parent?.parent;
        markup.item = { ordered: list?.name === "OrderedList", text: state.sliceDoc(node.from, node.to), depth: listDepth(node.node) };
        markup.innerFrom = node.from;
        markup.hideTo = Math.max(markup.hideTo, node.to + 1);
      } else if (node.name === "TaskMarker") {
        // GFM needs a space after `[ ]`. The parser has checked it, so the marker hides with that space.
        const markup = lineAt(node.from);
        if (!markup.item || node.from !== markup.hideTo) return undefined;
        markup.task = { from: node.from, done: /x/iu.test(state.sliceDoc(node.from + 1, node.from + 2)) };
        markup.hideTo = afterSpace(state, node.to);
      }
      return undefined;
    },
  });
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  for (const code of inlineCode) decorations.push(INLINE_CODE.range(code.from, code.to));
  for (const [number, markup] of [...lines].sort(([a], [b]) => a - b)) {
    const line = state.doc.line(number);
    const classes = [markup.quote > 0 && "cm-md-quote", markup.item && "cm-md-item", markup.task?.done && "cm-md-done"].filter(Boolean).join(" ");
    const attributes: Record<string, string> = { style: `--md-quote: ${markup.quote}; --md-list: ${markup.item?.depth ?? 0}` };
    // The bars and the hanging indent sit on the side the line's own text starts from.
    if (rightToLeft(state.sliceDoc(markup.hideTo, line.to))) attributes.dir = "rtl";
    decorations.push(Decoration.line({ class: classes, attributes }).range(line.from));
    if (markup.hideTo <= line.from) continue;
    const marker = markup.item ? new ItemMarker(markup.item.ordered, markup.item.text, markup.item.depth, markup.task?.done) : undefined;
    const hidden = Decoration.replace(marker ? { widget: marker } : {}).range(line.from, markup.hideTo);
    decorations.push(hidden);
    atomicRanges.push(hidden);
  }
  return { decorations: Decoration.set(decorations, true), atomicRanges: Decoration.set(atomicRanges, true), lines };
}

/**
 * Backspace where an item's or a quote's text starts takes off what the draft
 * shows there: a task loses its checkbox, a nested item moves out one level, a
 * top-level item loses its bullet or number, and a quote loses one level.
 * Hidden spaces never stay behind.
 */
export function deleteComposerMarkup(view: EditorView): boolean {
  const { main } = view.state.selection;
  const field = view.state.field(markupState, false);
  if (!main.empty || !field) return false;
  const line = view.state.doc.lineAt(main.head);
  const markup = field.lines.get(line.number);
  if (!markup || main.head !== markup.hideTo) return false;
  if (markup.task) {
    view.dispatch({ changes: { from: markup.task.from, to: markup.hideTo }, scrollIntoView: true, userEvent: "delete.backward" });
    return true;
  }
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

/** The first strong character decides, as `dir="auto"` does. */
function rightToLeft(text: string): boolean {
  const first = /\p{L}/u.exec(text)?.[0];
  return first !== undefined && /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(first);
}

/** A nested list changes its bullet, as browsers draw `ul ul` and `ul ul ul`. */
const BULLETS = ["•", "◦", "▪"] as const;

class ItemMarker extends WidgetType {
  constructor(private readonly ordered: boolean, private readonly text: string, private readonly depth: number, private readonly done: boolean | undefined) { super(); }
  override eq(other: ItemMarker): boolean {
    return this.ordered === other.ordered && this.text === other.text && this.depth === other.depth && this.done === other.done;
  }
  override toDOM(view: EditorView): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.ordered ? "cm-md-marker cm-md-number" : "cm-md-marker";
    if (this.ordered || this.done === undefined) marker.textContent = this.ordered ? this.text : BULLETS[(this.depth - 1) % BULLETS.length]!;
    if (this.done === undefined) return marker;
    // A task shows a checkbox in place of its bullet, after its number. A press checks or clears it.
    const box = document.createElement("span");
    box.className = "cm-md-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.done));
    box.setAttribute("aria-label", "Done");
    box.title = "Check or clear. Ctrl+Shift+X";
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      toggleComposerTask(view, view.posAtDOM(marker));
    });
    marker.append(box);
    return marker;
  }
  // A press on a bullet puts the caret after it, as a press beside text does. A checkbox takes its own press.
  override ignoreEvent(event: Event): boolean {
    return this.done !== undefined && event.target instanceof Element && event.target.closest(".cm-md-task") !== null;
  }
}

const INLINE_CODE = Decoration.mark({ class: "cm-md-code" });

const LEADING_CHIP = Decoration.mark({ class: "cm-leading-chip" });

/**
 * Dresses the draft's leading token as a chip when it matches `pattern`, such
 * as a command the host will run. The token stays ordinary editable text: a
 * mark only styles it, so the caret, selection, and Backspace work as on any
 * other text.
 */
export function leadingChip(pattern: RegExp): Extension {
  const chip = (state: EditorState): DecorationSet => {
    const match = pattern.exec(state.sliceDoc(0, Math.min(state.doc.length, 200)));
    return match?.index === 0 && match[0].length > 0 ? Decoration.set([LEADING_CHIP.range(0, match[0].length)]) : Decoration.none;
  };
  const field = StateField.define<DecorationSet>({
    create: chip,
    update: (value, transaction) => transaction.docChanged ? chip(transaction.state) : value,
    provide: (self) => EditorView.decorations.from(self),
  });
  return field;
}
