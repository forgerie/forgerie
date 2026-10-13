// Fixture triggers for parts, tests, and the capture page. Fixed instants: the
// evening of Mon, Oct 12 2026 in Denver, after a night whose run failed.
import type { Trigger, TriggerFire, TriggerListResponse, TriggerWorkflow } from "@shared/triggers";
import type { Project } from "../../newSession";
import type { SessionModel } from "../../contracts";
import { wireDays, wireThinkingLevel } from "../triggerWire";

export const HOST_ZONE = "America/Denver";
/** Mon, Oct 12 2026, 6:00 PM in Denver (UTC−6). */
export const NOW = Date.UTC(2026, 9, 13, 0, 0);
/** 3:00 AM in Denver on Oct `day` of 2026. */
const night = (day: number, hour = 3, minute = 0) => Date.UTC(2026, 9, day, hour + 6, minute);

export const FORGERIE = "/home/simonwjackson/code/sandbox/forgerie";
export const PI_MONO = "/home/simonwjackson/code/pi-mono";
export const projects: Project[] = [
  { id: "forgerie", name: "forgerie", path: FORGERIE },
  { id: "pi-mono", name: "pi-mono", path: PI_MONO },
];

export const workflows: TriggerWorkflow[] = [
  { name: "refine-backlog", description: "Refine the oldest ready backlog items and open a land card", kind: "prose", hasLandStop: true,
    inputs: { task: { type: "string", description: "What to refine" } } },
  { name: "triage-issues", description: "Sort new issues into the backlog", kind: "prose", hasLandStop: false,
    inputs: { task: { type: "string" }, label: { type: "string", choices: ["bug", "feature", "any"], default: "any" } } },
  { name: "release-notes", description: "Draft the week's release notes", kind: "prose", hasLandStop: true, inputs: {} },
  { name: "docs-sweep", description: "Fix stale links and dead examples in docs/", kind: "prose", hasLandStop: true, inputs: {} },
  { name: "nightly-report", description: "Write the build report", kind: "script", hasLandStop: false, inputs: {} },
];

export const models: SessionModel[] = [
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
];

export const NOT_FOUND = `Workflow "refine-backlog" was not found in ${FORGERIE}.
The workflow library lists: release-notes, triage-issues, docs-sweep.
Forgerie looked in .forgerie/workflows and ~/.forgerie/workflows.
Restore the file, or choose another workflow on this page.
The trigger keeps its schedule, and the next run tries again.`;

const fire = (id: string, occurrence: number, outcome: TriggerFire["outcome"], extra: Partial<TriggerFire> = {}): TriggerFire => ({
  occurrence, requestId: `trigger-${id}-${String(occurrence)}`, cause: "schedule", recordedAt: occurrence + 4_000, skippedBefore: 0, outcome, ...extra,
});
const started = (id: string, n: number): TriggerFire["outcome"] =>
  ({ kind: "started", sessionId: `01a2${String(n).padStart(4, "0")}-0000-7000-8000-${id.slice(0, 12).padEnd(12, "0")}`, cwd: FORGERIE, runId: `run-${String(n)}` });

const base = (id: string, name: string): Pick<Trigger, "id" | "name" | "createdAt" | "createdBy" | "revision" | "generation" | "missedGraceMinutes"> =>
  ({ id, name, createdAt: Date.UTC(2026, 8, 20), createdBy: { kind: "user" }, revision: 12, generation: 3, missedGraceMinutes: 360 });

/** Failed the last two nights: needs a look, in the bad tone. */
export const nightly: Trigger = {
  ...base("nightly-refinement", "Nightly refinement"),
  schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
  action: { kind: "workflow", cwd: FORGERIE, workflow: "refine-backlog", inputs: { task: "Refine the three oldest ready backlog items." } },
  state: { kind: "active", nextFireAt: night(13) },
  attention: { since: night(11) + 4_000 },
  history: [
    fire("nightly-refinement", night(12), { kind: "failed", error: NOT_FOUND }),
    fire("nightly-refinement", night(11), { kind: "failed", error: NOT_FOUND }),
    fire("nightly-refinement", night(10), started("nightly-refinement", 10)),
    fire("nightly-refinement", night(9, 14, 41), started("nightly-refinement", 9), { cause: "manual", requestId: "trigger-nightly-refinement-run-4f7d" }),
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
  action: { kind: "workflow", cwd: PI_MONO, workflow: "triage-issues", inputs: { task: "Check new advisories against the lockfile." } },
  state: { kind: "active", nextFireAt: night(13, 2, 30) },
  attention: { since: night(12, 2, 30) + 4_000 },
  history: [fire("dependency-audit", night(12, 2, 30), { kind: "missed" })],
};

export const triage: Trigger = {
  ...base("weekday-triage", "Weekday triage"),
  schedule: { kind: "weekly", at: "09:00", timezone: HOST_ZONE, on: wireDays(["mon", "tue", "wed", "thu", "fri"]) },
  action: { kind: "workflow", cwd: PI_MONO, workflow: "triage-issues", inputs: { task: "Triage new issues.", label: "any" } },
  state: { kind: "active", nextFireAt: night(13, 9) },
  attention: null,
  history: [12, 9, 8, 7, 6, 5, 2].map((day, index) => fire("weekday-triage", night(day, 9), started("weekday-triage", 20 + index))),
};

export const notes: Trigger = {
  ...base("release-notes", "Release notes"),
  schedule: { kind: "weekly", at: "17:00", timezone: HOST_ZONE, on: wireDays(["fri"]) },
  action: { kind: "workflow", cwd: FORGERIE, workflow: "release-notes", inputs: {} },
  state: { kind: "active", nextFireAt: night(16, 17) },
  attention: null,
  history: [],
};

/** A Run now under way: the server has written its running entry. */
export const digest: Trigger = {
  ...base("inbox-digest", "Inbox digest"),
  schedule: { kind: "daily", at: "07:30", timezone: HOST_ZONE },
  action: { kind: "workflow", cwd: FORGERIE, workflow: "refine-backlog", inputs: { task: "Summarize the inbox." }, model: "anthropic/claude-sonnet-4-5", thinkingLevel: wireThinkingLevel("high") },
  state: { kind: "active", nextFireAt: night(13, 7, 30) },
  attention: null,
  history: [
    fire("inbox-digest", NOW - 2 * 60_000, { kind: "running", startedAt: NOW - 2 * 60_000 }, { cause: "manual", requestId: "trigger-inbox-digest-run-a1b2" }),
    fire("inbox-digest", night(12, 7, 30), started("inbox-digest", 31)),
  ],
};

export const docs: Trigger = {
  ...base("docs-sweep", "Docs sweep"),
  schedule: { kind: "weekly", at: "04:00", timezone: "America/New_York", on: wireDays(["sun"]) },
  action: { kind: "workflow", cwd: FORGERIE, workflow: "docs-sweep", inputs: {} },
  state: { kind: "paused", pausedAt: Date.UTC(2026, 9, 10, 16) },
  attention: null,
  missedGraceMinutes: 90,
  history: [
    fire("docs-sweep", Date.UTC(2026, 9, 4, 8), { kind: "missed" }),
    fire("docs-sweep", Date.UTC(2026, 8, 27, 8), started("docs-sweep", 40)),
  ],
};

const ZONES = ["America/Denver", "America/New_York", "America/Los_Angeles", "Europe/Berlin", "Europe/London", "Asia/Tokyo", "UTC"];
const listOf = (triggers: Trigger[]): TriggerListResponse => ({
  triggers, attentionCount: triggers.filter((trigger) => trigger.attention !== null).length, timezone: HOST_ZONE, timezones: ZONES,
});

/** Every state the list shows: needs a look (failed, missed by an agent's trigger), active, starting, no runs, paused. */
export const mixedList = listOf([nightly, triage, notes, docs, audit, digest]);
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
