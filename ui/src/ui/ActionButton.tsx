import "./ActionButton.css";
export function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <button className="action-button" type="button" disabled={disabled} onClick={onPress}>{label}</button>;
}
