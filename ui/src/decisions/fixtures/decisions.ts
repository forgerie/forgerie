import type { Decision } from "../decisionsModel";

/** The parts' clock: every age below is measured from it. */
export const LOG_NOW = 1791502400000;
const MIN = 60_000;
/** The run in ui/src/workflows/fixtures/runs.ts. */
export const RUN_ID = "7f1c2a9b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";

export const ANSWER: Decision = {
  id: "d-1", at: LOG_NOW - 4 * MIN, kind: "child-answer", by: "parent", runId: RUN_ID,
  question: "Should the CSV include archived runs?",
  choice: "No, only active runs.",
  reason: "The contract lists active runs only, and the task says nothing about archived ones.",
  flagged: false, state: { kind: "standing" },
};
export const GUESS: Decision = {
  id: "d-2", at: LOG_NOW - 12 * MIN, kind: "guess", by: "parent", runId: RUN_ID,
  question: "The contract says both “newest first” and “group by stage”. Which wins?",
  choice: "Newest first, with the stage as a label on each row.",
  reason: "Grouping hides the order the reader asked to scan. The user’s note on the contract said newest first.",
  flagged: true, state: { kind: "standing" },
};
export const OVERTURNED: Decision = {
  id: "d-3", at: LOG_NOW - 70 * MIN, kind: "guess", by: "parent", runId: RUN_ID,
  question: "Export button: in the header or under the table?",
  choice: "Under the table, beside the row count.",
  reason: "The header is full at the folded width.",
  flagged: true, state: { kind: "overturned", note: "Put it in the header menu. The table foot is for paging.", at: LOG_NOW - 3 * MIN },
};
/** The reader's own answer to an escalated question, outside the run. */
export const SESSION_ANSWER: Decision = {
  id: "d-4", at: LOG_NOW - 26 * 60 * MIN, kind: "child-answer", by: "user",
  question: "Use the existing date helper in src/shared/time.ts, or add a new one for the CSV’s ISO dates?",
  choice: "Use the existing helper and add an ISO variant beside it.",
  reason: "One module for dates keeps the time zone rules in one place.",
  flagged: false, state: { kind: "standing" },
};
export const LONG: Decision = {
  id: "d-5", at: LOG_NOW - 3 * 24 * 60 * MIN, kind: "child-answer", by: "parent",
  question: "Rename src/server/sessions/durableDecisionsRepositoryAdapterForTheLongPathCase.ts, or keep the name the build worker chose?",
  choice: "Keep the name. Renaming it now would touch twelve imports across three branches that are still open, and the reviewer has already read it under this name.",
  reason: "A rename can follow once every branch has landed.",
  flagged: false, state: { kind: "standing" },
};

/** Newest first, as the server sends them. */
export const RUN_DECISIONS: Decision[] = [ANSWER, GUESS, OVERTURNED];
export const SESSION_DECISIONS: Decision[] = [ANSWER, GUESS, OVERTURNED, SESSION_ANSWER, LONG];
