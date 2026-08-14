// @vitest-environment happy-dom

import { undo, history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { abortComposerDraftDictation, beginComposerDraftDictation, commitComposerDraftDictationTranscript, composerDraftDictation, finishComposerDraftDictation, isComposerDraftDictationActive } from "./composerDraftDictation";

afterEach(() => {
  document.body.replaceChildren();
});

describe("composerDraftDictation", () => {
  it("replaces the captured selection with one ordinary undoable final transcript", () => {
    const view = createView("hello brave world");
    view.dispatch({ selection: EditorSelection.range(6, 11) });

    expect(beginComposerDraftDictation(view)).toBe(true);
    expect(commitComposerDraftDictationTranscript(view, "calm")).toBe(true);
    expect(finishComposerDraftDictation(view)).toBe(true);

    expect(view.state.doc.toString()).toBe("hello calm world");
    expect(view.state.selection.main.head).toBe(10);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello brave world");
  });

  it("adds phrase-boundary spaces only where document boundaries need them", () => {
    const middle = createView("helloworld");
    middle.dispatch({ selection: EditorSelection.cursor(5) });
    beginComposerDraftDictation(middle);
    commitComposerDraftDictationTranscript(middle, "calm");
    expect(middle.state.doc.toString()).toBe("hello calm world");

    const start = createView("world");
    start.dispatch({ selection: EditorSelection.cursor(0) });
    beginComposerDraftDictation(start);
    commitComposerDraftDictationTranscript(start, "hello");
    expect(start.state.doc.toString()).toBe("hello world");

    const punctuation = createView("Hello,world");
    punctuation.dispatch({ selection: EditorSelection.cursor(6) });
    beginComposerDraftDictation(punctuation);
    commitComposerDraftDictationTranscript(punctuation, "quiet");
    expect(punctuation.state.doc.toString()).toBe("Hello, quiet world");
  });

  it("blocks user document changes while active but permits the owned final commit", () => {
    const view = createView("keep this");
    view.dispatch({ selection: EditorSelection.range(0, 4) });
    beginComposerDraftDictation(view);

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "user edit" } });

    expect(view.state.doc.toString()).toBe("keep this");
    expect(isComposerDraftDictationActive(view.state)).toBe(true);
    expect(commitComposerDraftDictationTranscript(view, "   ")).toBe(false);
    expect(commitComposerDraftDictationTranscript(view, "save")).toBe(true);
    expect(view.state.doc.toString()).toBe("save this");
  });

  it("finish and abort release the lock without changing text or accepting late transcripts", () => {
    const finished = createView("unchanged");
    beginComposerDraftDictation(finished);
    expect(finishComposerDraftDictation(finished)).toBe(true);
    expect(commitComposerDraftDictationTranscript(finished, "late")).toBe(false);
    expect(finished.state.doc.toString()).toBe("unchanged");

    const aborted = createView("preserved");
    beginComposerDraftDictation(aborted);
    expect(abortComposerDraftDictation(aborted)).toBe(true);
    expect(commitComposerDraftDictationTranscript(aborted, "late")).toBe(false);
    expect(aborted.state.doc.toString()).toBe("preserved");
  });
});

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    root: document,
    state: EditorState.create({ doc, extensions: [history(), composerDraftDictation()] }),
  });
}
