// Dev-only, network-free preview of a session's pull request.
// ?scenario= failed (default), waiting, blocked, ready, watching, stopped, conflict, draft, merged, closed,
// loading, error, asked (after "Ask the agent to fix": the panel closed, the message box holds the request),
// header (the panel closed: the header dot), rows (the session list's marks for every tone).
// Nothing reaches GitHub or Pi. The server does not serve this data yet.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AssistantRuntime } from "@assistant-ui/react";
import { AnvilIcon, EllipsisIcon, SquarePenIcon, XIcon } from "lucide-react";
import type { TranscriptMessage } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import { AppShell } from "../src/ui/AppShell";
import { ChangesOpener } from "../src/ui/ChangesReview";
import { TreeOpener } from "../src/ui/SessionTreeNavigator";
import { PullRequestOpener, PullRequestReview, PullRequestRowMark, type PullLoad } from "../src/ui/PullRequestReview";
import { fixChecksPrompt, type PullCheck, type PullRequest } from "../src/pullRequests/pullRequestModel";
import "../src/ui/theme.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "failed";

const unitLog = [
  "> forgerie-assistant-ui-mvp@0.0.0 test",
  "> vitest run",
  "",
  " ✓ src/auth/session.test.ts (6 tests) 41ms",
  " ❯ src/auth/LoginForm.test.tsx (3 tests | 1 failed) 212ms",
  "   × refuses a password of only spaces 38ms",
  "",
  " FAIL  src/auth/LoginForm.test.tsx > refuses a password of only spaces",
  "AssertionError: expected \"spy\" to not be called at all, but called 1 times",
  " ❯ src/auth/LoginForm.test.tsx:21:28",
  "     19|   await user.type(screen.getByLabelText(\"Password\"), \"   \");",
  "     20|   await user.click(screen.getByRole(\"button\", { name: \"Sign in\" }));",
  "     21|   expect(onSubmit).not.toHaveBeenCalled();",
  "       |                            ^",
  "",
  " Test Files  1 failed | 41 passed (42)",
  "      Tests  1 failed | 318 passed (319)",
  "Error: Process completed with exit code 1.",
].join("\n");
const lintLog = [
  "/home/runner/work/forgerie/src/auth/LoginForm.tsx",
  "  24:11  error  'trimmed' is assigned a value but never used  @typescript-eslint/no-unused-vars",
  "",
  "✖ 1 problem (1 error, 0 warnings)",
  "Error: Process completed with exit code 1.",
].join("\n");
const run = "https://github.com/simonwjackson/forgerie/actions/runs/18311204417/job/52144";
const check = (id: string, name: string, state: PullCheck["state"], extra: Partial<PullCheck> = {}): PullCheck =>
  ({ id, name, state, url: `${run}${id}`, workflow: "CI", ...extra });
const passing: PullCheck[] = [
  check("1", "verify / typecheck", "passed", { seconds: 41 }),
  check("2", "verify / unit (node 22)", "passed", { seconds: 134 }),
  check("3", "verify / lint", "passed", { seconds: 28 }),
  check("4", "build / vite", "passed", { seconds: 57 }),
  check("5", "acceptance / fold postures", "passed", { seconds: 312, workflow: "Acceptance" }),
];
const base: PullRequest = {
  number: 142, title: "Refuse an empty password at the login form, so SSO keeps calling the validator directly",
  url: "https://github.com/simonwjackson/forgerie/pull/142", state: "open", head: "fix/empty-password", base: "main",
  author: "forgerie-agent", ago: "12m", conflicts: false, files: 4, additions: 38, deletions: 6,
  checks: passing, reviews: [], comments: [], watch: { kind: "off" },
};
const comments: PullRequest["comments"] = [
  { id: "c1", author: "jordan", path: "src/auth/LoginForm.tsx", line: 24, ago: "40m", url: `${base.url}#discussion_r1`,
    body: "Trim before the check, but send the untrimmed password. Some people end their password with a space on purpose." },
  { id: "c2", author: "jordan", path: "src/auth/LoginForm.test.tsx", line: 9, ago: "38m", url: `${base.url}#discussion_r2`,
    body: "Also cover a password of only spaces." },
  { id: "c3", author: "alex", ago: "22m", url: `${base.url}#issuecomment-3`,
    body: "Can this land before the SSO change on Friday? It blocks the rollout." },
];
const PRS: Record<string, PullRequest> = {
  failed: { ...base, checks: [
    check("1", "verify / typecheck", "passed", { seconds: 39 }),
    check("2", "verify / unit (node 22)", "failed", { seconds: 141, logTail: unitLog }),
    check("3", "verify / lint", "failed", { seconds: 26, logTail: lintLog }),
    check("4", "build / vite", "passed", { seconds: 55 }),
    check("5", "acceptance / fold postures", "running", { workflow: "Acceptance" }),
  ], reviews: [{ reviewer: "alex", state: "commented", ago: "22m" }], comments: comments.slice(2) },
  waiting: { ...base, checks: [passing[0]!, check("2", "verify / unit (node 22)", "running"), passing[2]!,
    check("4", "build / vite", "queued"), check("5", "acceptance / fold postures", "queued", { workflow: "Acceptance" })] },
  blocked: { ...base, reviews: [{ reviewer: "jordan", state: "changes_requested", ago: "40m" }, { reviewer: "alex", state: "commented", ago: "22m" }], comments },
  ready: { ...base, reviews: [{ reviewer: "jordan", state: "approved", ago: "6m" }, { reviewer: "alex", state: "approved", ago: "4m" }] },
  conflict: { ...base, conflicts: true, reviews: [{ reviewer: "jordan", state: "approved", ago: "6m" }] },
  draft: { ...base, state: "draft", title: "Spike: stream check logs into the transcript" },
  merged: { ...base, state: "merged", ago: "3m", reviews: [{ reviewer: "jordan", state: "approved", ago: "1h" }] },
  closed: { ...base, state: "closed", title: "Try a stricter session cookie", head: "try/strict-cookie", ago: "2d", checks: passing.slice(0, 3) },
};
PRS.watching = { ...PRS.failed!, watch: { kind: "watching", since: "21:02", wakes: 2, lastWake: "21:24" } };
PRS.stopped = { ...PRS.blocked!, watch: { kind: "stopped", ago: "5m", reason: "Ten wakes in a row brought only comments, so it stopped to keep a busy thread from running the agent in a loop." } };
PRS.asked = PRS.failed!;
PRS.header = PRS.failed!;

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const messages: TranscriptMessage[] = [
  say("q", "user", "Open a pull request for the empty-password fix."),
  say("a", "assistant", "Opened [#142](https://github.com/simonwjackson/forgerie/pull/142) from `fix/empty-password` into `main`. CI is running."),
];

function Preview() {
  const pr = PRS[scenario] ?? PRS.failed!;
  const [watch, setWatch] = useState(pr.watch);
  const value = { ...pr, watch };
  const load: PullLoad = scenario === "loading" ? { type: "loading" }
    : scenario === "error" ? { type: "failed", message: "GitHub refused the read: Forgerie's GitHub App cannot see simonwjackson/forgerie. Install the app on that repository from the backlog, then try again." }
    : { type: "ready", value };
  const [open, setOpen] = useState(scenario !== "header" && scenario !== "asked" && scenario !== "rows");
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {} });
  const ask = (message: string) => (runtime as AssistantRuntime).thread.composer.setText(message);
  useEffect(() => {
    if (scenario !== "asked") return;
    const timer = setTimeout(() => ask(fixChecksPrompt(pr)), 300);
    return () => clearTimeout(timer);
  }, []);
  const frame = <SessionFrame name="Reject empty passwords" status="Connected" actions={<>
    <PullRequestOpener pr={value} onOpen={() => setOpen(true)} />
    <ChangesOpener notes={0} onOpen={() => {}} />
    <TreeOpener idle onOpen={() => {}} />
  </>}>
    <Thread />
    {open && <PullRequestReview load={load} onRefresh={() => {}} onAsk={ask} onWatch={(on) => setWatch(on ? { kind: "watching", since: "21:30", wakes: 0 } : { kind: "off" })}
      onMerge={() => {}} onClose={() => setOpen(false)} />}
  </SessionFrame>;
  return <AssistantRuntimeProvider runtime={runtime}>
    {scenario === "rows" ? <AppShell open onOpenChange={() => {}} picker={() => <MockPicker />} thread={frame} /> : frame}
  </AssistantRuntimeProvider>;
}

/** The session list as Picker.tsx draws it, with each row's pull request mark where the worktree mark sits. */
function MockPicker() {
  const rows: { title: string; branch: string; time: string; pr: PullRequest; state?: string }[] = [
    { title: "Reject empty passwords", branch: "fix/empty-password", time: "now", pr: PRS.failed!, state: "working" },
    { title: "Land the picker redesign", branch: "picker-redesign", time: "4m", pr: PRS.ready! },
    { title: "Stream check logs into the transcript", branch: "spike/check-logs", time: "18m", pr: PRS.draft! },
    { title: "Speed up session listing on a busy machine with long names", branch: "speed-up-session-listing", time: "26m", pr: PRS.waiting! },
    { title: "Address review on the cookie change", branch: "fix/cookie-review", time: "40m", pr: PRS.blocked! },
    { title: "Rebase the sessiond port", branch: "port/sessiond", time: "1h", pr: { ...PRS.conflict!, number: 139 } },
    { title: "Ship the backlog launcher", branch: "feat/backlog-launcher", time: "3h", pr: { ...PRS.merged!, number: 131 } },
    { title: "Try a stricter session cookie", branch: "try/strict-cookie", time: "2d", pr: { ...PRS.closed!, number: 127 } },
  ];
  return <section className="picker" aria-label="Sessions">
    <header className="picker-header">
      <h2 className="picker-brand"><AnvilIcon aria-hidden />Forgerie</h2>
      <button className="picker-icon" aria-label="More session commands"><EllipsisIcon aria-hidden size={16} /></button>
      <button className="picker-icon" aria-label="Close sessions"><XIcon aria-hidden size={16} /></button>
    </header>
    <button className="picker-new"><SquarePenIcon aria-hidden size={16} />New session</button>
    <div className="picker-list" role="listbox" aria-label="Sessions">
      {rows.map((row, index) => <div key={row.title} className="picker-row" role="option" aria-selected={index === 0} data-state={row.state ?? "open"}>
        <span className="picker-mark" aria-hidden="true"><i /></span>
        <span className="picker-title">{row.title}</span>
        <span className="picker-time" data-live={row.state === "working" || undefined}>{row.time}</span>
        <span className="picker-sub"><span className="picker-where">forgerie · <span className="picker-branch">{row.branch}</span></span>
          <PullRequestRowMark pr={row.pr} /></span>
      </div>)}
    </div>
  </section>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
