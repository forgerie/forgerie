import { useState } from "react";
import { TreeItem } from "./TreeItem";

export const name = "Tree item";
export const note = "One row of a file tree: a folder, a file with a mark, or a note about a folder";

const quiet = { onFocus: () => {}, onKeyDown: () => {} };

export default function Rows() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState("file:src/auth/LoginForm.tsx");
  const leaf = (rowKey: string, name: string, extra: Partial<Parameters<typeof TreeItem>[0]> = {}) =>
    <TreeItem {...quiet} rowKey={rowKey} level={2} kind="leaf" name={name} focusable={false}
      selected={selected === rowKey} onActivate={() => setSelected(rowKey)} {...extra} />;
  return <ul role="tree" aria-label="Files">
    <TreeItem {...quiet} rowKey="folder:src/auth" level={1} kind="branch" name="src/auth" expanded={open} focusable onActivate={() => setOpen(!open)} />
    {open && <>
      {leaf("file:src/auth/LoginForm.tsx", "LoginForm.tsx", { mark: "M", tone: "modify", count: 2, description: "Modified, 2 notes" })}
      {leaf("file:src/auth/LoginForm.test.tsx", "LoginForm.test.tsx", { mark: "A", tone: "add", description: "Added" })}
      {leaf("file:src/auth/session.ts", "session.ts", { mark: "D", tone: "remove", description: "Deleted" })}
      {leaf("file:src/auth/validate.ts", "validate.ts", { dot: true, description: "unsaved edits" })}
    </>}
  </ul>;
}
export function GroupAndNotes() {
  return <ul role="tree" aria-label="Files">
    <TreeItem {...quiet} rowKey="staged:" level={1} kind="group" name="Staged changes" expanded focusable onActivate={() => {}} />
    <TreeItem {...quiet} rowKey="note:loading:docs" level={2} kind="note" name="Reading the folder…" disabled focusable={false} onActivate={() => {}} />
    <TreeItem {...quiet} rowKey="note:failed:vendor" level={2} kind="note" name="Not read: Permission denied. Try again." focusable={false} onActivate={() => {}} />
    <TreeItem {...quiet} rowKey="file:vendor/sso-client/" level={2} kind="leaf" name="sso-client/" mark="U" tone="add" disabled focusable={false} onActivate={() => {}} />
  </ul>;
}
export function LongName() {
  return <ul role="tree" aria-label="Files">
    <TreeItem {...quiet} rowKey="file:long" level={4} kind="leaf" mark="C" tone="conflict" name="a-generated-module-with-a-very-long-name-that-cannot-fit.generated.ts"
      focusable onActivate={() => {}} />
  </ul>;
}
