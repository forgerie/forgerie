/** System atom: the switch used by settings property rows. */
export function SettingsToggle({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <button type="button" className="agent-switch" role="switch" aria-label={label} aria-checked={checked}
    disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}
