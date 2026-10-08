import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { createPromptHistory, promptHistoryEntries, recallPrompt, type PromptSnapshot } from "../promptHistory";
import type { DoubleEscapeAction } from "../contracts";

/** A background composer must never take keys from the foreground dialog. */
export function composerShortcutTarget(input: HTMLElement | null, event: globalThis.KeyboardEvent): boolean {
  if (!input?.isConnected || event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.getModifierState("AltGraph")) return false;
  const modal = [...document.querySelectorAll("dialog[open]")].at(-1);
  return !modal || modal.contains(input);
}

/** Session actions use the same command and Stop paths as their visible controls. */
export interface ComposerSessionKeys {
  doubleEscapeAction?: DoubleEscapeAction | undefined;
  onDoubleEscapeAction: (action: Exclude<DoubleEscapeAction, "none">) => void;
  onStop?: (() => void) | undefined;
}

/** Shared input behavior. The host still owns Enter routing and suggestion precedence. */
export function useComposerKeyboard(input: RefObject<HTMLTextAreaElement | null>, session?: ComposerSessionKeys) {
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages);
  const text = useAuiState((state) => state.composer.text);
  const entries = useMemo(() => promptHistoryEntries(messages), [messages]);
  const history = useRef(createPromptHistory());
  const selection = useRef<PromptSnapshot | undefined>(undefined);
  const appliedText = useRef<string | undefined>(undefined);
  const heldShift = useRef(false);
  const hardwareShiftSeen = useRef(false);
  const composing = useRef(false);
  const escapePress = useRef<{ at: number; action: Exclude<DoubleEscapeAction, "none"> } | undefined>(undefined);
  const resetEscape = useCallback(() => { escapePress.current = undefined; }, []);
  useLayoutEffect(resetEscape, [resetEscape, text, session !== undefined, session?.doubleEscapeAction, session?.onStop === undefined]);

  useLayoutEffect(() => {
    if (history.current.position.type === "entry" && appliedText.current !== text) history.current = createPromptHistory();
    const pending = selection.current;
    if (pending && pending.text === text && input.current) {
      input.current.setSelectionRange(pending.start, pending.end);
      selection.current = undefined;
    } else if (pending && pending.text !== text) selection.current = undefined;
  }, [text, input]);

  useEffect(() => {
    const focus = (event: globalThis.KeyboardEvent) => {
      if (!composerShortcutTarget(input.current, event) || !event.ctrlKey || !event.altKey || event.shiftKey || event.key.toLowerCase() !== "i" || input.current?.disabled) return;
      event.preventDefault();
      input.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [input]);

  function replace(next: PromptSnapshot) {
    appliedText.current = next.text;
    selection.current = next;
    aui.composer.setText(next.text);
    // No render is needed when two entries have the same text.
    if (input.current?.value === next.text) {
      input.current.setSelectionRange(next.start, next.end);
      selection.current = undefined;
    }
  }
  function enterShift(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (event.key !== "Escape") resetEscape();
    if (event.key === "Shift") { heldShift.current = true; hardwareShiftSeen.current = true; }
    if (event.key !== "Enter") {
      if (!event.shiftKey && !["Shift", "Unidentified", "Process"].includes(event.key)) heldShift.current = false;
      return event.shiftKey;
    }
    // On-screen autocapitalization can report Shift on Enter. A physical Shift
    // remains evidence when an Android IME strips the modifier from Enter.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const shift = heldShift.current || event.shiftKey && (event.ctrlKey || event.metaKey || !touch || hardwareShiftSeen.current);
    heldShift.current = false;
    return shift;
  }
  function recall(event: KeyboardEvent<HTMLTextAreaElement>, enabled: boolean): boolean {
    if (!enabled || !input.current || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return false;
    const node = input.current;
    const state = history.current.position.type === "draft" ? createPromptHistory(entries) : history.current;
    // The textarea does not expose visual-line coordinates. Use document edges,
    // so wrapped lines always keep their native caret movement.
    if (event.key === "ArrowUp" && node.selectionStart !== 0 || event.key === "ArrowDown" && node.selectionEnd !== node.value.length) return false;
    const next = recallPrompt(state, event.key === "ArrowUp" ? "older" : "newer", { text: node.value, start: node.selectionStart, end: node.selectionEnd });
    if (!next) return false;
    event.preventDefault();
    history.current = next.state;
    replace(next.editor);
    return true;
  }
  function insertNewline(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const node = event.currentTarget;
    const next = node.value.slice(0, node.selectionStart) + "\n" + node.value.slice(node.selectionEnd);
    history.current = createPromptHistory();
    replace({ text: next, start: node.selectionStart + 1, end: node.selectionStart + 1 });
  }
  function escape(event: KeyboardEvent<HTMLTextAreaElement>, route: "chat" | "shell" | "answer" | "attachments", session?: ComposerSessionKeys): boolean {
    if (event.key !== "Escape") return false;
    if (!composerShortcutTarget(input.current, event.nativeEvent) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || route === "answer" || route === "attachments") {
      resetEscape(); return false;
    }
    const empty = input.current?.value.trim() === "";
    // Keep the new client's draft protection. Stop does not consume a typed
    // message, and a shell draft clears before it can arm the idle gesture.
    const stop = session?.onStop ?? (aui.composer.getState().canCancel ? () => aui.composer.cancel() : undefined);
    if (empty && stop) { resetEscape(); event.preventDefault(); stop(); return true; }
    if (route === "shell") { resetEscape(); event.preventDefault(); aui.composer.setText(""); return true; }
    if (!empty || stop || !session) { resetEscape(); return false; }
    event.preventDefault();
    const action = session.doubleEscapeAction ?? "tree";
    if (action === "none") { resetEscape(); return true; }
    const previous = escapePress.current;
    const now = Date.now();
    if (previous?.action === action && now - previous.at >= 0 && now - previous.at < 500) {
      resetEscape(); session.onDoubleEscapeAction(action);
    } else escapePress.current = { at: now, action };
    return true;
  }
  return { enterShift, recall, insertNewline, escape, resetEscape,
    isComposing: (event: KeyboardEvent<HTMLTextAreaElement>) => composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
    onChange: () => { resetEscape(); history.current = createPromptHistory(); selection.current = undefined; },
    onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Shift") heldShift.current = false; },
    onBlur: () => { resetEscape(); heldShift.current = false; composing.current = false; },
    onCompositionStart: () => { resetEscape(); composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
  };
}
