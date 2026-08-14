import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface ComposerDraftDictationInactiveState {
  readonly active: false;
}

interface ComposerDraftDictationActiveState {
  readonly active: true;
  readonly selection: EditorSelection;
  readonly committed: boolean;
  readonly finalInsert: number;
}

type ComposerDraftDictationState = ComposerDraftDictationInactiveState | ComposerDraftDictationActiveState;

const inactiveState: ComposerDraftDictationInactiveState = { active: false };

const beginDictationEffect = StateEffect.define<EditorSelection>();
const transcriptCommittedEffect = StateEffect.define<{ finalInsert: number }>();
const finishDictationEffect = StateEffect.define();
const allowDictationChange = Annotation.define<boolean>();

const composerDraftDictationState = StateField.define<ComposerDraftDictationState>({
  create: () => inactiveState,
  update: (value, transaction) => {
    let next = value;
    if (next.active && !transaction.changes.empty) {
      next = {
        ...next,
        selection: next.selection.map(transaction.changes),
        finalInsert: transaction.changes.mapPos(next.finalInsert, 1),
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(beginDictationEffect)) {
        const selection = effect.value.asSingle();
        next = { active: true, selection, committed: false, finalInsert: selection.main.from };
      } else if (effect.is(transcriptCommittedEffect) && next.active) {
        next = { ...next, committed: true, finalInsert: effect.value.finalInsert };
      } else if (effect.is(finishDictationEffect)) {
        next = inactiveState;
      }
    }
    return next;
  },
});

export function composerDraftDictation(): Extension {
  return [
    composerDraftDictationState,
    EditorState.transactionFilter.of((transaction) => {
      const dictation = getActiveState(transaction.startState);
      if (dictation === undefined || !transaction.docChanged || transaction.annotation(allowDictationChange) === true) return transaction;
      return [];
    }),
  ];
}

export function beginComposerDraftDictation(view: EditorView): boolean {
  if (!hasComposerDraftDictation(view.state) || getActiveState(view.state) !== undefined) return false;
  view.dispatch({ effects: beginDictationEffect.of(view.state.selection.asSingle()) });
  return true;
}

export function commitComposerDraftDictationTranscript(view: EditorView, transcript: string): boolean {
  const dictation = getActiveState(view.state);
  if (dictation === undefined || dictation.committed || transcript.trim() === "") return false;

  const from = dictation.selection.main.from;
  const to = dictation.selection.main.to;
  const insert = phraseWithDocumentBoundary(view.state, from, to, transcript);
  const finalInsert = from + insert.length;

  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(finalInsert),
    effects: transcriptCommittedEffect.of({ finalInsert }),
    annotations: allowDictationChange.of(true),
  });
  return true;
}

export function finishComposerDraftDictation(view: EditorView): boolean {
  if (getActiveState(view.state) === undefined) return false;
  view.dispatch({ effects: finishDictationEffect.of(null) });
  return true;
}

export function abortComposerDraftDictation(view: EditorView): boolean {
  return finishComposerDraftDictation(view);
}

export function isComposerDraftDictationActive(state: EditorState): boolean {
  return getActiveState(state) !== undefined;
}

function hasComposerDraftDictation(state: EditorState): boolean {
  return state.field(composerDraftDictationState, false) !== undefined;
}

function getActiveState(state: EditorState): ComposerDraftDictationActiveState | undefined {
  const value = state.field(composerDraftDictationState, false);
  return value?.active === true ? value : undefined;
}

function phraseWithDocumentBoundary(state: EditorState, from: number, to: number, transcript: string): string {
  const before = from > 0 ? state.sliceDoc(from - 1, from) : "";
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : "";
  const prefix = needsBoundarySpaceBefore(before, transcript) ? " " : "";
  const withPrefix = `${prefix}${transcript}`;
  const suffix = needsBoundarySpaceAfter(withPrefix, after) ? " " : "";
  return `${withPrefix}${suffix}`;
}

function needsBoundarySpaceBefore(before: string, transcript: string): boolean {
  if (before === "" || transcript === "" || /^\s/u.test(transcript)) return false;
  return (isWordLike(before) || isClosingPunctuation(before)) && isWordLike(transcript[0] ?? "");
}

function needsBoundarySpaceAfter(insert: string, after: string): boolean {
  if (after === "" || insert === "" || /\s$/u.test(insert)) return false;
  return isWordLike(insert[insert.length - 1] ?? "") && isWordLike(after);
}

function isWordLike(value: string): boolean {
  return /^[\p{Letter}\p{Number}]$/u.test(value);
}

function isClosingPunctuation(value: string): boolean {
  return /^[,.;:!?)\]}]$/u.test(value);
}
