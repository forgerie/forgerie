import { useState } from "react";
import { CalendarClockIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { SettingsFrame } from "../ui/settings/SettingsFrame";
import { HeaderButton } from "../ui/HeaderButton";
import { HeaderIcon } from "../ui/HeaderIcon";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { RecordGroup } from "../ui/RecordGroup";
import { EmptyState } from "../ui/EmptyState";
import { LoadingLines } from "../ui/LoadingLines";
import { ListTools } from "../ui/ListTools";
import { SearchField } from "../ui/SearchField";
import { TriggerRow, type TriggerRowActions } from "./TriggerRow";
import {
  FILTER_FROM, groupTriggers, listOf, matchesFilter, totalWords, triggersPlan, UNMEASURED, type TriggerGroupKey, type TriggerListLoad,
} from "./triggersModel";
import { storeOffWords, type WordClock } from "./triggerWords";
import { targetNames, targetSummary } from "./triggerTargets";

const EMPTY_TEXT = "A trigger starts a saved workflow at a set time, in a new session of each target project. In the morning, you review the work in those sessions.";

/**
 * Shape: every trigger, grouped so a problem comes first: Needs a look, then
 * Active by next run, then Paused. Calm by default; a failed or missed night
 * is marked and waits at the top until the reader marks it as seen.
 */
export function TriggerList({ load, clock, projectLabel, starting, failure, onDismissFailure, onRefresh, onNew, onClose, actions }: {
  load: TriggerListLoad; clock: WordClock;
  projectLabel: (cwd: string) => string;
  /** Triggers with a Run now from this browser that their history does not show yet. */
  starting: ReadonlySet<string>;
  /** A command that failed, such as "Could not pause …". */
  failure?: string | undefined;
  onDismissFailure: () => void;
  onRefresh: () => void; onNew: () => void; onClose: () => void;
  actions: TriggerRowActions;
}) {
  const [room, setRoom] = useState(UNMEASURED);
  const plan = triggersPlan(room.column, room.header, room.body);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<TriggerGroupKey>>(new Set());
  // While the store is off no trigger runs, so the rows of an older read would say things that are not true: the
  // body stays empty under the notice. A plain failed read keeps the last list under its notice.
  const list = load.type === "off" ? undefined : listOf(load);
  const triggers = list?.triggers ?? [];
  const filtering = triggers.length >= FILTER_FROM;
  const shown = filtering ? triggers.filter((trigger) => matchesFilter(trigger, query, `${targetSummary(trigger.action.targets, projectLabel)} ${targetNames(trigger.action.targets, projectLabel)}`)) : triggers;
  const groups = groupTriggers(shown);
  const readError = load.type === "off"
    ? storeOffWords(load.message)
    : load.type === "failed" ? `Could not read triggers: ${load.message}` : undefined;
  const commands: MenuCommand[] = [
    ...plan.primary === "menu" ? [{ label: "New trigger", icon: <PlusIcon aria-hidden />, onSelect: onNew }] : [],
    { label: "Read triggers again", icon: <RefreshCwIcon aria-hidden />, onSelect: onRefresh },
  ];
  const toggle = (key: TriggerGroupKey) => setClosed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return <SettingsFrame title="Triggers" onRoom={setRoom} density={plan.density}
    actions={<>
      {plan.primary === "header" ? <HeaderButton label="New trigger" icon={<PlusIcon aria-hidden size={16} />} onPress={onNew} /> : null}
      <MenuButton label="Trigger commands" commands={commands} />
      <HeaderIcon label="Close triggers" icon={<XIcon aria-hidden />} onPress={onClose} />
    </>}
    error={readError ?? failure}
    recovery={readError ? <button type="button" onClick={onRefresh}>Retry</button> : <button type="button" onClick={onDismissFailure}>Dismiss</button>}>
    {load.type === "loading" ? <LoadingLines label="Reading triggers…" /> : null}
    {list && triggers.length === 0 && load.type === "ready"
      ? <EmptyState icon={<CalendarClockIcon />} title="No triggers yet" action={<HeaderButton label="New trigger" onPress={onNew} />}>{EMPTY_TEXT}</EmptyState> : null}
    {filtering ? <ListTools label="Find a trigger" readout={totalWords(triggers)}>
      <SearchField label="Filter by name, project, or workflow" value={query} onChange={setQuery}
        clear={{ label: "Clear the filter", onClear: () => setQuery("") }} />
    </ListTools> : null}
    {filtering && query.trim() && shown.length === 0 ? <p>No triggers match “{query.trim()}”.</p> : null}
    {groups.map((group) => <RecordGroup key={group.key} label={group.label} count={group.triggers.length} emphasis={group.key === "attention"} compact={plan.density === "compact"}
      open={!closed.has(group.key)} onToggle={() => toggle(group.key)}>
      {group.triggers.map((trigger) => <TriggerRow key={trigger.id} trigger={trigger} clock={clock} projectName={projectLabel}
        plan={plan.row} starting={starting.has(trigger.id)} actions={actions} />)}
    </RecordGroup>)}
  </SettingsFrame>;
}
