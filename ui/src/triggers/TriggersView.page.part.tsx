import { useState } from "react";
import type { Trigger, TriggerListResponse } from "@shared/triggers";
import { TriggersView, type TriggerNote } from "./TriggersView";
import type { TriggerQuestion } from "./TriggerDialog";
import type { TriggerListLoad } from "./triggersModel";
import { draftOf, draftProblems, emptyDraft, isDirty } from "./triggerDraft";
import { emptyList, HOST_ZONE, mixedList, nightly, workflows } from "./fixtures/triggers";
import { clock, folders, listModels, pageActions, projectLabel, ready, rowActions } from "./fixtures/scenario";

export const name = "Triggers";
export const note = "The triggers screen in the thread's place: the list, a trigger's page, the create page, and their questions";
export const composition = {
  default: [{ part: "src/triggers/TriggerList.template.part.tsx", state: "default" }],
  OneTrigger: [{ part: "src/triggers/TriggerPage.template.part.tsx", state: "default" }],
  RunNow: [{ part: "src/triggers/TriggerDialog.organism.part.tsx", state: "default" }],
};

type Open = { view: "list" } | { view: "trigger"; trigger: Trigger } | { view: "create" };

/** Local state stands in for the binding: a row opens its page, Back returns, Run now… asks, and an answer leaves a message. */
function Screen({ load, open: first = { view: "list" }, asking }: { load: TriggerListLoad; open?: Open; asking?: TriggerQuestion }) {
  const [open, setOpen] = useState<Open>(first);
  const [question, setQuestion] = useState(asking);
  const [note, setNote] = useState<TriggerNote>();
  const trigger = open.view === "trigger" ? open.trigger : undefined;
  const base = trigger ? draftOf(trigger) : emptyDraft(HOST_ZONE);
  const [draft, setDraft] = useState(base);
  const workflow = workflows.find((item) => item.name === draft.workflow);
  const ask = (target: Trigger) => setQuestion({ kind: "run", trigger: target, busy: false });
  return <TriggersView clock={clock} projectLabel={projectLabel} question={question} note={note}
    onConfirm={() => { setNote({ text: question?.kind === "run" ? `“${question.trigger.name}” is starting. Its session shows under Runs once it opens.` : "Done." }); setQuestion(undefined); }}
    onCancel={() => setQuestion(undefined)} onDismissNote={() => setNote(undefined)}
    screen={open.view === "list" ? { view: "list", list: { load, clock, projectLabel, starting: new Set(), onDismissFailure: () => undefined,
      onRefresh: () => undefined, onNew: () => setOpen({ view: "create" }), onClose: () => undefined,
      actions: { ...rowActions, onOpen: (target) => { setDraft(draftOf(target)); setOpen({ view: "trigger", trigger: target }); }, onRunNow: ask } } }
      : { view: "page", page: { load: { type: "ready", trigger }, draft, dirty: isDirty(draft, base), problems: draftProblems(draft, workflow), save: { type: "idle" },
        conflict: false, clock, starting: false, projectLabel: draft.cwd ? projectLabel(draft.cwd) : "Choose a project", projects: folders, workflows: ready,
        listModels, timezones: mixedList.timezones,
        actions: { ...pageActions, onDraft: setDraft, onBack: () => setOpen({ view: "list" }), onRunNow: () => { if (trigger) ask(trigger); } } } }} />;
}
const listed = (value: TriggerListResponse): TriggerListLoad => ({ type: "ready", value });
export default function List() { return <Screen load={listed(mixedList)} />; }
export function Empty() { return <Screen load={listed(emptyList)} />; }
export function StoreOff() { return <Screen load={{ type: "off", message: "Could not open the trigger store: database is locked" }} />; }
export function OneTrigger() { return <Screen load={listed(mixedList)} open={{ view: "trigger", trigger: nightly }} />; }
export function Create() { return <Screen load={listed(mixedList)} open={{ view: "create" }} />; }
export function RunNow() { return <Screen load={listed(mixedList)} open={{ view: "trigger", trigger: nightly }} asking={{ kind: "run", trigger: nightly, busy: false }} />; }
export function Delete() { return <Screen load={listed(mixedList)} asking={{ kind: "delete", trigger: nightly, busy: false }} />; }
