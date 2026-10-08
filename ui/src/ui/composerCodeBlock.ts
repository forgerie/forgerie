// Ported from the legacy client's components/composerCodeBlock.ts (main 7350dbb3).
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateField, type EditorState, type Extension, type Line, type Range, type RangeSet } from "@codemirror/state";
import { BlockWrapper, Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { codeFenceTag } from "./composerCodeLanguage";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** A complete fenced block. Its fence lines stay in the draft's Markdown, hidden behind a header and a footer. */
interface CodeFence { readonly openingLine: Line; readonly closingLine: Line; readonly language: string | undefined }

interface CodeBlockDecorations {
  readonly decorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly blockWrappers: RangeSet<BlockWrapper>;
}

const codeBlockState = StateField.define<CodeBlockDecorations>({
  create: (state) => codeBlockDecorations(state),
  // The Markdown parse arrives in effects as well as edits, so both rebuild.
  update: (value, transaction) => transaction.docChanged || transaction.effects.length > 0 ? codeBlockDecorations(transaction.state) : value,
});

/** A long code line scrolls inside its block; this keeps the caret in sight there. */
const codeBlockCursorScroll = ViewPlugin.fromClass(class {
  constructor(view: EditorView) { this.schedule(view); }
  update(update: ViewUpdate): void {
    if (update.selectionSet || update.docChanged || update.geometryChanged) this.schedule(update.view);
  }
  private schedule(view: EditorView): void {
    view.requestMeasure({
      key: this,
      read: measureCodeBlockCursor,
      write: (measure) => { if (measure?.body.isConnected === true) measure.body.scrollLeft = measure.scrollLeft; },
    });
  }
});

/**
 * A complete fence in the draft reads as a code block: a language header, a
 * highlighted body, and no visible fence markers. The text stays canonical
 * fenced Markdown, so persistence, history, and sending see the same source.
 */
export function composerCodeBlock(): Extension {
  return [
    codeBlockState,
    EditorView.decorations.from(codeBlockState, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(codeBlockState).atomicRanges),
    EditorView.blockWrappers.from(codeBlockState, (value) => value.blockWrappers),
    codeBlockCursorScroll,
  ];
}

function measureCodeBlockCursor(view: EditorView): { body: HTMLElement; scrollLeft: number } | undefined {
  const selection = view.state.selection.main;
  if (!selection.empty) return undefined;
  const domPosition = view.domAtPos(selection.head);
  const element = domPosition.node instanceof Element ? domPosition.node : domPosition.node.parentElement;
  const body = element?.closest<HTMLElement>(".cm-code-block-body");
  const caret = view.coordsAtPos(selection.head);
  if (!body || !caret) return undefined;
  const bounds = body.getBoundingClientRect();
  const inset = 8;
  let scrollLeft = body.scrollLeft;
  if (caret.left < bounds.left + inset) scrollLeft -= bounds.left + inset - caret.left;
  else if (caret.right > bounds.right - inset) scrollLeft += caret.right - (bounds.right - inset);
  return { body, scrollLeft: Math.max(0, scrollLeft) };
}

/** Enter at the end of an opening fence closes it and puts the caret on its empty first line. */
export function completeComposerCodeFence(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;
  const opening = /^( {0,3})(`{3,}|~{3,})([a-z0-9_+-]+)?[\t ]*$/iu.exec(line.text);
  if (!opening) return false;
  const containing = codeFenceAt(view.state, selection.head);
  if (containing && containing.closingLine.number > containing.openingLine.number) return false;
  const indent = opening[1] ?? "";
  const marker = opening[2];
  if (marker === undefined) return false;
  view.dispatch({
    changes: { from: selection.head, insert: `\n\n${indent}${marker}\n` },
    selection: EditorSelection.cursor(selection.head + 1),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** Backspace at a block's first code line, or Delete at its last, would eat a hidden fence. */
export function protectComposerCodeBlockBoundary(view: EditorView, direction: "backward" | "forward"): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const block = codeFenceAt(view.state, selection.head);
  if (!block) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (direction === "backward") return line.number === block.openingLine.number + 1 && selection.head === line.from;
  return line.number === block.closingLine.number - 1 && selection.head === line.to;
}

/** Arrow Down on a block's last code line moves past the hidden closing fence into prose, or into the next block. */
export function leaveComposerCodeBlock(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const block = codeFenceAt(view.state, selection.head);
  if (!block) return false;
  const current = view.state.doc.lineAt(selection.head);
  if (current.number !== block.closingLine.number - 1) return false;
  if (block.closingLine.to === view.state.doc.length) {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }
  const prose = view.state.doc.line(block.closingLine.number + 1);
  const next = completeCodeFences(view.state).find((candidate) => candidate.openingLine.number === prose.number);
  if (next) {
    if (next.closingLine.number === next.openingLine.number + 1) {
      view.dispatch({ changes: { from: next.closingLine.from, insert: "\n" }, selection: EditorSelection.cursor(next.closingLine.from), scrollIntoView: true, userEvent: "select" });
    } else {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(next.openingLine.number + 1).from), scrollIntoView: true, userEvent: "select" });
    }
    return true;
  }
  view.dispatch({ selection: EditorSelection.cursor(prose.from), scrollIntoView: true, userEvent: "select" });
  return true;
}

function codeBlockDecorations(state: EditorState): CodeBlockDecorations {
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const blockWrappers: Range<BlockWrapper>[] = [];
  for (const block of completeCodeFences(state)) {
    // The tag as written, like the transcript's code sheet.
    const label = (block.language ?? "code").slice(0, 32);
    const empty = block.closingLine.number === block.openingLine.number + 1;
    // Inclusive at the start: a non-inclusive start makes CodeMirror draw an
    // empty line for the hidden fence's first position, above the label.
    const header = Decoration.replace({ block: true, inclusiveStart: true, inclusiveEnd: false, widget: new CodeBlockHeader(label) })
      .range(block.openingLine.from, lineBreakEnd(state, block.openingLine.to));
    const footer = Decoration.replace({ block: true, inclusiveStart: true, inclusiveEnd: false, widget: new CodeBlockFooter(empty ? block.closingLine.from : undefined, label) })
      .range(block.closingLine.from, lineBreakEnd(state, block.closingLine.to));
    decorations.push(header, footer);
    atomicRanges.push(header, footer);
    if (!empty) {
      const first = state.doc.line(block.openingLine.number + 1);
      // The body wraps the code lines only, so the closing edge draws outside it.
      blockWrappers.push(BlockWrapper.create({ tagName: "div", attributes: { class: "cm-code-block-body" } }).range(first.from, block.closingLine.from - 1));
    }
  }
  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
    blockWrappers: BlockWrapper.set(blockWrappers, true),
  };
}

function completeCodeFences(state: EditorState): CodeFence[] {
  const blocks: CodeFence[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return undefined;
      const block = codeFenceFromNode(state, node.node);
      if (block) blocks.push(block);
      return false;
    },
  });
  return blocks;
}

function codeFenceAt(state: EditorState, position: number): CodeFence | undefined {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
  while (node !== null && node.name !== "FencedCode") node = node.parent;
  return node === null ? undefined : codeFenceFromNode(state, node);
}

function codeFenceFromNode(state: EditorState, node: SyntaxNode): CodeFence | undefined {
  const marks: SyntaxNode[] = [];
  let info: SyntaxNode | undefined;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "CodeMark") marks.push(child);
    else if (child.name === "CodeInfo") info = child;
  }
  const [opening, closing] = marks;
  if (!opening || !closing) return undefined;
  return {
    openingLine: state.doc.lineAt(opening.from),
    closingLine: state.doc.lineAt(closing.from),
    language: info === undefined ? undefined : codeFenceTag(state.sliceDoc(info.from, info.to)),
  };
}

function lineBreakEnd(state: EditorState, lineEnd: number): number {
  return lineEnd < state.doc.length ? lineEnd + 1 : lineEnd;
}

class CodeBlockHeader extends WidgetType {
  constructor(private readonly label: string) { super(); }
  override eq(other: CodeBlockHeader): boolean { return this.label === other.label; }
  override toDOM(): HTMLElement {
    const header = document.createElement("div");
    header.className = "cm-code-block-header";
    header.setAttribute("aria-label", `${this.label} code block`);
    header.textContent = this.label;
    return header;
  }
}

class CodeBlockFooter extends WidgetType {
  constructor(private readonly insertAt: number | undefined, private readonly label: string) { super(); }
  override eq(other: CodeBlockFooter): boolean { return this.insertAt === other.insertAt && this.label === other.label; }
  override toDOM(view: EditorView): HTMLElement {
    const footer = document.createElement("div");
    footer.className = this.insertAt === undefined ? "cm-code-block-footer" : "cm-code-block-footer cm-code-block-empty";
    if (this.insertAt === undefined) {
      footer.setAttribute("aria-hidden", "true");
      return footer;
    }
    // An empty block has no line to put a caret on. Its visible body opens one.
    footer.tabIndex = 0;
    footer.setAttribute("role", "button");
    footer.setAttribute("aria-label", `Empty ${this.label} code block; activate to edit`);
    const begin = (event: Event): void => {
      event.preventDefault();
      const insertAt = this.insertAt;
      if (insertAt === undefined) return;
      view.dispatch({ changes: { from: insertAt, insert: "\n" }, selection: EditorSelection.cursor(insertAt), scrollIntoView: true, userEvent: "input" });
      view.focus();
    };
    footer.addEventListener("click", begin);
    footer.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") begin(event); });
    return footer;
  }
}
