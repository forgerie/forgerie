import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorState, Prec, RangeSet, StateEffect, StateField, Text, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, drawSelection, gutter, gutterLineClass, keymap, type DecorationSet } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { foldRanges, lineWords, type DiffDocument } from "../changes/diffDocument";
import { diffTokens, parserFor, type Token } from "../changes/diffHighlight";
import type { RowSelection } from "../changes/diffNotes";

/** React content the editor draws under a document line, such as a note. */
export interface DiffBlock { key: string; line: number; node: ReactNode }

export interface DiffEditorProps {
  path: string;
  document: DiffDocument;
  /** Document lines some note covers. */
  covered: ReadonlySet<number>;
  /** The selected document lines, first and last. */
  selected: readonly [number, number] | undefined;
  blocks: readonly DiffBlock[];
  /** The block to bring into view and focus once it is drawn. */
  reveal?: string | undefined;
  onRevealed?: () => void;
  /** A tap on a line's numbers, or on its text with a finger. */
  onTapLine: (line: number) => void;
  /** Enter in the editor: a note on the lines the caret or selection covers. */
  onSelectLines: (selection: RowSelection) => void;
}

/**
 * One file's diff in a read-only CodeMirror editor: syntax colour from each
 * side's own parse, old and new line numbers, folded unchanged code, and
 * notes drawn between the lines. The editor owns caret, scrolling, and what
 * is drawn; the caller owns notes and the selection.
 */
export function DiffEditor(props: DiffEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const hintId = useId();
  const slots = useRef(new Map<string, HTMLElement>());
  const slotOf = (key: string) => {
    let element = slots.current.get(key);
    if (!element) {
      element = window.document.createElement("div");
      element.className = "diff-slot";
      slots.current.set(key, element);
    }
    return element;
  };
  const { document, path, covered, selected, blocks, reveal } = props;

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const created = new EditorView({ parent, state: createState(document, path, hintId, latest, latest.current.covered) });
    view.current = created;
    let alive = true;
    // Colour arrives after the first draw, so a large file shows its text at once.
    void parserFor(path).then((parser) => {
      if (!alive || !parser) return;
      setTimeout(() => { if (alive) created.dispatch({ effects: setTokens.of(tokenDecorations(diffTokens(document, parser))) }); }, 0);
    }, () => undefined);
    return () => { alive = false; created.destroy(); view.current = undefined; };
  }, [document, path, hintId]);

  // Slots changed by React must be measured again, or the lines under them overlap.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const resize = new ResizeObserver(() => current.requestMeasure());
    for (const block of blocks) resize.observe(slotOf(block.key));
    return () => resize.disconnect();
  });

  const keys = blocks.map((block) => `${block.key}@${String(block.line)}`).join(" ");
  const coveredKey = [...covered].join(" ");
  useLayoutEffect(() => {
    const current = view.current;
    if (!current) return;
    const live = new Set(blocks.map((block) => block.key));
    for (const key of slots.current.keys()) if (!live.has(key)) slots.current.delete(key);
    current.dispatch({ effects: setMarks.of({
      selected, covered, slots: blocks.map((block) => ({ key: block.key, line: block.line, element: slotOf(block.key) })),
    }) });
    // `keys` and `coveredKey` stand for `blocks` and `covered`, which are new objects on every keystroke in a note.
  }, [document, keys, selected?.[0], selected?.[1], coveredKey]);

  useEffect(() => {
    const current = view.current;
    const block = reveal === undefined ? undefined : blocks.find((item) => item.key === reveal);
    if (!current || !block) return;
    const line = current.state.doc.line(Math.min(block.line + 1, current.state.doc.lines));
    current.dispatch({ effects: EditorView.scrollIntoView(line.to, { y: "center" }) });
    // The editor draws the note on its next frame; the frame after it, the note can take focus.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const slot = slots.current.get(block.key);
      slot?.scrollIntoView?.({ block: "center" });
      slot?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      latest.current.onRevealed?.();
    }));
    // Once per editor: the reveal does not repeat as notes change.
  }, [document, reveal]);

  return <div className="diff-editor">
    <p id={hintId} className="sr-only">Read-only. Move to a line and press Enter to write a note on it. Shift with the arrow keys selects more lines.</p>
    <div ref={host} />
    {blocks.map((block) => createPortal(block.node, slotOf(block.key), block.key))}
  </div>;
}

interface Marks {
  selected: readonly [number, number] | undefined;
  covered: ReadonlySet<number>;
  slots: readonly { key: string; line: number; element: HTMLElement }[];
}
const setMarks = StateEffect.define<Marks>();
const setTokens = StateEffect.define<DecorationSet>();
const unfold = StateEffect.define<number>();

const marksField = StateField.define<Marks>({
  create: () => ({ selected: undefined, covered: new Set(), slots: [] }),
  update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(setMarks) ? effect.value : current, value),
});

const markDecorations = EditorView.decorations.compute([marksField], (state) => {
  const { selected, covered, slots } = state.field(marksField);
  const ranges: Range<Decoration>[] = [];
  const lineStart = (index: number) => state.doc.line(index + 1).from;
  for (const index of covered) if (index < state.doc.lines) ranges.push(notedLine.range(lineStart(index)));
  if (selected) for (let index = selected[0]; index <= selected[1] && index < state.doc.lines; index++) ranges.push(selectedLine.range(lineStart(index)));
  slots.forEach((slot, order) => {
    if (slot.line >= state.doc.lines) return;
    ranges.push(Decoration.widget({ widget: new SlotWidget(slot.key, slot.element), block: true, side: 1 + order }).range(state.doc.line(slot.line + 1).to));
  });
  return Decoration.set(ranges, true);
});

const tokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => transaction.effects.reduce((current, effect) => effect.is(setTokens) ? effect.value : current, value),
  provide: (field) => EditorView.decorations.from(field),
});

const marksByClass = new Map<string, Decoration>();
function tokenDecorations(tokens: readonly Token[]): DecorationSet {
  return Decoration.set(tokens.map((token) => {
    let mark = marksByClass.get(token.className);
    if (!mark) { mark = Decoration.mark({ class: token.className }); marksByClass.set(token.className, mark); }
    return mark.range(token.from, token.to);
  }));
}

const addedLine = Decoration.line({ class: "cm-diff-add" });
const removedLine = Decoration.line({ class: "cm-diff-remove" });
const notedLine = Decoration.line({ class: "cm-diff-noted" });
const selectedLine = Decoration.line({ class: "cm-diff-selected" });

/** Lines' kinds and the headers between them. They never change while the editor lives. */
function staticDecorations(document: DiffDocument, doc: Text): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  document.lines.forEach((line, index) => {
    const from = doc.line(index + 1).from;
    if (document.gaps.has(index)) ranges.push(Decoration.widget({ widget: new TextWidget("cm-diff-gap", document.gaps.get(index) ?? ""), block: true, side: -1 }).range(from));
    if (line.kind === "add") ranges.push(addedLine.range(from));
    if (line.kind === "remove") ranges.push(removedLine.range(from));
    const marker = document.markers.get(index);
    if (marker) ranges.push(Decoration.widget({ widget: new TextWidget("cm-diff-marker", marker), block: true, side: 1 }).range(doc.line(index + 1).to));
  });
  return Decoration.set(ranges, true);
}

function foldField(document: DiffDocument, keep: ReadonlySet<number>) {
  return StateField.define<DecorationSet>({
    create: (state) => Decoration.set(foldRanges(document, keep).map(([first, last]) => {
      const from = state.doc.line(first + 1).from;
      return Decoration.replace({ widget: new FoldWidget(from, last - first + 1), block: true }).range(from, state.doc.line(last + 1).to);
    })),
    update: (value, transaction) => {
      let next = value;
      for (const effect of transaction.effects) if (effect.is(unfold)) next = next.update({ filter: (from) => from !== effect.value });
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

class TextWidget extends WidgetType {
  constructor(readonly className: string, readonly text: string) { super(); }
  override eq(other: TextWidget) { return other.className === this.className && other.text === this.text; }
  toDOM() {
    const element = window.document.createElement("div");
    element.className = this.className;
    element.textContent = this.text;
    return element;
  }
}

class FoldWidget extends WidgetType {
  // The document never changes, so where the fold starts names it for good.
  constructor(readonly from: number, readonly count: number) { super(); }
  override eq(other: FoldWidget) { return other.from === this.from && other.count === this.count; }
  toDOM(view: EditorView) {
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "cm-diff-fold";
    button.textContent = `Show ${this.count.toLocaleString()} unchanged ${this.count === 1 ? "line" : "lines"}`;
    button.addEventListener("click", () => {
      view.dispatch({ effects: unfold.of(this.from) });
    });
    return button;
  }
}

/**
 * A place for React content between lines. The editor may draw a widget again
 * at any time, so the React-owned element moves into each new wrapper.
 */
class SlotWidget extends WidgetType {
  constructor(readonly key: string, readonly element: HTMLElement) { super(); }
  override eq(other: SlotWidget) { return other.key === this.key && other.element === this.element; }
  toDOM() {
    const wrapper = window.document.createElement("div");
    wrapper.className = "cm-diff-slot";
    wrapper.append(this.element);
    return wrapper;
  }
  override updateDOM(dom: HTMLElement) {
    if (this.element.parentElement !== dom) dom.replaceChildren(this.element);
    return true;
  }
  override get estimatedHeight() { return this.element.offsetHeight || 96; }
}

class NumbersMarker extends GutterMarker {
  constructor(readonly line: number, readonly old: string, readonly next: string, readonly sign: string) { super(); }
  override eq(other: NumbersMarker) { return other.line === this.line && other.old === this.old && other.next === this.next && other.sign === this.sign; }
  override toDOM() {
    const element = window.document.createElement("span");
    element.className = "cm-diff-numbers-cell";
    // The width spacer is not a line, so it names none.
    if (this.line >= 0) element.dataset["line"] = String(this.line);
    for (const [className, text] of [["cm-diff-old", this.old], ["cm-diff-new", this.next], ["cm-diff-sign", this.sign]] as const) {
      const part = window.document.createElement("span");
      part.className = className;
      part.textContent = text;
      element.append(part);
    }
    return element;
  }
}

class LineClassMarker extends GutterMarker {
  constructor(className: string) { super(); this.elementClass = className; }
}
const gutterClasses = {
  add: new LineClassMarker("cm-diff-add"),
  remove: new LineClassMarker("cm-diff-remove"),
  noted: new LineClassMarker("cm-diff-noted"),
  selected: new LineClassMarker("cm-diff-selected"),
};

function numbersGutter(document: DiffDocument, onTapLine: (line: number) => void) {
  const markers = document.lines.map((line, index) => new NumbersMarker(index,
    line.kind === "add" ? "" : String(line.oldLineNumber),
    line.kind === "remove" ? "" : String(line.newLineNumber),
    line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""));
  const widest = String(document.lines.reduce((most, line) => Math.max(most, "oldLineNumber" in line ? line.oldLineNumber : 0, "newLineNumber" in line ? line.newLineNumber : 0), 0));
  return gutter({
    class: "cm-diff-numbers",
    lineMarker: (view, block) => markers[view.state.doc.lineAt(block.from).number - 1] ?? null,
    initialSpacer: () => new NumbersMarker(-1, widest, widest, "+"),
    domEventHandlers: {
      // The cell names its line. Below the numbers of a wrapped line, the line under the tap counts.
      click: (view, block, event) => {
        const named = (event.target as Element | null)?.closest<HTMLElement>("[data-line]")?.dataset["line"];
        onTapLine(named === undefined ? view.state.doc.lineAt(block.from).number - 1 : Number(named));
        return true;
      },
    },
  });
}

/** Kind, note, and selection reach the numbers too, so a line and its numbers read as one row. */
function lineClassGutter(document: DiffDocument) {
  return gutterLineClass.compute([marksField], (state) => {
    const { selected, covered } = state.field(marksField);
    const ranges: Range<GutterMarker>[] = [];
    document.lines.forEach((line, index) => {
      if (index >= state.doc.lines) return;
      const from = state.doc.line(index + 1).from;
      if (line.kind === "add") ranges.push(gutterClasses.add.range(from));
      if (line.kind === "remove") ranges.push(gutterClasses.remove.range(from));
      if (covered.has(index)) ranges.push(gutterClasses.noted.range(from));
      if (selected && index >= selected[0] && index <= selected[1]) ranges.push(gutterClasses.selected.range(from));
    });
    return RangeSet.of(ranges, true);
  });
}

function createState(document: DiffDocument, path: string, hintId: string, props: { current: DiffEditorProps }, keep: ReadonlySet<number>) {
  let pointer = "mouse";
  const lineOf = (state: EditorState, position: number) => state.doc.lineAt(position).number - 1;
  const doc = Text.of(document.lines.length > 0 ? document.lines.map((line) => line.text) : [""]);
  return EditorState.create({
    doc,
    extensions: [
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      drawSelection(),
      EditorView.contentAttributes.of({
        "aria-label": `Changes in ${path}`, "aria-readonly": "true", "aria-describedby": hintId,
        // Read-only text needs a caret, not a keyboard that covers the lines.
        inputmode: "none",
      }),
      numbersGutter(document, (line) => props.current.onTapLine(line)),
      lineClassGutter(document),
      EditorView.decorations.of(staticDecorations(document, doc)),
      foldField(document, keep),
      tokensField,
      marksField,
      markDecorations,
      Prec.high(keymap.of([{ key: "Enter", run: (view) => {
        const { anchor, head } = view.state.selection.main;
        props.current.onSelectLines({ anchor: lineOf(view.state, anchor), focus: lineOf(view.state, head) });
        return true;
      } }])),
      keymap.of(defaultKeymap),
      EditorView.domEventHandlers({
        pointerdown: (event) => { pointer = event.pointerType; return false; },
        // A finger tap on the text picks the line, as on the numbers. A mouse click places the caret, as in an editor.
        click: (event, view) => {
          if (pointer !== "touch") return false;
          const text = window.getSelection?.();
          if (text && !text.isCollapsed) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position !== null) props.current.onTapLine(lineOf(view.state, position));
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || !update.view.hasFocus) return;
        const before = lineOf(update.startState, update.startState.selection.main.head);
        const after = lineOf(update.state, update.state.selection.main.head);
        const line = document.lines[after];
        if (before === after || !line) return;
        // A screen reader reads the text of the line; this says what kind of line it is.
        setTimeout(() => update.view.dispatch({ effects: EditorView.announce.of(lineWords(line)) }), 0);
      }),
    ],
  });
}
