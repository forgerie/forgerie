// Dev-only, network-free preview of the session tree navigator over a session.
// Scenarios: tree, tree-all, tree-summarize, tree-summarizing, tree-forking, tree-error, tree-empty.
// Actions run against local state only. Nothing reaches Pi.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { TranscriptMessage } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { SessionTreeNavigator, TreeOpener } from "../src/ui/SessionTreeNavigator";
import type { SessionTreeNode, SessionTreeSnapshot, TreeOperation } from "../src/sessionTree";
import "../src/ui/theme.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "tree";
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

/** A realistic coding session: one abandoned approach, a compaction, a model change, and a label. */
function fixtureTree(): SessionTreeSnapshot {
  const nodes: SessionTreeNode[] = [];
  let minutes = 260;
  const add = (id: string, parentId: string | null, kind: SessionTreeNode["kind"], summary: string, extra: Partial<SessionTreeNode> = {}) => {
    minutes -= 7;
    nodes.push({ id, parentId, kind, summary, timestamp: ago(minutes), ...extra });
    return id;
  };
  let at = add("u1", null, "user", "The login form accepts an empty password. Find out why and fix it without changing the session cookie format.");
  at = add("m1", at, "model-change", "anthropic/claude-sonnet-5");
  at = add("a1", at, "assistant", "Tool call: read src/auth/login.ts");
  at = add("t1", at, "tool-result", "read src/auth/login.ts (212 lines)");
  at = add("a2", at, "assistant", "The validator trims the password and then checks `length > 0` on the untrimmed value.");
  const fork = add("u2", at, "user", "Fix it in the validator and add a regression test.", { label: "plan A" });
  // The abandoned approach.
  let side = add("a3", fork, "assistant", "Tool call: edit src/auth/validate.ts");
  side = add("t2", side, "tool-result", "Successfully replaced 1 block(s) in src/auth/validate.ts.");
  side = add("b1", side, "bash", "npm test -- auth  (3 failed)");
  side = add("u3", side, "user", "That broke the SSO path. Undo and try at the form layer instead.");
  add("a4", side, "assistant", "Understood. The SSO callback calls the same validator with an empty password by design.");
  // The live branch.
  at = add("u4", at, "user", "Fix it at the form layer, so SSO keeps calling the validator directly.");
  at = add("a5", at, "assistant", "Tool call: edit src/auth/LoginForm.tsx");
  at = add("t3", at, "tool-result", "Successfully replaced 2 block(s) in src/auth/LoginForm.tsx.");
  at = add("c1", at, "compaction", "Compacted 38 messages: the empty-password bug, the SSO constraint, and the form-layer fix.");
  at = add("u5", at, "user", "Now add the regression test and run the whole auth suite.");
  at = add("a6", at, "assistant", "Tool call: write src/auth/LoginForm.test.tsx");
  at = add("t4", at, "tool-result", "Wrote 64 lines to src/auth/LoginForm.test.tsx");
  at = add("b2", at, "bash", "npm test -- auth  (41 passed)");
  at = add("u6", at, "user", "Ship it.");
  at = add("a7", at, "assistant", "Committed `fix(auth): reject an empty password in the login form` and pushed the branch.");
  const activePathIds: string[] = [];
  for (let id: string | null = at; id !== null; id = nodes.find((node) => node.id === id)?.parentId ?? null) activePathIds.unshift(id);
  return { nodes, activeLeafId: at, activePathIds };
}

const operations: Record<string, TreeOperation> = {
  "tree-summarizing": { type: "continuing", summarizing: true, aborting: false },
  "tree-forking": { type: "forking" },
  "tree-error": { type: "idle", notice: { tone: "error", message: "The session changed since /tree was opened. Reopen /tree and try again." } },
};
const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const messages: TranscriptMessage[] = [
  say("q", "user", "Now add the regression test and run the whole auth suite."),
  say("a", "assistant", "The new test covers the empty password and the SSO callback. All **41** auth tests pass."),
];

function Preview() {
  const [open, setOpen] = useState(scenario !== "tree-keyboard");
  const [operation, setOperation] = useState<TreeOperation>(operations[scenario] ?? { type: "idle" });
  const [tree] = useState(() => scenario === "tree-empty" ? { nodes: [], activeLeafId: null, activePathIds: [] } : fixtureTree());
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {} });
  // Scenarios that need one click to reach their state.
  useEffect(() => {
    const press = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".tree-dialog button")]
      .find((button) => button.textContent?.trim() === label)?.click();
    const timer = setTimeout(() => {
      if (scenario === "tree-all") press("All");
      if (scenario === "tree-summarize") press("Summarize");
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  const settle = (message: string) => setTimeout(() => setOperation({ type: "idle", notice: { tone: "status", message } }), 1500);
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Reject empty passwords" status="Connected" actions={<TreeOpener idle onOpen={() => setOpen(true)} />}>
      <Thread sessionKeys={{ onDoubleEscapeAction: (action) => { if (action === "tree") setOpen(true); } }}
        shell={{ availability: { type: "ready" }, onRun: async () => {} }} />
      {open && <SessionTreeNavigator tree={tree} operation={operation}
        onContinue={(_, summary) => { setOperation({ type: "continuing", summarizing: summary.mode !== "none", aborting: false }); settle("Local preview. Pi did not move the session."); }}
        onFork={() => { setOperation({ type: "forking" }); settle("Local preview. Pi did not create a session."); }}
        onAbort={() => setOperation((current) => current.type === "continuing" ? { ...current, aborting: true } : current)}
        onClose={() => setOpen(false)} />}
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
