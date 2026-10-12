import { useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { MarkdownEditor } from "./MarkdownEditor";
import { richEditability } from "./markdownFile";
import { loadMarkdownKit } from "./markdownKit";
import { MARKDOWN_WORDS } from "./useMarkdownView";

// Frames show the editor drawn, not the moment before Tiptap arrives.
await loadMarkdownKit();

export const name = "Markdown editor";
export const note = "A Markdown file formatted like a reply, edited in place";

const GUIDE = [
  "# Acme sign-in",
  "",
  "The sign-in form and the SSO callback share **one validator**, so a rule added here holds for both. Read [the SSO notes](docs/sso.md) before you change it.",
  "",
  "## Before you merge",
  "",
  "- [x] Refuse an empty password at the form",
  "- [ ] Cover a password of only spaces",
  "- [ ] Ask the SSO team about trimming",
  "",
  "## Develop",
  "",
  "1. Install the packages.",
  "2. Start the dev server and open `localhost:5173`.",
  "",
  "```sh",
  "npm install",
  "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
  "```",
  "",
  "> The callback calls `validPassword` directly. Keep it free of form state.",
  "",
].join("\n");

const SKILL = [
  "---",
  "name: testing-guide",
  "description: Repository-specific testing guide. Use when you add or change a test.",
  "allowed-tools: read bash",
  "---",
  "",
  "# Testing guide",
  "",
  "Run the narrowest test first, then the suite.",
  "",
  "## Rules",
  "",
  "- Name each test for the behaviour it proves.",
  "- Keep fixtures beside the test that reads them.",
  "",
].join("\n");

/** Saved and unsaved, the way a file bar would say it. */
function Stateful({ text, label }: { text: string; label: string }) {
  const [saved, setSaved] = useState(text);
  const [current, setCurrent] = useState(text);
  return <div>
    <p aria-live="polite">{current === saved ? "Saved" : "Unsaved edits"}</p>
    <MarkdownEditor label={label} text={text} onChange={setCurrent} onSave={() => setSaved(current)} />
  </div>;
}

export default function RichEditable() {
  return <Stateful label="Edit README.md" text={GUIDE} />;
}
export function FrontMatter() {
  return <Stateful label="Edit SKILL.md" text={SKILL} />;
}
export function Empty() {
  return <Stateful label="Edit NOTES.md" text="" />;
}
export function ReadOnly() {
  return <MarkdownEditor label="Read SKILL.md" text={SKILL} readOnly onChange={() => undefined} onSave={() => undefined} />;
}
export function ReadOnlyEmpty() {
  return <MarkdownEditor label="Read NOTES.md" text="" readOnly onChange={() => undefined} onSave={() => undefined} />;
}
const DECOMPOSITION = [
  "# Decomposition of the browser app",
  "",
  "This page is the project layer for three skills. Read them first:",
  "`~/.agents/skills/atomic-decomp`, `~/.agents/skills/caliper-parts` and",
  "`~/.agents/skills/intrinsic-design`. Also read `frontend-design`. This page",
  "does not repeat them. It records the decisions that are specific to `ui/`.",
  "",
  "The gates in `ui/gates/` are the authority. If this page and a gate disagree,",
  "the gate wins, and this page must change.",
  "",
  "## Where a file lives",
  "",
  "Every `.tsx` file under `ui/src/` is exactly one kind. The path and the name",
  "decide the kind.",
  "",
  "| Kind | Path | May read state | May own CSS | Has a part |",
  "|---|---|---|---|---|",
  "| System component | `src/ui/<Name>.tsx` | No | Yes, `src/ui/<Name>.css` | Yes |",
  "| Shape | `src/<feature>/<Name>.tsx` | No | No | Yes |",
  "| Binding | `src/<feature>/<Screen>.binding.tsx` | Yes | No | No |",
  "| Entry | `src/main.tsx` | Yes | Imports the global CSS | No |",
  "| Part | `<Name>.<layer>.part.tsx` beside its component | No | No | n/a |",
  "| Fixture | `src/<feature>/fixtures/*.ts` | No | No | No |",
  "",
  "",
].join("\n");

/** The opening of a real file of this repository, ui/docs/decomposition.md: Tiptap pads its table and rewraps its lines, so the rich view shows it read-only and offers its source. */
export function Lossy() {
  const [source, setSource] = useState(false);
  const check = richEditability(DECOMPOSITION);
  const changes = check.kind === "lossy" ? check.changes : 0;
  return source
    ? <CodeEditor label="Edit decomposition.md" fileName="decomposition.md" text={DECOMPOSITION} onChange={() => undefined} onSave={() => undefined} />
    : <MarkdownEditor label="Read decomposition.md" text={DECOMPOSITION} readOnly onChange={() => undefined} onSave={() => undefined}
      notice={{ message: MARKDOWN_WORDS.lossy(changes), action: { label: MARKDOWN_WORDS.editSource, onPress: () => setSource(true) } }} />;
}
