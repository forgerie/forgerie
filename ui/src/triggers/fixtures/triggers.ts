// Fixture triggers for parts, tests, and the capture page. Fixed instants: the
// evening of Mon, Oct 12 2026 in Denver, after a night whose run failed.
import type { Trigger, TriggerFire, TriggerListResponse, TriggerProjectFire, TriggerTargets, TriggerWorkflow, TriggerWorkflowsResponse } from "@shared/triggers";
import type { Project } from "../../newSession";
import type { SessionModel } from "../../contracts";

export const HOST_ZONE = "America/Denver";
/** Mon, Oct 12 2026, 6:00 PM in Denver (UTC−6). */
export const NOW = Date.UTC(2026, 9, 13, 0, 0);
/** 3:00 AM in Denver on Oct `day` of 2026. */
const night = (day: number, hour = 3, minute = 0) => Date.UTC(2026, 9, day, hour + 6, minute);

export const FORGERIE = "/home/simonwjackson/code/sandbox/forgerie";
export const PI_MONO = "/home/simonwjackson/code/pi-mono";
export const CALIPER = "/home/simonwjackson/code/github/simonwjackson/caliper";
/** A project a past fire skipped: its folder was gone, and it is no longer registered. */
export const OLD_SITE = "/home/simonwjackson/code/old-site";
export const projects: Project[] = [
  { id: "forgerie", name: "forgerie", path: FORGERIE },
  { id: "pi-mono", name: "pi-mono", path: PI_MONO },
  { id: "caliper", name: "caliper", path: CALIPER },
];

const refine: TriggerWorkflow = { name: "refine-backlog", description: "Refine the oldest ready backlog items and open a land card", kind: "prose", hasLandStop: true,
  inputs: { task: { type: "string", description: "What to refine" } } };
const triageIssues: TriggerWorkflow = { name: "triage-issues", description: "Sort new issues into the backlog", kind: "prose", hasLandStop: false,
  inputs: { task: { type: "string" }, label: { type: "string", choices: ["bug", "feature", "any"], default: "any" } } };
/** Global workflows: every project has them. */
const releaseNotes: TriggerWorkflow = { name: "release-notes", description: "Draft the week's release notes", kind: "prose", hasLandStop: true, inputs: {} };
const docsSweep: TriggerWorkflow = { name: "docs-sweep", description: "Fix stale links and dead examples in docs/", kind: "prose", hasLandStop: true, inputs: {} };
const report: TriggerWorkflow = { name: "nightly-report", description: "Write the build report", kind: "script", hasLandStop: false, inputs: {} };

/** Forgerie's workflows: its own and the global ones. */
export const workflows: TriggerWorkflow[] = [refine, triageIssues, releaseNotes, docsSweep, report];
/**
 * Each project's workflows. pi-mono has no refine-backlog, and its triage-issues declares another default, so
 * neither is common to it and forgerie. caliper has the same as forgerie, without the script.
 */
const inventories: Record<string, TriggerWorkflow[]> = {
  [FORGERIE]: workflows,
  [PI_MONO]: [{ ...triageIssues, inputs: { task: { type: "string" }, label: { type: "string", choices: ["bug", "feature", "any"], default: "bug" } } }, releaseNotes, docsSweep],
  [CALIPER]: [refine, triageIssues, releaseNotes, docsSweep],
};

/** The server's common-workflow rule over the fixture projects, with its diagnostics in its words. */
export function commonWorkflows(targets: TriggerTargets): TriggerWorkflowsResponse {
  const cwds = targets.kind === "all" ? projects.map((project) => project.path) : [...new Set(targets.cwds)];
  const diagnostics: TriggerWorkflowsResponse["diagnostics"] = cwds.filter((cwd) => !inventories[cwd])
    .map((cwd) => ({ name: "", path: cwd, error: `ENOENT: no such file or directory, realpath '${cwd}'` }));
  const listed = cwds.map((cwd) => ({ cwd, workflows: inventories[cwd] ?? [] }));
  const names = [...new Set(listed.flatMap((item) => item.workflows.map((workflow) => workflow.name)))].sort();
  const common: TriggerWorkflow[] = [];
  for (const name of names) {
    const first = listed[0]?.workflows.find((workflow) => workflow.name === name);
    let ok = first !== undefined;
    for (const { cwd, workflows: own } of listed) {
      const workflow = own.find((item) => item.name === name);
      const error = !workflow ? `Workflow is unavailable in ${cwd}` : workflow.kind === "script" ? `Workflow must resolve to prose in ${cwd}`
        : JSON.stringify(workflow.inputs) !== JSON.stringify(first?.inputs) ? `Workflow input declarations differ in ${cwd}` : undefined;
      if (error) { diagnostics.push({ name, path: cwd, error }); ok = false; }
    }
    if (ok && first) common.push(first);
  }
  return { workflows: common, diagnostics };
}

export const models: SessionModel[] = [
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
];

/**
 * The request ID the server records for a Run now, in a length-prefixed form the browser cannot build. The browser
 * learns it only from the 202 answer, as from the real server.
 */
export const serverRunId = (triggerId: string, requestId: string) => `trigger-run:${String(triggerId.length)}:${triggerId}:${String(requestId.length)}:${requestId}`;

export const NOT_FOUND = `Workflow "refine-backlog" was not found in ${FORGERIE}.
The workflow library lists: release-notes, triage-issues, docs-sweep.
Forgerie looked in .forgerie/workflows and ~/.forgerie/workflows.
Restore the file, or choose another workflow on this page.
The trigger keeps its schedule, and the next run tries again.`;

/** One project's outcome, as the fire's per-project list holds it. */
function projectOutcome(outcome: TriggerFire["outcome"]): TriggerProjectFire["outcome"] {
  switch (outcome.kind) {
    case "started": return { kind: "started", sessionId: outcome.sessionId, runId: outcome.runId };
    case "failed": return { kind: "failed", error: outcome.error, ...outcome.sessionId ? { sessionId: outcome.sessionId } : {} };
    default: return outcome;
  }
}
/** A fire in one project: its per-project list holds that project alone. */
const fire = (id: string, occurrence: number, outcome: TriggerFire["outcome"], extra: Partial<TriggerFire> = {}, cwd = FORGERIE): TriggerFire => ({
  occurrence, requestId: `trigger-${id}-${String(occurrence)}`, cause: "schedule", recordedAt: occurrence + 4_000, skippedBefore: 0, outcome,
  projects: [{ cwd: "cwd" in outcome && outcome.cwd ? outcome.cwd : cwd, outcome: projectOutcome(outcome) }], ...extra,
});
const sessionOf = (id: string, n: number) => `01a2${String(n).padStart(4, "0")}-0000-7000-8000-${id.slice(0, 12).padEnd(12, "0")}`;
const started = (id: string, n: number, cwd = FORGERIE): TriggerFire["outcome"] => ({ kind: "started", sessionId: sessionOf(id, n), cwd, runId: `run-${String(n)}` });

/** The server's summary of a fire across projects: still running, else the first failure, the first start, or unavailable. */
function summaryOf(projectFires: readonly TriggerProjectFire[]): TriggerFire["outcome"] {
  const running = projectFires.find((item) => item.outcome.kind === "running");
  if (running?.outcome.kind === "running") return running.outcome;
  for (const kind of ["failed", "started"] as const) {
    const found = projectFires.find((item) => item.outcome.kind === kind);
    if (found?.outcome.kind === "failed") return { kind: "failed", error: found.outcome.error, cwd: found.cwd, ...found.outcome.sessionId ? { sessionId: found.outcome.sessionId } : {} };
    if (found?.outcome.kind === "started") return { kind: "started", sessionId: found.outcome.sessionId, runId: found.outcome.runId, cwd: found.cwd };
  }
  const skipped = projectFires.find((item) => item.outcome.kind === "unavailable");
  return skipped?.outcome.kind === "unavailable" ? skipped.outcome : { kind: "missed" };
}
/** A fire in several projects at once. */
const spread = (id: string, occurrence: number, projectFires: TriggerProjectFire[], extra: Partial<TriggerFire> = {}): TriggerFire => ({
  occurrence, requestId: `trigger-${id}-${String(occurrence)}`, cause: "schedule", recordedAt: occurrence + 4_000, skippedBefore: 0,
  outcome: summaryOf(projectFires), projects: projectFires, ...extra,
});
const ran = (id: string, n: number, cwd: string): TriggerProjectFire => ({ cwd, outcome: { kind: "started", sessionId: sessionOf(id, n), runId: `run-${String(n)}` } });
const one = (cwd: string): TriggerTargets => ({ kind: "projects", cwds: [cwd] });

const base = (id: string, name: string): Pick<Trigger, "id" | "name" | "createdAt" | "createdBy" | "revision" | "generation" | "missedGraceMinutes"> =>
  ({ id, name, createdAt: Date.UTC(2026, 8, 20), createdBy: { kind: "user" }, revision: 12, generation: 3, missedGraceMinutes: 360 });

/** Failed the last two nights: needs a look, in the bad tone. */
export const nightly: Trigger = {
  ...base("nightly-refinement", "Nightly refinement"),
  schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
  action: { kind: "workflow", targets: one(FORGERIE), workflow: "refine-backlog", inputs: { task: "Refine the three oldest ready backlog items." } },
  state: { kind: "active", nextFireAt: night(13) },
  attention: { since: night(11) + 4_000 },
  history: [
    fire("nightly-refinement", night(12), { kind: "failed", error: NOT_FOUND }),
    fire("nightly-refinement", night(11), { kind: "failed", error: NOT_FOUND }),
    fire("nightly-refinement", night(10), started("nightly-refinement", 10)),
    fire("nightly-refinement", night(9, 14, 41), started("nightly-refinement", 9), { cause: "manual", requestId: serverRunId("nightly-refinement", "4f7d") }),
    fire("nightly-refinement", night(9), started("nightly-refinement", 8)),
    fire("nightly-refinement", night(8), { kind: "missed" }, { skippedBefore: 2 }),
    fire("nightly-refinement", night(5), started("nightly-refinement", 5)),
  ],
};

/** Made by an agent; its one run was missed while Forgerie was off: needs a look, in the warn tone. */
export const audit: Trigger = {
  ...base("dependency-audit", "Dependency audit"),
  createdBy: { kind: "agent", sessionId: "01a2ffee-0000-7000-8000-agentsession", cwd: FORGERIE },
  schedule: { kind: "daily", at: "02:30", timezone: HOST_ZONE },
  action: { kind: "workflow", targets: one(PI_MONO), workflow: "triage-issues", inputs: { task: "Check new advisories against the lockfile." } },
  state: { kind: "active", nextFireAt: night(13, 2, 30) },
  attention: { since: night(12, 2, 30) + 4_000 },
  history: [fire("dependency-audit", night(12, 2, 30), { kind: "missed" }, {}, PI_MONO)],
};

export const triage: Trigger = {
  ...base("weekday-triage", "Weekday triage"),
  schedule: { kind: "weekly", at: "09:00", timezone: HOST_ZONE, on: ["mon", "tue", "wed", "thu", "fri"] },
  action: { kind: "workflow", targets: one(PI_MONO), workflow: "triage-issues", inputs: { task: "Triage new issues.", label: "bug" } },
  state: { kind: "active", nextFireAt: night(13, 9) },
  attention: null,
  history: [12, 9, 8, 7, 6, 5, 2].map((day, index) => fire("weekday-triage", night(day, 9), started("weekday-triage", 20 + index, PI_MONO))),
};

export const notes: Trigger = {
  ...base("release-notes", "Release notes"),
  schedule: { kind: "weekly", at: "17:00", timezone: HOST_ZONE, on: ["fri"] },
  action: { kind: "workflow", targets: one(FORGERIE), workflow: "release-notes", inputs: {} },
  state: { kind: "active", nextFireAt: night(16, 17) },
  attention: null,
  history: [],
};

/** A Run now under way: the server has written its running entry. */
export const digest: Trigger = {
  ...base("inbox-digest", "Inbox digest"),
  schedule: { kind: "daily", at: "07:30", timezone: HOST_ZONE },
  action: { kind: "workflow", targets: one(FORGERIE), workflow: "refine-backlog", inputs: { task: "Summarize the inbox." }, model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" },
  state: { kind: "active", nextFireAt: night(13, 7, 30) },
  attention: null,
  history: [
    fire("inbox-digest", NOW - 2 * 60_000, { kind: "running", startedAt: NOW - 2 * 60_000 }, { cause: "manual", requestId: serverRunId("inbox-digest", "a1b2") }),
    fire("inbox-digest", night(12, 7, 30), started("inbox-digest", 31)),
  ],
};

export const docs: Trigger = {
  ...base("docs-sweep", "Docs sweep"),
  schedule: { kind: "weekly", at: "04:00", timezone: "America/New_York", on: ["sun"] },
  action: { kind: "workflow", targets: one(FORGERIE), workflow: "docs-sweep", inputs: {} },
  state: { kind: "paused", pausedAt: Date.UTC(2026, 9, 10, 16) },
  attention: null,
  missedGraceMinutes: 90,
  history: [
    fire("docs-sweep", Date.UTC(2026, 9, 4, 8), { kind: "missed" }),
    fire("docs-sweep", Date.UTC(2026, 8, 27, 8), started("docs-sweep", 40)),
  ],
};

export const NO_FOLDER = `ENOENT: no such file or directory, stat '${OLD_SITE}'`;
const PUSH_FAILED = `Session could not start: the workspace has uncommitted changes in package-lock.json.
Commit or stash them, then run the trigger again.`;

/** Three fixed projects: every one started last night; a week ago one failed. */
export const spreadNotes: Trigger = {
  ...base("weekly-release-notes", "Weekly release notes"),
  schedule: { kind: "weekly", at: "17:00", timezone: HOST_ZONE, on: ["fri"] },
  action: { kind: "workflow", targets: { kind: "projects", cwds: [FORGERIE, PI_MONO, CALIPER] }, workflow: "release-notes", inputs: {} },
  state: { kind: "active", nextFireAt: night(16, 17) },
  attention: null,
  history: [
    spread("weekly-release-notes", night(9, 17), [ran("weekly-release-notes", 51, FORGERIE), ran("weekly-release-notes", 52, PI_MONO), ran("weekly-release-notes", 53, CALIPER)]),
    spread("weekly-release-notes", night(2, 17), [ran("weekly-release-notes", 41, FORGERIE),
      { cwd: PI_MONO, outcome: { kind: "failed", error: PUSH_FAILED } }, ran("weekly-release-notes", 43, CALIPER)]),
  ],
};

/**
 * All projects. Last night one project failed and one, whose folder was gone, was skipped as unavailable: the
 * failure asks for a look, the skipped project does not.
 */
export const everywhere: Trigger = {
  ...base("nightly-docs-sweep", "Nightly docs sweep"),
  schedule: { kind: "daily", at: "04:00", timezone: HOST_ZONE },
  action: { kind: "workflow", targets: { kind: "all" }, workflow: "docs-sweep", inputs: {} },
  state: { kind: "active", nextFireAt: night(13, 4) },
  attention: { since: night(12, 4) + 4_000 },
  history: [
    spread("nightly-docs-sweep", night(12, 4), [ran("nightly-docs-sweep", 61, FORGERIE),
      { cwd: PI_MONO, outcome: { kind: "failed", error: PUSH_FAILED, sessionId: sessionOf("nightly-docs-sweep", 62) } },
      ran("nightly-docs-sweep", 63, CALIPER), { cwd: OLD_SITE, outcome: { kind: "unavailable", reason: NO_FOLDER } }]),
    spread("nightly-docs-sweep", night(11, 4), [ran("nightly-docs-sweep", 54, FORGERIE), ran("nightly-docs-sweep", 55, PI_MONO),
      ran("nightly-docs-sweep", 56, CALIPER), { cwd: OLD_SITE, outcome: { kind: "unavailable", reason: NO_FOLDER } }]),
    spread("nightly-docs-sweep", night(10, 4), [ran("nightly-docs-sweep", 44, FORGERIE), ran("nightly-docs-sweep", 45, PI_MONO),
      ran("nightly-docs-sweep", 46, CALIPER), ran("nightly-docs-sweep", 47, OLD_SITE)]),
  ],
};

const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];
const listOf = (triggers: Trigger[]): TriggerListResponse => ({
  triggers, attentionCount: triggers.filter((trigger) => trigger.attention !== null).length, timezone: HOST_ZONE, timezones: ZONES,
});

/** Every state the list shows: needs a look (failed, missed by an agent's trigger), active, starting, no runs, paused. */
export const mixedList = listOf([nightly, triage, notes, docs, audit, digest, spreadNotes, everywhere]);
export const emptyList = listOf([]);
/** Only what is in the brief's first picture. */
export const calmList = listOf([triage, notes, docs]);

const WORDS = ["Backlog", "Docs", "Release", "Triage", "Inbox", "Audit", "Changelog", "Deps", "Benchmarks", "Screens", "Links", "Translations"];
/** 23 triggers, 4 paused: the list gets its filter and the groups collapse. */
export const manyList = listOf(Array.from({ length: 23 }, (_, index): Trigger => {
  const source = [triage, notes, nightly, docs][index % 4] ?? triage;
  const paused = index % 6 === 5 || index === 22;
  return {
    ...source,
    id: `trigger-${String(index + 1)}`,
    name: `${WORDS[index % WORDS.length] ?? "Task"} ${index < WORDS.length ? "nightly" : "weekly"} ${String(index + 1)}`,
    attention: index === 2 ? source.attention : null,
    state: paused ? { kind: "paused", pausedAt: Date.UTC(2026, 9, 1) } : { kind: "active", nextFireAt: NOW + (index + 1) * 47 * 60_000 },
  };
}));
