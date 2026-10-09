// Dev-only, network-free preview of a session's pull request.
// ?scenario= failed (default), several, waiting, blocked, ready, watching, stopped, conflict, unknown, nochecks, draft, merged, closed, unlinked, refused,
// loading, error, asked (after "Ask the agent to fix": the panel closed, the message box holds the request),
// header (the panel closed: the header dot), rows (the session list's marks for every tone).
// Nothing reaches GitHub or Pi. Fixtures use the server's wire shapes (src/pullRequests/pullRequestApi.ts).
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
import { PullRequestOpener, PullRequestReview, PullRequestRowMark, type PullsLoad } from "../src/ui/PullRequestReview";
import type { PullItem } from "../src/pullRequests/pullRequestApi";
import { firstToShow } from "../src/pullRequests/pullRequestModel";
import { fixChecksPrompt, type PullCheck, type PullLink, type PullRequest, type PullWatch } from "../src/pullRequests/pullRequestModel";
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
const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const check = (id: string, name: string, state: PullCheck["state"], extra: Partial<PullCheck> = {}): PullCheck =>
  ({ id, name, state, url: `${run}${id}`, required: true, ...extra });
const passing: PullCheck[] = [
  check("1", "verify / typecheck", "passed", { seconds: 41 }),
  check("2", "verify / unit (node 22)", "passed", { seconds: 134 }),
  check("3", "verify / lint", "passed", { seconds: 28 }),
  check("4", "build / vite", "passed", { seconds: 57 }),
  check("5", "acceptance / fold postures", "passed", { seconds: 312, required: false }),
];
const base: PullRequest = {
  number: 142, title: "Refuse an empty password at the login form, so SSO keeps calling the validator directly",
  url: "https://github.com/simonwjackson/forgerie/pull/142", state: "open", head: "fix/empty-password", base: "main",
  repo: "simonwjackson/forgerie", headSha: "4f1c2e9a7b3d5f60718293a4b5c6d7e8f9012345",
  author: "forgerie-agent", updatedAt: at(12), mergeability: "clean", files: 4, additions: 38, deletions: 6,
  checks: passing, reviews: [], comments: [], complete: true, merge: { kind: "allowed" },
};
const held = (reason: string) => ({ merge: { kind: "blocked", reason } as const });
const comments: PullRequest["comments"] = [
  { id: "c1", kind: "comment", author: "jordan", path: "src/auth/LoginForm.tsx", line: 24, updatedAt: at(40), url: `${base.url}#discussion_r1`,
    body: "Trim before the check, but send the untrimmed password. Some people end their password with a space on purpose." },
  { id: "c2", kind: "comment", author: "jordan", path: "src/auth/LoginForm.test.tsx", line: 9, updatedAt: at(38), url: `${base.url}#discussion_r2`,
    body: "Also cover a password of only spaces." },
  { id: "c3", kind: "comment", author: "alex", updatedAt: at(22), url: `${base.url}#issuecomment-3`,
    body: "Can this land before the SSO change on Friday? It blocks the rollout." },
];
const CHECKS_HELD = held("Every check must pass on this head commit.");
const PRS: Record<string, PullRequest> = {
  failed: { ...base, ...CHECKS_HELD, checks: [
    check("1", "verify / typecheck", "passed", { seconds: 39 }),
    check("2", "verify / unit (node 22)", "failed", { seconds: 141, logTail: unitLog }),
    check("3", "verify / lint", "failed", { seconds: 26, logTail: lintLog }),
    check("4", "build / vite", "passed", { seconds: 55 }),
    check("5", "acceptance / fold postures", "running", { required: false }),
  ], reviews: [{ reviewer: "alex", state: "commented", updatedAt: at(22) }], comments: comments.slice(2) },
  waiting: { ...base, ...CHECKS_HELD, checks: [passing[0]!, check("2", "verify / unit (node 22)", "running"), passing[2]!,
    check("4", "build / vite", "queued"), check("5", "acceptance / fold postures", "queued", { required: false })] },
  blocked: { ...base, ...held("A reviewer requested changes."), reviews: [{ reviewer: "jordan", state: "changes_requested", updatedAt: at(40) }, { reviewer: "alex", state: "commented", updatedAt: at(22) }], comments },
  ready: { ...base, reviews: [{ reviewer: "jordan", state: "approved", updatedAt: at(6) }, { reviewer: "alex", state: "approved", updatedAt: at(4) }] },
  conflict: { ...base, ...held("The branch conflicts with its base."), mergeability: "conflicting", reviews: [{ reviewer: "jordan", state: "approved", updatedAt: at(6) }] },
  unknown: { ...base, ...held("GitHub has not computed mergeability."), mergeability: "unknown" },
  nochecks: { ...base, ...held("No CI ran on this commit."), checks: [] },
  draft: { ...base, ...held("Only an open, non-draft PR can merge."), state: "draft", title: "Spike: stream check logs into the transcript" },
  merged: { ...base, ...held("Only an open, non-draft PR can merge."), state: "merged", updatedAt: at(3), reviews: [{ reviewer: "jordan", state: "approved", updatedAt: at(60) }] },
  closed: { ...base, ...held("Only an open, non-draft PR can merge."), state: "closed", title: "Try a stricter session cookie", head: "try/strict-cookie", updatedAt: at(2 * 1440), checks: passing.slice(0, 3) },
};
PRS.watching = PRS.failed!;
PRS.stopped = PRS.blocked!;
PRS.asked = PRS.failed!;
PRS.header = PRS.failed!;
const WATCH: Record<string, PullWatch> = {
  watching: { kind: "watching", since: at(28), wakes: 2, lastWake: at(6) },
  stopped: { kind: "stopped", at: at(5), reason: "10 consecutive comment-only wakes." },
};
const linkOf = (pr: PullRequest, watch: PullWatch = { kind: "off" }): PullLink =>
  ({ session: { id: "preview", cwd: "/preview" }, repo: pr.repo, number: pr.number, watch });

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const messages: TranscriptMessage[] = [
  say("q", "user", "Open a pull request for the empty-password fix."),
  say("a", "assistant", "Opened [#142](https://github.com/simonwjackson/forgerie/pull/142) from `fix/empty-password` into `main`. CI is running."),
];

function Preview() {
  const pr = PRS[scenario] ?? PRS.failed!;
  // "several": three pull requests in one session, one failing, one watched, one unreadable.
  const initial: PullItem[] = scenario === "unlinked" ? []
    : scenario === "several" ? [
      { link: linkOf({ ...PRS.ready!, number: 139 }), pull: { ...PRS.ready!, number: 139, title: "Split the session list into its own store", head: "refactor/session-store" } },
      { link: linkOf(PRS.failed!, WATCH.watching), pull: PRS.failed! },
      { link: linkOf({ ...PRS.waiting!, number: 151 }), pull: null, error: "GitHub refused the read: the PR head branch was deleted." },
    ]
    : [{ link: linkOf(pr, WATCH[scenario]), pull: pr }];
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState(firstToShow(initial));
  const setWatch = (number: number, watch: PullWatch) => setItems((current) => current.map((item) => item.link.number === number ? { ...item, link: { ...item.link, watch } } : item));
  const load: PullsLoad = scenario === "loading" ? { type: "loading" }
    : scenario === "error" ? { type: "failed", message: "GitHub refused the read: Forgerie's GitHub App cannot see simonwjackson/forgerie. Install the app on that repository from the backlog, then try again." }
    : { type: "ready", items };
  const notice = scenario === "refused" ? { tone: "error" as const, text: "The PR head changed after confirmation; read it again." } : undefined;
  const [open, setOpen] = useState(scenario !== "header" && scenario !== "asked" && scenario !== "rows");
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew: async () => {} });
  const ask = (message: string) => (runtime as AssistantRuntime).thread.composer.setText(message);
  useEffect(() => {
    if (scenario !== "asked") return;
    const timer = setTimeout(() => ask(fixChecksPrompt(pr)), 300);
    return () => clearTimeout(timer);
  }, []);
  const frame = <SessionFrame name="Reject empty passwords" status="Connected" actions={<>
    <PullRequestOpener pulls={load.type === "ready" ? items.flatMap((item) => item.pull ? [item.pull] : []) : []} links={items.map((item) => item.link)} onOpen={() => setOpen(true)} />
    <ChangesOpener notes={0} onOpen={() => {}} />
    <TreeOpener idle onOpen={() => {}} />
  </>}>
    <Thread />
    {open && <PullRequestReview load={load} selected={selected} onSelect={setSelected} reading={new Set()} notice={notice} writing={false} now={NOW}
      onRefresh={() => {}} onAsk={ask}
      onWatch={(number, on) => setWatch(number, on ? { kind: "watching", since: new Date().toISOString(), wakes: 0 } : { kind: "stopped", at: new Date().toISOString(), reason: "Stopped from the panel." })}
      onLink={async () => false} onUnlink={(number) => setItems((current) => current.filter((item) => item.link.number !== number))}
      onMerge={() => {}} onClose={() => setOpen(false)} />}
  </SessionFrame>;
  return <AssistantRuntimeProvider runtime={runtime}>
    {scenario === "rows" ? <AppShell open onOpenChange={() => {}} picker={() => <MockPicker />} thread={frame} /> : frame}
  </AssistantRuntimeProvider>;
}

/** The session list as Picker.tsx draws it, with each row's pull request mark where the worktree mark sits. */
function MockPicker() {
  const rows: { title: string; branch: string; time: string; links: PullLink[]; state?: string }[] = [
    { title: "Reject empty passwords", branch: "fix/empty-password", time: "28m", links: [linkOf({ ...PRS.ready!, number: 139 }), linkOf(PRS.failed!, WATCH.watching), linkOf({ ...PRS.waiting!, number: 151 })], state: "working" },
    { title: "Land the picker redesign", branch: "picker-redesign", time: "4m", links: [linkOf({ ...PRS.ready!, number: 145 })] },
    { title: "Stream check logs into the transcript", branch: "spike/check-logs", time: "18m", links: [linkOf({ ...PRS.draft!, number: 144 })] },
    { title: "Speed up session listing on a busy machine with long names", branch: "speed-up-session-listing", time: "26m", links: [linkOf({ ...PRS.waiting!, number: 1043 }, WATCH.watching)], state: "working" },
    { title: "Address review on the cookie change", branch: "fix/cookie-review", time: "40m", links: [linkOf({ ...PRS.blocked!, number: 140 }, WATCH.stopped)] },
    { title: "Ship the backlog launcher", branch: "feat/backlog-launcher", time: "3h", links: [linkOf({ ...PRS.merged!, number: 131 })] },
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
          <PullRequestRowMark links={row.links} /></span>
      </div>)}
    </div>
  </section>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<Preview />);
