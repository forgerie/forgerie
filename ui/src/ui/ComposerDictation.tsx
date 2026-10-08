import { AuiIf, ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { MicIcon, SquareIcon, XIcon } from "lucide-react";
import { useDictation } from "../DictationProvider";
import { useEffect, useRef } from "react";
import { composerShortcutTarget } from "./useComposerKeyboard";

/** Forgerie voice controls use the SDK's dictation primitives, in the one input bar. */
export function ComposerDictation({ disabled }: { disabled: boolean }) {
  const aui = useAui();
  const { state, cancel } = useDictation();
  const active = useAuiState((s) => s.composer.dictation != null);
  const pending = state.type === "transcribing";
  const stop = () => { cancel(); aui.composer.stopDictation(); };
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      const form = root.current?.closest("form");
      const input = form?.querySelector("textarea");
      if (!composerShortcutTarget(input ?? null, event) || event.altKey || event.shiftKey) return;
      const cancelKey = event.key === "Escape" && !event.ctrlKey;
      if (!cancelKey && (!event.ctrlKey || event.code !== "Space" && event.key !== " ")) return;
      const target = event.target instanceof Element ? event.target : null;
      // Dictation cannot steal a search or an editor outside this composer.
      if (target?.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") && !form?.contains(target)) return;
      const button = root.current?.querySelector<HTMLButtonElement>(cancelKey ? '[aria-label="Cancel dictation"]' : '[aria-label="Voice input"], [aria-label="Stop dictation"]');
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    // Dictation owns Escape before the input's Stop and idle-tree handlers.
    window.addEventListener("keydown", toggle, true);
    return () => window.removeEventListener("keydown", toggle, true);
  }, []);
  return <div ref={root} className="composer-dictation">
    <AuiIf condition={(s) => s.composer.dictation == null}>
      <ComposerPrimitive.Dictate type="button" disabled={disabled} className="icon-button quiet-button"
        aria-label="Voice input" aria-keyshortcuts="Control+Space" title="Voice input. Ctrl+Space"><MicIcon aria-hidden size={16} /></ComposerPrimitive.Dictate>
    </AuiIf>
    <AuiIf condition={(s) => s.composer.dictation != null}>
      <ComposerPrimitive.StopDictation type="button" disabled={pending} className="icon-button quiet-button"
        aria-label="Stop dictation" aria-keyshortcuts="Control+Space" title="Stop dictation. Ctrl+Space"><SquareIcon aria-hidden size={14} /></ComposerPrimitive.StopDictation>
      <button type="button" className="icon-button quiet-button" onClick={stop}
        aria-label="Cancel dictation" aria-keyshortcuts="Escape" title="Cancel dictation. Escape"><XIcon aria-hidden size={16} /></button>
    </AuiIf>
    {active && <span className="dictation-status" role="status" title={pending ? "Transcribing…" : state.type === "starting" ? "Starting microphone…" : "Listening…"}>
      {pending ? "Transcribing…" : state.type === "starting" ? "Starting microphone…" : "Listening…"}
    </span>}
  </div>;
}
