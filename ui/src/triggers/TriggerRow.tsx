import { CheckIcon, PauseIcon, PencilIcon, PlayIcon, SquareArrowOutUpRightIcon, Trash2Icon, ZapIcon } from "lucide-react";
import type { Trigger } from "@shared/triggers";
import { RecordRow } from "../ui/RecordRow";
import { MarkStrip } from "../ui/MarkStrip";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { attentionTone, type TriggersPlan } from "./triggersModel";
import { outcomeWords, relativeShort, rowLabel, scheduleWords, stripMarks, type WordClock } from "./triggerWords";
import { targetChip, targetNames, targetSummary, type ProjectName } from "./triggerTargets";

export interface TriggerRowActions {
  onOpen: (trigger: Trigger) => void;
  /** Opens the trigger's page with the name ready to edit. */
  onEdit: (trigger: Trigger) => void;
  onAcknowledge: (trigger: Trigger) => void;
  onPause: (trigger: Trigger) => void;
  onResume: (trigger: Trigger) => void;
  onRunNow: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
}

/**
 * Shape: one trigger in the list. A press opens its page. The marks show its
 * last runs; the line beside them says how the last one went. Its meta names
 * the target projects: one by name, several by count, or All projects. Its
 * state action (Mark as seen, Resume) is inline while the row is wide and first
 * in ⋯ when not.
 */
export function TriggerRow({ trigger, clock, projectName, plan, starting, actions }: {
  trigger: Trigger; clock: WordClock;
  /** A project's name, as the session list names it. */
  projectName: ProjectName;
  plan: TriggersPlan["row"];
  /** A Run now from this browser that the history does not show yet. */
  starting: boolean;
  actions: TriggerRowActions;
}) {
  const paused = trigger.state.kind === "paused";
  const byAgent = trigger.createdBy.kind === "agent" ? trigger.createdBy : undefined;
  const latest = trigger.history[0];
  const showStarting = starting && latest?.outcome.kind !== "running";
  const state = trigger.attention !== null ? { label: "Mark as seen", icon: <CheckIcon aria-hidden />, run: () => actions.onAcknowledge(trigger) }
    : paused ? { label: "Resume", icon: <PlayIcon aria-hidden />, run: () => actions.onResume(trigger) } : undefined;
  const commands: (MenuCommand | "separator")[] = [
    ...state && plan.stateAction === "menu" ? [{ label: state.label, icon: state.icon, onSelect: state.run }] : [],
    { label: "Run now…", icon: <ZapIcon aria-hidden />, onSelect: () => actions.onRunNow(trigger) },
    ...paused ? [] : [{ label: "Pause", icon: <PauseIcon aria-hidden />, onSelect: () => actions.onPause(trigger) }],
    { label: "Edit", icon: <PencilIcon aria-hidden />, onSelect: () => actions.onEdit(trigger) },
    ...byAgent ? [{ label: "Open the agent's session", icon: <SquareArrowOutUpRightIcon aria-hidden />,
      onSelect: () => actions.onOpenSession({ id: byAgent.sessionId, cwd: byAgent.cwd }) }] : [],
    "separator",
    { label: "Delete trigger…", icon: <Trash2Icon aria-hidden />, tone: "danger", onSelect: () => actions.onDelete(trigger) },
  ];
  const schedule = scheduleWords(trigger.schedule, clock.hostZone, clock.locale);
  return <RecordRow layout={plan.tier} dimmed={paused} mark={attentionTone(trigger)}
    label={`${rowLabel(trigger, clock)} Runs in ${targetChip(trigger.action.targets, projectName) ?? "no project"}.${showStarting ? " A run is starting." : ""}${byAgent ? " Made by an agent." : ""}`}
    title={trigger.name} time={trigger.state.kind === "active" ? relativeShort(trigger.state.nextFireAt, clock.now) : "Paused"}
    meta={[
      { key: "schedule", text: schedule },
      { key: "project", text: targetSummary(trigger.action.targets, projectName), title: targetNames(trigger.action.targets, projectName) },
      { key: "workflow", text: trigger.action.workflow },
      ...byAgent ? [{ key: "agent", text: "Made by an agent" }] : [],
    ]}
    strip={<MarkStrip marks={stripMarks(trigger.history, showStarting)} limit={plan.marks} quiet={paused} />}
    outcome={showStarting ? "Starting…" : outcomeWords(latest, trigger.schedule.timezone, clock)}
    action={state && plan.stateAction === "inline" ? { label: state.label, onPress: state.run } : undefined}
    menu={<MenuButton label={`Commands for ${trigger.name}`} commands={commands} layer="window" />}
    onOpen={() => actions.onOpen(trigger)} />;
}
