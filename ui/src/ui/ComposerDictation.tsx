import { AuiIf, ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { MicIcon, SquareIcon, XIcon } from "lucide-react";
import { useDictation } from "../DictationProvider";

/** Forgerie voice controls use the SDK's dictation primitives, in the one input bar. */
export function ComposerDictation({ disabled }: { disabled: boolean }) {
  const aui = useAui();
  const { state, cancel } = useDictation();
  const active = useAuiState((s) => s.composer.dictation != null);
  const pending = state.type === "transcribing";
  const stop = () => { cancel(); aui.composer.stopDictation(); };
  return <div className="composer-dictation">
    <AuiIf condition={(s) => s.composer.dictation == null}>
      <ComposerPrimitive.Dictate type="button" disabled={disabled} className="icon-button quiet-button"
        aria-label="Voice input" title="Voice input"><MicIcon aria-hidden size={16} /></ComposerPrimitive.Dictate>
    </AuiIf>
    <AuiIf condition={(s) => s.composer.dictation != null}>
      <ComposerPrimitive.StopDictation type="button" disabled={pending} className="icon-button quiet-button"
        aria-label="Stop dictation" title="Stop dictation"><SquareIcon aria-hidden size={14} /></ComposerPrimitive.StopDictation>
      <button type="button" className="icon-button quiet-button" onClick={stop}
        aria-label="Cancel dictation" title="Cancel dictation"><XIcon aria-hidden size={16} /></button>
    </AuiIf>
    {active && <span className="dictation-status" role="status" title={pending ? "Transcribing…" : state.type === "starting" ? "Starting microphone…" : "Listening…"}>
      {pending ? "Transcribing…" : state.type === "starting" ? "Starting microphone…" : "Listening…"}
    </span>}
  </div>;
}
