import { HeaderButton } from "./HeaderButton";
import { TextButton } from "./TextButton";
import { SettingsInput } from "./settings/SettingsInput";
import "./SecretEdit.css";

interface SecretAction { label: string; disabled: boolean; onPress: () => void }

/** A write-only password draft with a public readout and separate save/remove actions.
 * Input and actions stack; actions wrap together with their container, never disappear.
 */
export function SecretEdit({ label, status, value, disabled, onChange, save, remove }: {
  label: string; status: string; value: string; disabled: boolean; onChange: (value: string) => void;
  save: SecretAction; remove: SecretAction;
}) {
  return <div className="secret-edit" role="group" aria-label={label}>
    <span className="secret-edit-status" role="status">{status}</span>
    <div className="secret-edit-input" onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (!save.disabled) save.onPress(); }
    }}><SettingsInput type="password" label={label} value={value} disabled={disabled} onChange={onChange} /></div>
    <div className="secret-edit-actions">
      <HeaderButton label={save.label} disabled={save.disabled} onPress={save.onPress} />
      <TextButton label={remove.label} disabled={remove.disabled} onPress={remove.onPress} />
    </div>
  </div>;
}
