import type { ReactNode } from "react";
import { TextButton } from "./TextButton";
import "./FieldEdit.css";

/** Molecule: a field with a plain edit marker and an action to restore its supplied value. */
export function FieldEdit({ children, reset }: { children: ReactNode; reset?: { label: string; title: string; onPress: () => void } | undefined }) {
  return <div className="field-edit">
    {children}
    {reset !== undefined && <div className="field-edit-note"><span>Edited</span><TextButton {...reset} /></div>}
  </div>;
}
