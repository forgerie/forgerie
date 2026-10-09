// Dev-only, network-free preview of the changes review and the note tray over a session.
// Scenarios: changes (on arrival), changes-file (LoginForm.tsx chosen in the tree), changes-selecting, changes-tray, changes-empty,
// files (All files, opened at the file on screen), files-edit (README.md with unsaved edits), files-conflict (that save meets a change on disk),
// files-closing (closing with unsaved edits).
// Notes and files live in local state only. Nothing reaches Pi, git, or the disk.
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
import type { FilesSource, Folder } from "../src/changes/filesSource";
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
// The workspace as files: each changed file's new side, and a few files the agent never touched.
const newSide = (diff: string) => diffDocument(parseUnifiedDiff(diff).rows).lines.filter((line) => line.kind !== "remove").map((line) => line.text).join("\n") + "\n";
const disk = new Map<string, string>([
  ...Object.entries(DIFFS).map(([path, diff]): [string, string] => [path, newSide(diff)]),
  ["README.md", "# Acme sign-in\n\nThe sign-in form and the SSO callback share one validator.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n"],
  ["package.json", '{\n  "name": "acme-sign-in",\n  "private": true,\n  "scripts": { "dev": "vite", "test": "vitest" }\n}\n'],
  ["src/auth/validate.ts", "export function validPassword(password: string): boolean {\n  return password.length > 0;\n}\n"],
  ["src/ui/Button.tsx", "export function Button(props: { label: string }) {\n  return <button type=\"submit\">{props.label}</button>;\n}\n"],
  ["docs/sso.md", "# SSO\n\nThe callback calls `validPassword` directly.\n"],
]);
const BINARY = new Set(["public/logo.png"]);
const version = (text: string) => `v${String(text.length)}:${text.slice(0, 8)}`;
function listing(path: string): Folder {
  const prefix = path === "" ? "" : `${path}/`;
  const names = new Map<string, "folder" | "file">();
  for (const file of [...disk.keys(), ...BINARY, "vendor/sso-client/index.js"]) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? "file" : "folder");
  }
  const entries = [...names].sort(([a, x], [b, y]) => Number(y === "folder") - Number(x === "folder") || a.localeCompare(b))
    .map(([name, type]) => ({ name, path: `${prefix}${name}`, type }));
  return { entries, truncated: false };
}
const files: FilesSource = {
  folder: async (path) => listing(path),
  read: async (path) => {
    if (BINARY.has(path)) return { type: "locked", path, reason: "binary", size: 4_812 };
    const text = disk.get(path);
    if (text === undefined) throw new Error("Path does not exist");
    return { type: "text", path, text, version: version(text) };
  },
  write: async (path, text, expected) => {
    // The conflict scenario: the agent rewrote the file while the reader was editing it.
    if (scenario === "files-conflict" && expected.type === "version" && disk.get(path) === undefined) return { type: "conflict", version: undefined };
    if (scenario === "files-conflict" && expected.type === "version" && expected.version === version(disk.get(path) ?? "")) {
      disk.set(path, `${disk.get(path) ?? ""}\nThe agent added this line.\n`);
      return { type: "conflict", version: version(disk.get(path) ?? "") };
    }
    disk.set(path, text);
    return { type: "saved", version: version(text) };
  },
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
  // The file and selecting scenarios choose a file in the tree; selecting then needs two taps and some typing.
  // The files scenarios switch the tree to All files, open src/auth, and open README.md to type in it.
  useEffect(() => {
    if (!scenario.startsWith("files")) return;
    let stopped = false;
    // Each step waits for what it needs: listings and the editor arrive on their own time.
    const found = async (selector: string) => {
      for (let tries = 0; tries < 100 && !stopped; tries++) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return undefined;
    };
    const click = async (selector: string) => { (await found(selector))?.click(); };
    void (async () => {
      // All files opens at the file on screen, so src/auth is open without a tap.
      await click(".toggle-group-option:last-child");
      if (scenario === "files") return;
      await click('.tree-item[data-row="file:README.md"]');
      const content = await found(".code-editor .cm-content");
      const line = content?.querySelectorAll(".cm-line")[2];
      if (!content || !line) return;
      // Typing at the end of the third line, the way a keyboard would: CodeMirror reads the DOM's input.
      content.focus();
      const range = document.createRange();
      range.selectNodeContents(line);
      range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      document.execCommand("insertText", false, " Empty passwords stop at the form.");
      if (scenario === "files-conflict") await click(".change-save:not(:disabled)");
      if (scenario === "files-closing" && await found(".change-unsaved")) await click('[aria-label="Close changes"]');
    })();
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    if (scenario !== "changes-file" && scenario !== "changes-selecting") return;
    // A tap on a line's numbers. The editor draws only lines near the window, so bring the file's end in first.
    const tapNumbers = (line: number) => {
      const cell = [...document.querySelectorAll<HTMLElement>(".changes-dialog .cm-diff-numbers .cm-gutterElement")]
        .find((element) => element.querySelector(".cm-diff-new")?.textContent === String(line));
      cell?.querySelector<HTMLElement>("[data-line]")?.click();
    };
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('.tree-item[data-row="unstaged:src/auth/LoginForm.tsx"]')?.click();
      if (scenario !== "changes-selecting") return;
      setTimeout(() => {
        document.querySelector(".changes-body .diff")?.scrollIntoView({ block: "end" });
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
      }, 600);
    }, 300);
    return () => clearTimeout(timer);
  }, []);
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Reject empty passwords" status="Connected" actions={<>
      <ChangesOpener notes={notes.length} onOpen={() => setOpen({})} />
      <TreeOpener idle onOpen={() => {}} />
    </>}>
      <Thread notes={{ notes, onRemove: tray.remove, onOpen: (focusNoteId) => setOpen({ focusNoteId }), onSendAlone: async () => {} }} />
      {open && <ChangesReview source={source} files={files} notes={notes} focusNoteId={open.focusNoteId}
        onAdd={tray.add} onEdit={tray.edit} onRemove={tray.remove} onClose={() => setOpen(undefined)} />}
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
