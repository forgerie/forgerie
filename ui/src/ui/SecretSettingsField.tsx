import { useEffect, useState } from "react";
import { SettingsField } from "./settings/SettingsField";
import { SecretEdit } from "./SecretEdit";

type Action = { type: "idle" | "saving" | "removing" } | { type: "failed"; message: string };

export interface SecretFieldStatus { present: boolean; editable: boolean; value: string; hint: string }

/** A write-only settings field with injected reads and writes. Failed responses never reach the UI. */
export function SecretSettingsField<T>({ label, read, write, clear: removeValue, describe, busy, failure }: {
  label: string; read: (signal?: AbortSignal) => Promise<T>; write: (value: string) => Promise<T>; clear: () => Promise<T>;
  describe: (value: T | undefined) => SecretFieldStatus; busy: boolean; failure: (clear: boolean) => string;
}) {
  const [status, setStatus] = useState<{ type: "checking" | "unavailable" } | { type: "ready"; value: T }>({ type: "checking" });
  const [draft, setDraft] = useState("");
  const [action, setAction] = useState<Action>({ type: "idle" });
  useEffect(() => {
    const controller = new AbortController();
    read(controller.signal).then(value => { if (!controller.signal.aborted) setStatus({ type: "ready", value }); })
      .catch(() => { if (!controller.signal.aborted) setStatus({ type: "unavailable" }); });
    return () => controller.abort();
  }, [read]);
  const view = describe(status.type === "ready" ? status.value : undefined);
  const pending = action.type === "saving" || action.type === "removing";
  const disabled = busy || pending || !view.editable;
  async function change(clear: boolean) {
    if (disabled || (!clear && !draft.trim())) return;
    setAction({ type: clear ? "removing" : "saving" });
    const key = draft;
    setDraft("");
    try {
      setStatus({ type: "ready", value: await (clear ? removeValue() : write(key)) });
      setAction({ type: "idle" });
    } catch {
      setAction({ type: "failed", message: failure(clear) });
      try { setStatus({ type: "ready", value: await read() }); } catch { setStatus({ type: "unavailable" }); }
    }
  }
  return <SettingsField label={label} hint={view.hint} hintTone="readable" problem={action.type === "failed" ? action.message : undefined}>
    <SecretEdit label={label} status={status.type === "checking" ? "Checking…" : view.value} value={draft} disabled={disabled} onChange={setDraft}
      save={{ label: action.type === "saving" ? "Saving…" : view.present ? "Replace" : "Save", disabled: disabled || !draft.trim(), onPress: () => void change(false) }}
      remove={{ label: action.type === "removing" ? "Removing…" : "Remove", disabled: disabled || !view.present, onPress: () => void change(true) }} />
  </SettingsField>;
}
