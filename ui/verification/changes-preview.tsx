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
import { parseUnifiedDiff } from "../src/changes/unifiedDiff";
import "../src/ui/theme.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "changes";

const DIFFS: Record<string, string> = {
  "src/auth/LoginForm.tsx": [
    "@@ -18,10 +18,14 @@ export function LoginForm({ onSubmit }: LoginFormProps) {",
    "   const [email, setEmail] = useState(\"\");",
    "   const [password, setPassword] = useState(\"\");",
    "   const [error, setError] = useState<string>();",
    "-  const submit = (event: FormEvent) => {",
    "+  const submit = async (event: FormEvent) => {",
    "     event.preventDefault();",
    "-    onSubmit({ email, password });",
    "+    if (password.trim() === \"\") {",
    "+      setError(\"Enter your password.\");",
    "+      return;",
    "+    }",
    "+    await onSubmit({ email, password });",
    "   };",
    "   return <form onSubmit={submit} noValidate>",
    "     <EmailField value={email} onChange={setEmail} />",
    "     <PasswordField value={password} onChange={setPassword} invalid={error !== undefined} />",
    "@@ -61,3 +65,4 @@ export function LoginForm({ onSubmit }: LoginFormProps) {",
    "     </form>;",
    " }",
    "+// The SSO callback calls validatePassword directly and must keep accepting an empty value.",
    " ",
  ].join("\n"),
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
  "src/auth/session.ts": [
    "@@ -40,7 +40,7 @@ export const SESSION_COOKIE = \"sid\";",
    " export function cookieOptions(secure: boolean): CookieOptions {",
    "   return {",
    "     httpOnly: true,",
    "-    sameSite: \"lax\",",
    "+    sameSite: \"strict\",",
    "     secure,",
    "     maxAge: 60 * 60 * 24 * 14,",
    "   };",
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
function note(id: string, path: string, from: number, to: number, comment: string): DiffNote {
  const { rows } = parseUnifiedDiff(DIFFS[path] ?? "");
  return { id, path, staged: path.endsWith(".test.tsx"), comment, lines: linesOf(rows, { anchor: from, focus: to }) };
}
const seeded: DiffNote[] = scenario === "changes-empty" ? [] : [
  note("n1", "src/auth/LoginForm.tsx", 7, 11, "Trim before the check, but send the untrimmed password. Some users have spaces at the end on purpose."),
  ...scenario === "changes-tray" ? [
    note("n2", "src/auth/session.ts", 4, 5, "Revert this. Strict breaks the SSO redirect back to us."),
    note("n3", "src/auth/LoginForm.test.tsx", 4, 9, "Also cover a password of only spaces."),
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
    const press = (label: string) => document.querySelector<HTMLButtonElement>(`.changes-dialog button[aria-label="${label}"]`)?.click();
    const timer = setTimeout(() => {
      press("Select line 65");
      setTimeout(() => {
        press("Stretch the selection to added line 67");
        setTimeout(() => {
          const field = document.querySelector<HTMLTextAreaElement>(".note-editor textarea");
          if (!field) return;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Move this comment to validatePassword, where the rule lives.");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.closest(".note-editor")?.scrollIntoView({ block: "center" });
        }, 50);
      }, 50);
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
