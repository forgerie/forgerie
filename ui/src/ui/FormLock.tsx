import type { ReactNode } from "react";
import "./FormLock.css";

/**
 * Atom: form controls that lock together, such as while a save is in flight,
 * so nothing typed during the request is lost when the answer replaces the
 * draft. A native fieldset: locked, every control inside it is disabled at
 * once, the ones a part added later too. It draws nothing of its own.
 */
export function FormLock({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <fieldset className="form-lock" disabled={locked}>{children}</fieldset>;
}
