import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateField, type EditorState, type Extension, type Line, type Range, type RangeSet } from "@codemirror/state";
import { BlockWrapper, Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { codeFenceLanguageTag } from "../formatting/codeFenceLanguages";

type EditorSyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

interface CodeFenceBlock {
  readonly openingLine: Line;
  readonly closingLine: Line;
  readonly language: string | undefined;
}

interface CodeBlockDecorationState {
  readonly decorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly blockWrappers: RangeSet<BlockWrapper>;
}

interface CodeBlockCursorMeasure {
  readonly body: HTMLElement;
  readonly scrollLeft: number;
}

const codeBlockState = StateField.define<CodeBlockDecorationState>({
  create: (state) => codeBlockDecorations(state),
  update: (value, transaction) => transaction.docChanged || transaction.effects.length > 0 ? codeBlockDecorations(transaction.state) : value,
});

const codeBlockCursorScroll = ViewPlugin.fromClass(class {
  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate): void {
    if (update.selectionSet || update.docChanged || update.geometryChanged) this.schedule(update.view);
  }

  private schedule(view: EditorView): void {
    view.requestMeasure({
      key: this,
      read: measureCodeBlockCursor,
      write: (measure) => {
        if (measure?.body.isConnected === true) measure.body.scrollLeft = measure.scrollLeft;
      },
    });
  }
});

export function composerCodeBlock(): Extension {
  return [
    codeBlockState,
    EditorView.decorations.from(codeBlockState, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(codeBlockState).atomicRanges),
    EditorView.blockWrappers.from(codeBlockState, (value) => value.blockWrappers),
    codeBlockCursorScroll,
  ];
}

function measureCodeBlockCursor(view: EditorView): CodeBlockCursorMeasure | undefined {
  const selection = view.state.selection.main;
  if (!selection.empty) return undefined;
  const domPosition = view.domAtPos(selection.head);
  const element = domPosition.node instanceof Element ? domPosition.node : domPosition.node.parentElement;
  const body = element?.closest<HTMLElement>(".cm-code-block-body");
  const caret = view.coordsAtPos(selection.head);
  if (body === null || body === undefined || caret === null) return undefined;
  const bounds = body.getBoundingClientRect();
  const inset = 8;
  let scrollLeft = body.scrollLeft;
  if (caret.left < bounds.left + inset) scrollLeft -= bounds.left + inset - caret.left;
  else if (caret.right > bounds.right - inset) scrollLeft += caret.right - (bounds.right - inset);
  return { body, scrollLeft: Math.max(0, scrollLeft) };
}

/** Completes an opening fence and places the cursor on an empty code line. */
export function completeComposerCodeFence(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;
  const opening = /^( {0,3})(`{3,}|~{3,})([a-z0-9_+-]+)?[\t ]*$/iu.exec(line.text);
  if (opening === null) return false;
  const containingFence = codeFenceAt(view.state, selection.head);
  if (containingFence !== undefined && containingFence.closingLine.number > containingFence.openingLine.number) return false;
  const indent = opening[1] ?? "";
  const marker = opening[2];
  if (marker === undefined) return false;
  const insert = `\n\n${indent}${marker}\n`;
  view.dispatch({
    changes: { from: selection.head, insert },
    selection: EditorSelection.cursor(selection.head + 1),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export function protectComposerCodeBlockBoundary(view: EditorView, direction: "backward" | "forward"): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const block = codeFenceAt(view.state, selection.head);
  if (block === undefined) return false;
  const line = view.state.doc.lineAt(selection.head);
  if (direction === "backward") return line.number === block.openingLine.number + 1 && selection.head === line.from;
  return line.number === block.closingLine.number - 1 && selection.head === line.to;
}

/** Moves from the final code line past the hidden closing fence into prose. */
export function leaveComposerCodeBlock(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const block = codeFenceAt(view.state, selection.head);
  if (block === undefined) return false;
  const currentLine = view.state.doc.lineAt(selection.head);
  if (currentLine.number !== block.closingLine.number - 1) return false;

  if (block.closingLine.to === view.state.doc.length) {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  const proseLine = view.state.doc.line(block.closingLine.number + 1);
  const nextBlock = completeCodeFences(view.state).find((candidate) => candidate.openingLine.number === proseLine.number);
  if (nextBlock !== undefined) {
    if (nextBlock.closingLine.number === nextBlock.openingLine.number + 1) {
      view.dispatch({
        changes: { from: nextBlock.closingLine.from, insert: "\n" },
        selection: EditorSelection.cursor(nextBlock.closingLine.from),
        scrollIntoView: true,
        userEvent: "select",
      });
    } else {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(nextBlock.openingLine.number + 1).from), scrollIntoView: true, userEvent: "select" });
    }
    return true;
  }

  view.dispatch({ selection: EditorSelection.cursor(proseLine.from), scrollIntoView: true, userEvent: "select" });
  return true;
}

function codeBlockDecorations(state: EditorState): CodeBlockDecorationState {
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const blockWrappers: Range<BlockWrapper>[] = [];

  for (const block of completeCodeFences(state)) {
    const label = (block.language ?? "code").slice(0, 32).toUpperCase();
    const openingTo = lineBreakEnd(state, block.openingLine.to);
    const closingTo = lineBreakEnd(state, block.closingLine.to);
    const header = Decoration.replace({ block: true, inclusive: false, widget: new CodeBlockHeaderWidget(label) }).range(block.openingLine.from, openingTo);
    const empty = block.closingLine.number === block.openingLine.number + 1;
    const footer = Decoration.replace({ block: true, inclusive: false, widget: new CodeBlockFooterWidget(empty ? block.closingLine.from : undefined, label) }).range(block.closingLine.from, closingTo);
    decorations.push(header, footer);
    atomicRanges.push(header, footer);

    if (!empty) {
      const firstCodeLine = state.doc.line(block.openingLine.number + 1);
      blockWrappers.push(BlockWrapper.create({ tagName: "div", attributes: { class: "cm-code-block-body" } }).range(firstCodeLine.from, block.closingLine.from));
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
    blockWrappers: BlockWrapper.set(blockWrappers, true),
  };
}

function completeCodeFences(state: EditorState): CodeFenceBlock[] {
  const blocks: CodeFenceBlock[] = [];
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      if (nodeRef.name !== "FencedCode") return undefined;
      const block = codeFenceFromNode(state, nodeRef.node);
      if (block !== undefined) blocks.push(block);
      return false;
    },
  });
  return blocks;
}

function codeFenceAt(state: EditorState, position: number): CodeFenceBlock | undefined {
  let node: EditorSyntaxNode | null = syntaxTree(state).resolveInner(position, -1);
  while (node !== null && node.name !== "FencedCode") node = node.parent;
  return node === null ? undefined : codeFenceFromNode(state, node);
}

function codeFenceFromNode(state: EditorState, node: EditorSyntaxNode): CodeFenceBlock | undefined {
  const codeMarks: EditorSyntaxNode[] = [];
  let codeInfo: EditorSyntaxNode | undefined;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "CodeMark") codeMarks.push(child);
    else if (child.name === "CodeInfo") codeInfo = child;
  }
  const opening = codeMarks[0];
  const closing = codeMarks[1];
  if (opening === undefined || closing === undefined) return undefined;
  const language = codeInfo === undefined ? undefined : codeFenceLanguageTag(state.sliceDoc(codeInfo.from, codeInfo.to));
  return {
    openingLine: state.doc.lineAt(opening.from),
    closingLine: state.doc.lineAt(closing.from),
    language,
  };
}

function lineBreakEnd(state: EditorState, lineEnd: number): number {
  return lineEnd < state.doc.length ? lineEnd + 1 : lineEnd;
}

class CodeBlockHeaderWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  override eq(other: CodeBlockHeaderWidget): boolean {
    return this.label === other.label;
  }

  override toDOM(): HTMLElement {
    const header = document.createElement("div");
    header.className = "cm-code-block-header";
    header.setAttribute("aria-label", `${this.label} code block`);
    header.textContent = this.label;
    return header;
  }
}

class CodeBlockFooterWidget extends WidgetType {
  constructor(private readonly insertAt: number | undefined, private readonly label: string) {
    super();
  }

  override eq(other: CodeBlockFooterWidget): boolean {
    return this.insertAt === other.insertAt && this.label === other.label;
  }

  override toDOM(view: EditorView): HTMLElement {
    const footer = document.createElement("div");
    footer.className = this.insertAt === undefined ? "cm-code-block-footer" : "cm-code-block-footer cm-code-block-empty";
    if (this.insertAt === undefined) {
      footer.setAttribute("aria-hidden", "true");
      return footer;
    }

    footer.tabIndex = 0;
    footer.setAttribute("role", "button");
    footer.setAttribute("aria-label", `Empty ${this.label} code block; activate to edit`);
    const beginEditing = (event: Event): void => {
      event.preventDefault();
      const insertAt = this.insertAt;
      if (insertAt === undefined) return;
      view.dispatch({
        changes: { from: insertAt, insert: "\n" },
        selection: EditorSelection.cursor(insertAt),
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
    };
    footer.addEventListener("click", beginEditing);
    footer.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") beginEditing(event);
    });
    return footer;
  }
}
