import { useState } from "react";
import { CodeEditor } from "./CodeEditor";

export const name = "Code editor";
export const note = "An editable file with line numbers and syntax colour";

const VALIDATE = "export function validPassword(password: string): boolean {\n  return password.length > 0;\n}\n";
const README = "# Acme sign-in\n\nThe sign-in form and the SSO callback share one validator.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n";

export default function TypeScript() {
  const [saved, setSaved] = useState(VALIDATE);
  const [text, setText] = useState(VALIDATE);
  return <div>
    <p aria-live="polite">{text === saved ? "Saved" : "Unsaved edits"}</p>
    <CodeEditor label="Edit src/auth/validate.ts" fileName="validate.ts" text={VALIDATE} onChange={setText} onSave={() => setSaved(text)} />
  </div>;
}
export function Markdown() {
  return <CodeEditor label="Edit README.md" fileName="README.md" text={README} onChange={() => {}} onSave={() => {}} />;
}
export function ReadOnly() {
  return <CodeEditor label="Read README.md" fileName="README.md" text={README} readOnly onChange={() => {}} onSave={() => {}} />;
}
export function PlainText() {
  return <CodeEditor label="Edit notes.unknown" fileName="notes.unknown" text={"A file type with no known language stays plain.\n"} onChange={() => {}} onSave={() => {}} />;
}
const FRONT = "---\nschedule:\n  name: Nightly maintenance\n  at: 1am\n  timezone: America/Denver\n---\n\n# Nightly maintenance\n";
/** A line a parser refused, marked, with the caret on it. */
export function MarkedLine() {
  return <CodeEditor label="Edit nightly-maintenance.md" fileName="nightly-maintenance.md" text={FRONT} markLine={4} goToLine={4} onChange={() => {}} onSave={() => {}} />;
}
