import { useState } from "react";
import { SuggestionHeader } from "./SuggestionHeader";
export const name = "Suggestion header";
export default function Ready() {
  const [open, setOpen] = useState(true);
  return open ? <SuggestionHeader label="Folders" onDismiss={() => setOpen(false)} /> : <button type="button" onClick={() => setOpen(true)}>Show suggestions</button>;
}
