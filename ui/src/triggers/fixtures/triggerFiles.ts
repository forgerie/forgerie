// Fixture workflow files for parts, tests, and the capture page: a nightly maintenance workflow whose front matter
// holds its schedule, as the file, as the server reads it, and as the versions Forgerie kept. Fixed instants, as in
// ./triggers: the evening of Mon, Oct 12 2026 in Denver.
import type { TriggerFire, TriggerProjectFire } from "@shared/triggers";
import type { TriggerFileDocument, TriggerFileVersionText, WorkflowScheduleBlock } from "@shared/triggerFiles";
import type { WorkflowDefinition } from "@shared/workflowRuns";
import type { FileTrigger } from "../triggersApi";
import { CALIPER, FORGERIE, HOST_ZONE, PI_MONO } from "./triggers";

export const AGENT_DIR = "/home/simonwjackson/.local/share/forgerie/agent";
export const MAINTENANCE_PATH = `${AGENT_DIR}/prompts/nightly-maintenance.md`;

/** A stand-in for SHA-256: 64 hex digits that change with the text. Fixtures only compare hashes. */
export function fakeSha(text: string): string {
  let hash = 0x811c9dc5;
  const words: string[] = [];
  for (let round = 0; round < 8; round++) {
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index) ^ round, 0x01000193) >>> 0;
    words.push(hash.toString(16).padStart(8, "0"));
  }
  return words.join("");
}

const FRONT = (at: string, extra = "") => `---
description: Fix failing tests, keep checks fast, and simplify code overnight so the user never wakes up worse off; land only after approval.
schedule:
  name: Nightly maintenance
  at: ${at}
  timezone: America/Denver
  late: 6h
  projects: [forgerie, pi-mono, caliper]
  model: openai/gpt-5
${extra}workflow:
  version: 1
  inputs:
    improvements:
      type: number
      description: Most improvements per night
      default: 2
    deadline:
      type: number
      description: Coordination deadline, minutes
      default: 180
    commits:
      type: number
      description: Recent commits to read
      default: 150
  stages:
    - id: measure
      name: Measure bedtime
      workers:
        - name: measure
          agent: full-stack-engineer
        - name: history-scout
          agent: scout
    - id: explore
      name: Explore and select
      workers:
        - name: scout-one
          agent: scout
    - id: fix
      name: Fix, simplify, and test
      workers:
        - name: engineer
          agent: full-stack-engineer
    - id: review
      name: Independently review
      workers:
        - name: reviewer
          agent: reviewer
    - id: report
      name: Write the morning page
      workers:
        - name: report-writer
          agent: design-engineer
          model: anthropic/claude-opus-4-5:high
    - id: approve
      name: Approve landing
      stop: approve
    - id: land
      name: Rebase, verify, and fast-forward
      stop: land
---
`;

const BODY = `
This run starts at night with nobody watching. Its one rule: **the user must never wake up worse off than when they went to bed.** Measure the project's health at bedtime. Fix every failing test. Then try to make at least one health signal better: a faster check, faster code, or a smaller and simpler codebase.

Do not ask the user questions during the run. Make reasonable choices and record them.

## Ownership and limits

One run owns one project: the project of the launching session. Do not discover or change other projects.

Allowed work, in priority order:

1. **Failing tests.** Any test that fails or fails at random on the base branch must be addressed.
2. **Regressions since last night.** A health signal that got worse during the day's work.
3. **The daytime check.** Make the fast check for a small change run only the tests that change can affect.

## Measure bedtime

Verify the repository root, coordinator worktree, current HEAD, and working-tree status. Preserve unrelated files.
`;

export const MAINTENANCE_TEXT = `${FRONT('"01:00"')}${BODY}`;
/** The same file after an edit outside Forgerie: `at` is no longer a time. Line 5. */
export const BROKEN_TEXT = `${FRONT("1am")}${BODY}`;
/** The same file with its schedule block removed. */
export const UNSCHEDULED_TEXT = MAINTENANCE_TEXT.replace(/schedule:\n(?: {2}.*\n)+/u, "");

export const maintenanceSchedule: WorkflowScheduleBlock = {
  name: "Nightly maintenance", at: "01:00", timezone: "America/Denver", late: "6h", projects: ["forgerie", "pi-mono", "caliper"], model: "openai/gpt-5",
};
export const maintenanceDefinition: WorkflowDefinition = {
  version: 1,
  inputs: {
    improvements: { type: "number", description: "Most improvements per night", default: 2 },
    deadline: { type: "number", description: "Coordination deadline, minutes", default: 180 },
    commits: { type: "number", description: "Recent commits to read", default: 150 },
  },
  stages: [
    { id: "measure", name: "Measure bedtime", workers: [{ name: "measure", agent: "full-stack-engineer" }, { name: "history-scout", agent: "scout" }] },
    { id: "explore", name: "Explore and select", workers: [{ name: "scout-one", agent: "scout" }] },
    { id: "fix", name: "Fix, simplify, and test", workers: [{ name: "engineer", agent: "full-stack-engineer" }] },
    { id: "review", name: "Independently review", workers: [{ name: "reviewer", agent: "reviewer" }] },
    { id: "report", name: "Write the morning page", workers: [{ name: "report-writer", agent: "design-engineer", model: "anthropic/claude-opus-4-5:high" }] },
    { id: "approve", name: "Approve landing", stop: "approve" },
    { id: "land", name: "Rebase, verify, and fast-forward", stop: "land" },
  ],
};

const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/u, "");
/** The file as the server reads it. */
export function documentOf(text: string, schedule: WorkflowScheduleBlock | null, modifiedAt = Date.UTC(2026, 9, 12, 15, 41)): TriggerFileDocument {
  return { path: MAINTENANCE_PATH, text, sha256: fakeSha(text), modifiedAt, schedule, definition: maintenanceDefinition, body: bodyOf(text) };
}
export const maintenanceDocument = documentOf(MAINTENANCE_TEXT, maintenanceSchedule);
export const brokenDocument = documentOf(BROKEN_TEXT, null, Date.UTC(2026, 9, 12, 22, 5));
export const unscheduledDocument = documentOf(UNSCHEDULED_TEXT, null, Date.UTC(2026, 9, 12, 22, 5));

/** 1:00 AM in Denver on Oct `day` of 2026. */
const oneAm = (day: number) => Date.UTC(2026, 9, day, 7, 0);
const TARGETS = [FORGERIE, PI_MONO, CALIPER];
const ranAll = (day: number): TriggerFire => {
  const projects: TriggerProjectFire[] = TARGETS.map((cwd, index) => ({ cwd, outcome: { kind: "started", sessionId: `01a3${String(day)}${String(index)}-0000-7000-8000-maintenance0`, runId: `run-${String(day)}-${String(index)}` } }));
  return { occurrence: oneAm(day), requestId: `trigger-nightly-maintenance-${String(oneAm(day))}`, cause: "schedule", recordedAt: oneAm(day) + 4_000, skippedBefore: 0,
    outcome: { kind: "started", sessionId: `01a3${String(day)}0-0000-7000-8000-maintenance0`, cwd: FORGERIE, runId: `run-${String(day)}-0` }, projects };
};

/** The schedule in the file is the one that runs. */
export const maintenance: FileTrigger = {
  id: "nightly-maintenance", name: "Nightly maintenance", createdAt: Date.UTC(2026, 9, 1), createdBy: { kind: "user" }, revision: 8, generation: 2, missedGraceMinutes: 360,
  schedule: { kind: "daily", at: "01:00", timezone: HOST_ZONE },
  action: { kind: "workflow", targets: { kind: "projects", cwds: TARGETS }, workflow: "nightly-maintenance", inputs: {}, model: "openai/gpt-5" },
  state: { kind: "active", nextFireAt: oneAm(13) },
  attention: null,
  history: [ranAll(12), ranAll(11), ranAll(10)],
  file: { path: MAINTENANCE_PATH, status: "ok", lastGoodAt: Date.UTC(2026, 9, 12, 15, 41) },
};
/** An edit outside Forgerie broke line 5. The last good settings keep running. */
export const brokenMaintenance: FileTrigger = {
  ...maintenance, revision: 9,
  file: { path: MAINTENANCE_PATH, status: "invalid", lastGoodAt: Date.UTC(2026, 9, 12, 15, 41),
    problem: { line: 5, message: "`at` must be a time such as \"01:00\". The file now says \"1am\"." } },
};
/** The schedule block, or the whole file, is gone: the trigger is paused and keeps its history. */
export const unscheduledMaintenance: FileTrigger = {
  ...maintenance, revision: 10, state: { kind: "paused", pausedAt: Date.UTC(2026, 9, 12, 22, 5) },
  file: { path: MAINTENANCE_PATH, status: "missing", lastGoodAt: Date.UTC(2026, 9, 12, 15, 41) },
};

/** What Forgerie kept, newest first. */
export const maintenanceVersions: TriggerFileVersionText[] = [
  { id: "v3", savedAt: Date.UTC(2026, 9, 12, 15, 41), source: "forgerie", sha256: fakeSha(MAINTENANCE_TEXT), text: MAINTENANCE_TEXT },
  { id: "v2", savedAt: Date.UTC(2026, 9, 12, 15, 20), source: "outside", sha256: fakeSha(MAINTENANCE_TEXT.replace('"01:00"', '"00:30"')),
    text: MAINTENANCE_TEXT.replace('"01:00"', '"00:30"') },
  { id: "v1", savedAt: Date.UTC(2026, 9, 10, 2, 2), source: "migration", sha256: fakeSha(MAINTENANCE_TEXT.replace(BODY, "\nRun the nightly checks.\n")),
    text: MAINTENANCE_TEXT.replace(BODY, "\nRun the nightly checks.\n") },
];
export const versionList = maintenanceVersions.map((version) => ({ id: version.id, savedAt: version.savedAt, source: version.source, sha256: version.sha256 }));
