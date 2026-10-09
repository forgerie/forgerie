import { useLayoutEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useAui, useAuiState, unstable_useTriggerPopoverAriaProps, unstable_useTriggerPopoverRootContext } from "@assistant-ui/react";
import { flushTapSync } from "@assistant-ui/tap";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import { indentOnInput, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type ChangeSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { codeHighlighter } from "./codeTokens";
import { completeComposerCodeFence, composerCodeBlock, leaveComposerCodeBlock, protectComposerCodeBlockBoundary } from "./composerCodeBlock";
import { composerMarkup, composerMarkupLineStart, deleteComposerMarkup } from "./composerMarkup";
import { composerMarkdown, continueMarkup, deleteMarkup, loadMarkdownEditing } from "./composerCodeLanguage";

/**
 * The composer's editable element. It is CodeMirror's content element, with
 * the small form-control surface the bar, its tests, and its browser checks
 * use: the draft's Markdown as `value`, a selection, and the editor commands
 * that have no textarea equivalent.
 */
export interface ComposerInputElement extends HTMLElement {
  /** The draft as canonical Markdown. Setting it is a user edit: it reaches the composer and the undo history. */
  value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly disabled: boolean;
  readonly placeholder: string;
  setSelectionRange(start: number, end: number): void;
  select(): void;
  /** Replaces the whole draft and selection as one undoable step. */
  replace(text: string, start: number, end: number): void;
  /** The editor's newline: closes a typed fence, continues a list or quote, or keeps indentation. */
  insertNewline(): void;
  /** Whether an empty selection sits on the draft's first or last drawn line. */
  atEdgeLine(edge: "top" | "bottom"): boolean;
  /** Whether the caret sits on a list item or quote line, outside code. Enter continues that line instead of sending. */
  onMarkupLine(): boolean;
}

export interface ComposerEditorProps {
  /** Receives the input element while it is mounted. */
  inputRef: RefObject<ComposerInputElement | null>;
  className: string;
  label: string;
  placeholder: string;
  describedBy?: string | undefined;
  keyShortcuts?: string | undefined;
  enterKeyHint?: "send" | "next" | undefined;
  /** Prose gets spelling, correction, and capitals. A shell command gets none. */
  prose?: boolean;
  /** Typing stops growing the draft at this length. A change from outside the editor, such as dictation, may still pass it. */
  maxLength?: number | undefined;
  disabled?: boolean | undefined;
  /** Runs before every editor key binding. Call `preventDefault` to claim the key. */
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  /** The user changed the text. Text set through the composer does not count. */
  onEdit?: () => void;
  /** The text or selection moved, other than by a change from the composer. */
  onSelectionChange?: () => void;
}

/** Marks a transaction that copies the composer's text into the editor. */
const fromComposer = Annotation.define<boolean>();
/** Marks a host's own replacement, such as recall: it reaches the composer but is not the user typing. */
const fromHost = Annotation.define<boolean>();

/**
 * System atom: the bar's input, a CodeMirror editor bound to the assistant-ui
 * composer. The composer's text stays canonical Markdown; complete code fences
 * read as highlighted blocks. The editor owns editing keys, undo, and the
 * caret. The host owns sending and every key it claims in `onKeyDown`.
 */
export function ComposerEditor(props: ComposerEditorProps) {
  const aui = useAui();
  const value = useAuiState((s) => (s.composer.isEditing ? s.composer.text : ""));
  const disabled = useAuiState((s) => s.thread.isDisabled || s.composer.dictation?.inputDisabled === true) || props.disabled === true;
  const aria = unstable_useTriggerPopoverAriaProps();
  const triggers = unstable_useTriggerPopoverRootContext();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const latest = useRef({ props, triggers });
  latest.current = { props, triggers };
  const compartments = useRef<{ editable: Compartment; attributes: Compartment; placeholder: Compartment; language: Compartment; markup: Compartment }>(undefined);
  compartments.current ??= { editable: new Compartment(), attributes: new Compartment(), placeholder: new Compartment(), language: new Compartment(), markup: new Compartment() };
  const { inputRef } = props;

  const prose = props.prose !== false;
  const attributes: Record<string, string> = {
    "data-composer-input": "", "aria-label": props.label,
    spellcheck: String(prose), autocorrect: prose ? "on" : "off", autocapitalize: prose ? "sentences" : "off",
    ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}),
    ...(props.keyShortcuts ? { "aria-keyshortcuts": props.keyShortcuts } : {}),
    ...(props.enterKeyHint ? { enterkeyhint: props.enterKeyHint } : {}),
    ...(disabled ? { "aria-disabled": "true" } : {}),
    ...Object.fromEntries(Object.entries(aria).filter((entry): entry is [string, string | true] => entry[1] !== undefined)
      .map(([name, attribute]) => [name, String(attribute)])),
  };
  const attributesKey = JSON.stringify(attributes);

  useLayoutEffect(() => {
    const parent = host.current;
    const parts = compartments.current;
    if (!parent || !parts) return;
    const broadcast = (editor: EditorView) => {
      const position = editor.state.selection.main.head;
      for (const trigger of latest.current.triggers.getTriggers().values()) trigger.resource.setCursorPosition(position);
      latest.current.props.onSelectionChange?.();
    };
    const created: EditorView = new EditorView({
      parent,
      // Always the document: the bar is never in a shadow root, and test DOMs misreport the root node.
      root: document,
      state: EditorState.create({
        doc: value,
        selection: EditorSelection.cursor(value.length),
        extensions: [
          history(),
          parts.language.of(composerMarkdown()),
          composerCodeBlock(),
          // A shell command is not Markdown: its `-` and `>` stay as typed.
          parts.markup.of(prose ? composerMarkup() : []),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(codeHighlighter),
          EditorView.lineWrapping,
          EditorView.perLineTextDirection.of(true),
          parts.editable.of(editability(disabled)),
          parts.attributes.of(EditorView.contentAttributes.of(attributes)),
          parts.placeholder.of(placeholderText(props.placeholder)),
          EditorState.transactionFilter.of((transaction) => {
            const max = latest.current.props.maxLength;
            if (max === undefined || !transaction.docChanged || transaction.annotation(fromComposer)) return transaction;
            return transaction.newDoc.length > max && transaction.newDoc.length > transaction.startState.doc.length ? [] : transaction;
          }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.length === 0 || !aui.thread.getState().capabilities.attachments) return false;
              event.preventDefault();
              // The composer reports a failed file itself, before it rejects.
              for (const file of files) void aui.composer.addAttachment(file).catch(() => undefined);
              return true;
            },
            // Dropped files are attachments: the drop zone around the bar takes them, not the text.
            drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0,
            keyup: (event) => { latest.current.props.onKeyUp?.(event); return false; },
            blur: () => { latest.current.props.onBlur?.(); return false; },
            compositionstart: () => { latest.current.props.onCompositionStart?.(); return false; },
            compositionend: (_event, editor) => {
              latest.current.props.onCompositionEnd?.();
              queueMicrotask(() => { if (!editor.composing) broadcast(editor); });
              return false;
            },
          }),
          // The host's key handler changes composer state outside a React event.
          // React flushes a handler's updates before the work it awaits, so this does too.
          Prec.highest(keymap.of([{ any: (_editor, event) => {
            flushSync(() => { latest.current.props.onKeyDown(event); });
            return event.defaultPrevented;
          } }])),
          keymap.of([
            { key: "Enter", run: insertComposerNewline, shift: insertComposerNewline },
            { key: "ArrowDown", run: leaveComposerCodeBlock },
            { key: "Tab", run: indentMore, shift: indentLess },
            { key: "Home", run: composerMarkupLineStart },
            { key: "Backspace", run: (editor) => protectComposerCodeBlockBoundary(editor, "backward") || deleteComposerMarkup(editor) || deleteMarkup(editor) },
            { key: "Delete", run: (editor) => protectComposerCodeBlockBoundary(editor, "forward") },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.transactions.some((transaction) => transaction.annotation(fromComposer))) return;
            if (update.docChanged && aui.composer.getState().isEditing) {
              const text = update.state.doc.toString();
              flushTapSync(() => { aui.composer.setText(text); });
              if (!update.transactions.some((transaction) => transaction.annotation(fromHost))) latest.current.props.onEdit?.();
            }
            if ((update.docChanged || update.selectionSet) && !update.view.composing) broadcast(update.view);
          }),
        ],
      }),
    });
    view.current = created;
    inputRef.current = bindInput(created, () => latest.current.props.placeholder);
    let alive = true;
    void loadMarkdownEditing().then((support) => {
      if (alive) created.dispatch({ effects: parts.language.reconfigure(support) });
    }, () => undefined);
    return () => {
      alive = false;
      inputRef.current = null;
      view.current = undefined;
      created.destroy();
    };
    // The editor lives as long as the bar. Later prop changes reconfigure it below.
  }, []);

  useLayoutEffect(() => {
    const editor = view.current;
    const parts = compartments.current;
    if (!editor || !parts) return;
    editor.dispatch({ effects: [
      parts.editable.reconfigure(editability(disabled)),
      parts.attributes.reconfigure(EditorView.contentAttributes.of(JSON.parse(attributesKey) as Record<string, string>)),
      parts.placeholder.reconfigure(placeholderText(props.placeholder)),
      parts.markup.reconfigure(prose ? composerMarkup() : []),
    ] });
  }, [disabled, attributesKey, props.placeholder, prose]);

  // The composer can change the text itself: recall, a chosen suggestion,
  // dictation, a restored draft. The editor takes the change as an edit, so
  // the caret and undo history follow it.
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    const change = minimalChange(current, value);
    const changes = editor.state.changes(change);
    const { main } = editor.state.selection;
    editor.dispatch({
      changes,
      // A caret inside the replaced text lands after the new text, as a textarea's would.
      selection: EditorSelection.range(changes.mapPos(main.anchor, 1), changes.mapPos(main.head, 1)),
      annotations: fromComposer.of(true),
    });
  }, [value]);

  return <div ref={host} className={props.className} />;
}

function editability(disabled: boolean) {
  return [EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)];
}

/** The legacy newline chain: a typed fence closes, Markdown markup continues, or indentation carries. */
export function insertComposerNewline(view: EditorView): boolean {
  return completeComposerCodeFence(view) || continueMarkup(view) || insertNewlineAndIndent(view);
}

function minimalChange(from: string, to: string): ChangeSpec {
  const limit = Math.min(from.length, to.length);
  let start = 0;
  while (start < limit && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (end < limit - start && from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

function clamp(view: EditorView, position: number): number {
  return Math.max(0, Math.min(position, view.state.doc.length));
}

function bindInput(view: EditorView, placeholder: () => string): ComposerInputElement {
  const element = view.contentDOM;
  const setSelection = (start: number, end: number) => view.dispatch({ selection: EditorSelection.range(clamp(view, start), clamp(view, end)) });
  Object.defineProperties(element, {
    value: {
      configurable: true,
      get: () => view.state.doc.toString(),
      set: (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length), userEvent: "input" }),
    },
    selectionStart: { configurable: true, get: () => view.state.selection.main.from },
    selectionEnd: { configurable: true, get: () => view.state.selection.main.to },
    disabled: { configurable: true, get: () => !view.state.facet(EditorView.editable) },
    placeholder: { configurable: true, get: placeholder },
    setSelectionRange: { configurable: true, value: setSelection },
    select: { configurable: true, value: () => setSelection(0, view.state.doc.length) },
    replace: {
      configurable: true,
      value: (text: string, start: number, end: number) => view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.range(Math.min(start, text.length), Math.min(end, text.length)),
        scrollIntoView: true,
        annotations: fromHost.of(true),
      }),
    },
    insertNewline: { configurable: true, value: () => { insertComposerNewline(view); } },
    atEdgeLine: { configurable: true, value: (edge: "top" | "bottom") => atEdgeLine(view, edge) },
    onMarkupLine: { configurable: true, value: () => onMarkupLine(view) },
  });
  return element as ComposerInputElement;
}

/** A bullet (`-`, `*`, `+`), a numbered item (`1.`, `1)`), or a quote (`>`), with or without text after it. */
const MARKUP_LINE = /^\s*(?:>|(?:[-*+]|\d{1,9}[.)])(?:\s|$))/u;

/**
 * Reads the line, not the Markdown commands: those load lazily, and Enter on a
 * list line must not send while they load. The syntax tree is there from the
 * start, so a list-shaped line inside a code block still sends.
 */
function onMarkupLine(view: EditorView): boolean {
  const { main } = view.state.selection;
  if (!main.empty || !MARKUP_LINE.test(view.state.doc.lineAt(main.head).text)) return false;
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(main.head, -1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return false;
  }
  return true;
}

/** Ported from the legacy client's isOnPromptBoundaryLine: the caret's drawn line, not only the text line. */
function atEdgeLine(view: EditorView, edge: "top" | "bottom"): boolean {
  const { main } = view.state.selection;
  if (!main.empty) return false;
  const line = view.state.doc.lineAt(main.head);
  if (edge === "top" ? line.number !== 1 : line.number !== view.state.doc.lines) return false;
  const caret = view.coordsAtPos(main.head);
  const boundary = view.coordsAtPos(edge === "top" ? line.from : line.to);
  if (!caret || !boundary) return true;
  return Math.abs((edge === "top" ? caret.top : caret.bottom) - (edge === "top" ? boundary.top : boundary.bottom)) < 1;
}
