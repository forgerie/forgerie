/**
 * Actions runs as the server sends them (src/shared/actionRuns.ts), field for
 * field, for parts and tests. Time is fixed: `fixtureNow` is "now".
 */
import type { ActionJob, ActionRun, ActionRunItem, ActionRunLink, DerivedRuns, RunWatch } from "../actionRunApi";
import type { ActionRunsState } from "../actionRunsStore";

export const fixtureNow = Date.parse("2026-10-15T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(fixtureNow - minutesAgo * 60_000).toISOString();
export const session = { id: "s1", cwd: "/home/dev/forgerie" };
export const repo = "forgerie/forgerie";

const job = (id: number, name: string, state: ActionJob["state"], seconds?: number, extra: Partial<ActionJob> = {}): ActionJob => ({
  id: String(id), name, state, url: `https://github.com/${repo}/actions/runs/18234561230/job/${String(id)}`,
  ...seconds === undefined ? {} : { seconds, startedAt: at(20), completedAt: at(20 - seconds / 60) }, ...extra });

export const failureLog = [
  "Run npm test -- --run",
  "",
  " FAIL  src/upload.test.ts > upload > retries a dropped chunk",
  "AssertionError: expected 2 to be 3 // Object.is equality",
  "",
  "- Expected",
  "+ Received",
  "",
  "- 3",
  "+ 2",
  "",
  " ❯ src/upload.test.ts:48:23",
  "     46|     await upload(file, { chunk: 4096 });",
  "     47|     drop(1);",
  "     48|     expect(sent.length).toBe(3);",
  "       |                       ^",
  "",
  "Test Files  1 failed | 41 passed (42)",
  "     Tests  1 failed | 388 passed (389)",
  "Error: Process completed with exit code 1.",
].join("\n");

export const run = (runId: number, extra: Partial<ActionRun> = {}): ActionRun => ({
  repo, runId, runNumber: 4790, attempt: 1, workflow: "CI", workflowPath: ".github/workflows/ci.yml", title: "Retry dropped upload chunks",
  event: "push", branch: "fix/upload-retry", headSha: "3f9a2c41d7e85b06c1a9f3e2d4b5a6c7e8f90123", actor: "simonwjackson",
  url: `https://github.com/${repo}/actions/runs/${String(runId)}`, status: "completed", conclusion: "success",
  createdAt: at(26), updatedAt: at(21), pullNumbers: [], jobs: [], complete: true, ...extra,
});

export const failedRun = run(18234561230, {
  runNumber: 4812, attempt: 2, conclusion: "failure", createdAt: at(24), updatedAt: at(12), pullNumbers: [142],
  jobs: [
    job(51001, "lint", "passed", 38),
    job(51002, "typecheck", "passed", 71),
    job(51003, "test (ubuntu-latest, node 24)", "failed", 412, { logTail: failureLog, logSource: "annotations" }),
    job(51004, "test (macos-latest, node 24)", "failed", 506, { logTail: "Error: The operation was canceled.\nError: Process completed with exit code 143.", logSource: "annotations" }),
    job(51005, "build", "passed", 189),
    job(51006, "e2e (chromium)", "cancelled", 95),
    job(51007, "publish preview", "skipped"),
  ],
});
export const runningRun = run(18234590417, {
  runNumber: 4813, workflow: "Build SM8550", workflowPath: ".github/workflows/build-sm8550.yml", title: "Build SM8550 firmware for the Fold 8",
  event: "workflow_dispatch", branch: "main", headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", status: "running", conclusion: null,
  createdAt: at(9), updatedAt: at(1),
  jobs: [job(52001, "prepare", "passed", 44), job(52002, "kernel", "running", undefined, { startedAt: at(7) }), job(52003, "vendor image", "queued"), job(52004, "sign", "queued")],
});
export const passedRun = run(18234470022, { runNumber: 4797, createdAt: at(190), updatedAt: at(178),
  jobs: [job(53001, "lint", "passed", 35), job(53002, "typecheck", "passed", 68), job(53003, "test (ubuntu-latest, node 24)", "passed", 398), job(53004, "build", "passed", 181)] });
export const queuedRun = run(18234600981, { runNumber: 211, workflow: "Nightly", workflowPath: ".github/workflows/nightly.yml", title: "Nightly", event: "schedule", branch: "main",
  status: "queued", conclusion: null, createdAt: at(0.5), updatedAt: at(0.5) });
/** The stress lengths: a long workflow name, a long title, and a branch with no break points. */
export const longRun = run(18234612345, {
  runNumber: 128734, workflow: "Build and publish signed firmware images for every supported board revision",
  title: "Rework the partition table so that the recovery image and the vendor image can grow independently without a reflash",
  branch: "feature/partition-table-rework-for-independently-growing-recovery-and-vendor-images", attempt: 12, conclusion: "timed_out",
  createdAt: at(60 * 24 * 9), updatedAt: at(60 * 24 * 9 - 361),
});

const watching = (wakes: number): RunWatch => ({ kind: "watching", since: at(24), wakes, ...wakes > 0 ? { lastWake: at(12) } : {} });
export const link = (runId: number, watch: RunWatch = { kind: "off" }, source: ActionRunLink["source"] = "manual"): ActionRunLink =>
  ({ provider: "github", session, repo, runId, source, watch });

export const permissionError = `Forgerie's GitHub App may not do this on ${repo}: it needs "Actions: read". Grant it at https://github.com/settings/apps/forgerie-dev/permissions, then accept the new permissions on the app's installation. Tell the user; do not retry.`;

export const items: ActionRunItem[] = [
  { link: link(failedRun.runId, watching(2), "pull"), run: failedRun },
  { link: link(runningRun.runId, watching(0), "dispatch"), run: runningRun },
  { link: link(passedRun.runId, { kind: "stopped", reason: "run completed (success)", at: at(178) }), run: passedRun },
];
export const brokenItems: ActionRunItem[] = [
  items[0]!,
  { link: link(18234499999), run: null, error: "GitHub answered 404: Not Found." },
  { link: link(18234488888, watching(1)), run: null, error: permissionError },
];
export const manyItems: ActionRunItem[] = [
  ...items, { link: link(queuedRun.runId), run: queuedRun }, { link: link(longRun.runId), run: longRun },
  ...Array.from({ length: 9 }, (_, index): ActionRunItem => {
    const id = 18234700000 + index;
    return { link: link(id), run: run(id, { runNumber: 4700 + index, title: `Bump dependency ${String(index + 1)} of 9`, branch: `deps/bump-${String(index + 1)}`, createdAt: at(300 + index * 47), updatedAt: at(290 + index * 47),
      conclusion: index % 4 === 0 ? "failure" : index % 4 === 1 ? "cancelled" : "success" }) };
  }),
];

export const derived: DerivedRuns[] = [
  { pull: 142, headSha: failedRun.headSha, runs: [{ ...failedRun, jobs: [] }, { ...run(18234561231, { runNumber: 3301, workflow: "CodeQL", workflowPath: ".github/workflows/codeql.yml", status: "running", conclusion: null, createdAt: at(23), updatedAt: at(2) }), jobs: [] }] },
];

const base: ActionRunsState = { load: { type: "idle" }, listing: false, listError: undefined, reading: new Set(), notice: undefined, writing: false, detail: undefined };
export const states = {
  idle: base,
  loading: { ...base, load: { type: "loading" } },
  empty: { ...base, load: { type: "ready", items: [], derived: [] } },
  ready: { ...base, load: { type: "ready", items, derived } },
  many: { ...base, load: { type: "ready", items: manyItems, derived } },
  broken: { ...base, load: { type: "ready", items: brokenItems, derived: [{ pull: 142, headSha: failedRun.headSha, runs: [], error: permissionError }] } },
  failed: { ...base, load: { type: "failed", message: "GitHub did not answer within 45 seconds." } },
  rereading: { ...base, load: { type: "ready", items, derived }, listing: true, reading: new Set([`${repo}#${String(runningRun.runId)}`]) },
} satisfies Record<string, ActionRunsState>;
