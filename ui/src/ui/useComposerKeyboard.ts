import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { createPromptHistory, promptHistoryEntries, recallPrompt, type PromptSnapshot } from "../promptHistory";
import type { DoubleEscapeAction } from "../contracts";
import type { ComposerInputElement } from "./ComposerEditor";

/** A background composer must never take keys from the foreground dialog. */
export function composerShortcutTarget(input: HTMLElement | null, event: KeyboardEvent): boolean {
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
export function useComposerKeyboard(input: RefObject<ComposerInputElement | null>, session?: ComposerSessionKeys) {
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages);
  const text = useAuiState((state) => state.composer.text);
  const entries = useMemo(() => promptHistoryEntries(messages), [messages]);
  const history = useRef(createPromptHistory());
  const appliedText = useRef<string | undefined>(undefined);
  const heldShift = useRef(false);
  const hardwareShiftSeen = useRef(false);
  const composing = useRef(false);
  const escapePress = useRef<{ at: number; action: Exclude<DoubleEscapeAction, "none"> } | undefined>(undefined);
  const resetEscape = useCallback(() => { escapePress.current = undefined; }, []);
  useLayoutEffect(resetEscape, [resetEscape, text, session !== undefined, session?.doubleEscapeAction, session?.onStop === undefined]);

  // A change from outside the editor, such as dictation, ends browsing.
  useLayoutEffect(() => {
    if (history.current.position.type === "entry" && appliedText.current !== text) history.current = createPromptHistory();
  }, [text]);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (!composerShortcutTarget(input.current, event) || !event.ctrlKey || !event.altKey || event.shiftKey || event.key.toLowerCase() !== "i" || input.current?.disabled) return;
      event.preventDefault();
      input.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [input]);

  function replace(next: PromptSnapshot) {
    appliedText.current = next.text;
    if (input.current) input.current.replace(next.text, next.start, next.end);
    else aui.composer.setText(next.text);
  }
  function enterShift(event: KeyboardEvent): boolean {
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
  function recall(event: KeyboardEvent, enabled: boolean): boolean {
    const node = input.current;
    if (!enabled || !node || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return false;
    const older = event.key === "ArrowUp";
    const browsing = history.current.position.type === "entry";
    // As in the legacy editor: a draft leaves for history only from its start;
    // a recalled prompt leaves from its first or last drawn line.
    if (node.selectionStart !== node.selectionEnd || !older && !browsing) return false;
    if (older && !browsing && node.value.length > 0 && node.selectionStart !== 0) return false;
    if (!node.atEdgeLine(older ? "top" : "bottom")) return false;
    const state = browsing ? history.current : createPromptHistory(entries);
    const next = recallPrompt(state, older ? "older" : "newer", { text: node.value, start: node.selectionStart, end: node.selectionEnd });
    if (!next) return false;
    event.preventDefault();
    history.current = next.state;
    replace(next.editor);
    return true;
  }
  function insertNewline(event: KeyboardEvent) {
    event.preventDefault();
    history.current = createPromptHistory();
    input.current?.insertNewline();
  }
  function escape(event: KeyboardEvent, route: "chat" | "shell" | "answer" | "attachments", session?: ComposerSessionKeys): boolean {
    if (event.key !== "Escape") return false;
    if (!composerShortcutTarget(input.current, event) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || route === "answer" || route === "attachments") {
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
    isComposing: (event: KeyboardEvent) => composing.current || event.isComposing || event.keyCode === 229,
    onChange: () => { resetEscape(); history.current = createPromptHistory(); },
    onKeyUp: (event: KeyboardEvent) => { if (event.key === "Shift") heldShift.current = false; },
    onBlur: () => { resetEscape(); heldShift.current = false; composing.current = false; },
    onCompositionStart: () => { resetEscape(); composing.current = true; },
    onCompositionEnd: () => { composing.current = false; },
  };
}
