import type { Trigger } from "@shared/triggers";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ToggleGroup } from "../ui/ToggleGroup";
import { whenLong, type WordClock } from "./triggerWords";
import { fixedCwds, isSpread, listWords, shortList } from "./triggerTargets";

/** Run now in every target project, or in one. `cwd` is absent until the reader picks the one. */
export type RunScope = { kind: "all" } | { kind: "one"; cwd?: string | undefined };

/** The one question the screen may ask at a time. */
export type TriggerQuestion =
  | {
    kind: "run"; trigger: Trigger; busy: boolean; error?: string | undefined;
    /** Where this run starts. Every target project unless the reader picks one. */
    scope: RunScope;
    /** The projects one run can be limited to: the fixed targets, or the registered projects under All projects. */
    choices: readonly string[];
    /** A request was sent with this scope. A retry reuses its request ID, so the scope cannot change any more. */
    sent?: boolean | undefined;
  }
  | { kind: "delete"; trigger: Trigger; busy: boolean; error?: string | undefined }
  | { kind: "leave"; name: string };

/**
 * Shape: the screen's confirmations. Run now asks first, because each run
 * costs a whole workflow run in each project; a trigger with several projects
 * can run in all of them or in one. Delete says what goes and what stays.
 * Leaving with unsaved changes asks before the changes are lost.
 */
export function TriggerDialog({ question, clock, projectLabel, onConfirm, onCancel, onScope }: {
  question: TriggerQuestion; clock: WordClock;
  projectLabel: (cwd: string) => string;
  onConfirm: () => void; onCancel: () => void;
  /** The reader changed where Run now starts. */
  onScope?: ((scope: RunScope) => void) | undefined;
}) {
  if (question.kind === "leave") return <ConfirmDialog tone="plain" title="Discard your changes?" confirmLabel="Discard changes" cancelLabel="Keep editing"
    onConfirm={onConfirm} onCancel={onCancel}>
    <p>Your changes to “{question.name}” are not saved.</p>
  </ConfirmDialog>;
  const { trigger, busy, error } = question;
  if (question.kind === "delete") return <ConfirmDialog tone="danger" title={`Delete “${trigger.name}”?`} confirmLabel="Delete trigger" busyLabel="Deleting…"
    busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
    <p>It stops running, and its run history is deleted. The sessions it started stay in your session list.</p>
    {error ? <p role="alert">Could not delete “{trigger.name}”: {error}</p> : null}
  </ConfirmDialog>;
  const after = trigger.state.kind === "paused" ? "The trigger stays paused."
    : `The next scheduled run stays ${whenLong(trigger.state.nextFireAt, trigger.schedule.timezone, clock)}.`;
  const { targets, workflow } = trigger.action;
  if (!isSpread(targets)) return <ConfirmDialog tone="plain" title={`Run “${trigger.name}” now?`} confirmLabel="Run now" busyLabel="Starting…" busy={busy}
    onConfirm={onConfirm} onCancel={onCancel}>
    <p>It starts {workflow} in a new session of {projectLabel(fixedCwds(targets)[0] ?? "")}, as a scheduled run would. {after}</p>
    {error ? <p role="alert">Could not run “{trigger.name}”: {error}</p> : null}
  </ConfirmDialog>;
  const { scope, choices, sent } = question;
  const names = choices.map(projectLabel);
  const where = scope.kind === "one"
    ? scope.cwd ? `It starts ${workflow} in a new session of ${projectLabel(scope.cwd)} only. The trigger keeps its target projects.` : "Choose the project to run in."
    : targets.kind === "all" ? `It starts ${workflow} in a new session of every project, at once${names.length ? `: ${shortList(names)}` : ""}.`
    : `It starts ${workflow} in a new session of each of ${String(targets.cwds.length)} projects, at once: ${listWords(names)}.`;
  return <ConfirmDialog tone="plain" title={`Run “${trigger.name}” now?`} confirmLabel="Run now" busyLabel="Starting…" busy={busy}
    held={scope.kind === "one" && !scope.cwd} onConfirm={onConfirm} onCancel={onCancel}>
    <ToggleGroup field label="Run in" value={scope.kind} onChange={(kind) => onScope?.(kind === "all" ? { kind: "all" } : { kind: "one" })}
      options={[{ value: "all", label: targets.kind === "all" ? "All projects" : "All target projects", disabled: sent },
        { value: "one", label: "One project", disabled: sent }]} />
    {scope.kind === "one" ? <ToggleGroup field label="Project" value={scope.cwd ?? ""} onChange={(cwd) => onScope?.({ kind: "one", cwd })}
      options={choices.map((cwd) => ({ value: cwd, label: projectLabel(cwd), title: cwd, disabled: sent }))} /> : null}
    <p>{where} {scope.kind === "all" ? "Each project's run costs a whole workflow run. " : ""}{after}</p>
    {error ? <p role="alert">Could not run “{trigger.name}”: {error}</p> : null}
  </ConfirmDialog>;
}
