import { ChevronLeftIcon } from "lucide-react";
import "./BackButton.css";

/**
 * Atom: a page header's way back, named for where it goes. In a narrow
 * header it keeps only its chevron, and its name stays as the accessible name.
 */
export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <button type="button" className="back-button" aria-label={label} onClick={onPress}><ChevronLeftIcon aria-hidden size={16} /><span className="back-button-label">{label}</span></button>;
}
