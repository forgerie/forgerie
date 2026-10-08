// Dev-only, network-free preview of the changes review and the note tray over a session.
// Scenarios: changes, changes-selecting, changes-tray, changes-empty.
// Notes live in local state only. Nothing reaches Pi or git.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { TranscriptMessage } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { ChangesOpener, ChangesReview } from "../src/ui/ChangesReview";
import { TreeOpener } from "../src/ui/SessionTreeNavigator";
import { createNoteTray } from "../src/changes/noteTray";
import { entriesOf, type ChangesSource } from "../src/changes/changesSource";
import { linesOf, type DiffNote } from "../src/changes/diffNotes";
import { parseUnifiedDiff, type CodeRow } from "../src/changes/unifiedDiff";
import { diffDocument } from "../src/changes/diffDocument";
import "../src/ui/theme.css";
import loginFormDiff from "./changes-fixtures/LoginForm.tsx.diff?raw";
import sessionDiff from "./changes-fixtures/session.ts.diff?raw";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "changes";

// Full-context diffs, as the server sends them for `/git/diff?context=full`.
const DIFFS: Record<string, string> = {
  "src/auth/LoginForm.tsx": loginFormDiff,
  "src/auth/session.ts": sessionDiff,
  "src/auth/LoginForm.test.tsx": [
    "@@ -0,0 +1,9 @@",
    "+import { render, screen } from \"@testing-library/react\";",
    "+import { LoginForm } from \"./LoginForm\";",
    "+",
    "+it(\"refuses an empty password before it calls onSubmit\", async () => {",
    "+  const onSubmit = vi.fn();",
    "+  render(<LoginForm onSubmit={onSubmit} />);",
    "+  await user.click(screen.getByRole(\"button\", { name: \"Sign in\" }));",
    "+  expect(onSubmit).not.toHaveBeenCalled();",
    "+});",
  ].join("\n"),
};
const FILES = scenario === "changes-empty" ? [] : [
  { path: "src/auth/LoginForm.tsx", index: "unmodified" as const, workingTree: "modified" as const },
  { path: "src/auth/LoginForm.test.tsx", index: "added" as const, workingTree: "unmodified" as const },
  { path: "src/auth/session.ts", index: "unmodified" as const, workingTree: "modified" as const },
  { path: "vendor/sso-client/", index: "untracked" as const, workingTree: "untracked" as const },
];
const source: ChangesSource = {
  changes: async () => ({ isGitRepo: true, branch: "fix/empty-password", entries: entriesOf(FILES) }),
  diff: async (entry) => ({ ...parseUnifiedDiff(DIFFS[entry.path] ?? ""), truncated: false }),
};
/** A note from the first line `first` matches to the first line after it that `last` matches. */
function note(id: string, path: string, first: (line: CodeRow) => boolean, last: (line: CodeRow) => boolean, comment: string): DiffNote {
  const { lines } = diffDocument(parseUnifiedDiff(DIFFS[path] ?? "").rows);
  const anchor = lines.findIndex(first);
  const focus = lines.findIndex((line, index) => index >= anchor && last(line));
  return { id, path, staged: path.endsWith(".test.tsx"), comment, lines: linesOf(lines, { anchor, focus }) };
}
const newLine = (number: number) => (line: CodeRow) => line.kind !== "remove" && line.newLineNumber === number;
const oldLine = (number: number) => (line: CodeRow) => line.kind !== "add" && line.oldLineNumber === number;
const seeded: DiffNote[] = scenario === "changes-empty" ? [] : [
  note("n1", "src/auth/LoginForm.tsx", newLine(24), newLine(27), "Trim before the check, but send the untrimmed password. Some users have spaces at the end on purpose."),
  ...scenario === "changes-tray" ? [
    note("n2", "src/auth/session.ts", oldLine(12), newLine(12), "Revert this. Strict breaks the SSO redirect back to us."),
    note("n3", "src/auth/LoginForm.test.tsx", newLine(4), newLine(9), "Also cover a password of only spaces."),
  ] : [],
];

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const messages: TranscriptMessage[] = [
  say("q", "user", "Fix it at the form layer, so SSO keeps calling the validator directly."),
  say("a", "assistant", "Done. The form now refuses an empty password before it calls `onSubmit`, and a new test covers it. The SSO path is unchanged."),
];

function Preview() {
  const [tray] = useState(() => { const created = createNoteTray(); for (const item of seeded) created.add(item); return created; });
  const notes = useSyncExternalStore(tray.subscribe, tray.notes);
  const [open, setOpen] = useState<{ focusNoteId?: string } | undefined>(scenario === "changes-tray" ? undefined : {});
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {} });
  // The selecting scenario needs two taps and some typing to reach its state.
  useEffect(() => {
    if (scenario !== "changes-selecting") return;
    // A tap on a line's numbers. The editor draws only lines near the window, so bring the file's end in first.
    const tapNumbers = (line: number) => {
      const cell = [...document.querySelectorAll<HTMLElement>(".changes-dialog .cm-diff-numbers .cm-gutterElement")]
        .find((element) => element.querySelector(".cm-diff-new")?.textContent === String(line));
      cell?.querySelector<HTMLElement>("[data-line]")?.click();
    };
    const timer = setTimeout(() => {
      document.querySelector(".change-file:has(.change-path[title='src/auth/LoginForm.tsx']) .diff")?.scrollIntoView({ block: "end" });
      setTimeout(() => {
        tapNumbers(50);
        // The second tap stretches the selection the first one drew.
        setTimeout(() => tapNumbers(51), 50);
        setTimeout(() => {
          const field = document.querySelector<HTMLTextAreaElement>(".note-editor textarea");
          if (!field) return;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Say this where the SSO callback calls it, not here.");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.closest(".note-editor")?.scrollIntoView({ block: "center" });
        }, 150);
      }, 150);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Reject empty passwords" status="Connected" actions={<>
      <ChangesOpener notes={notes.length} onOpen={() => setOpen({})} />
      <TreeOpener idle onOpen={() => {}} />
    </>}>
      <Thread notes={{ notes, onRemove: tray.remove, onOpen: (focusNoteId) => setOpen({ focusNoteId }), onSendAlone: async () => {} }} />
      {open && <ChangesReview source={source} notes={notes} focusNoteId={open.focusNoteId}
        onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setOpen(undefined)} />}
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
