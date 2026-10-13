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
import type { WordClock } from "./triggerWords";

const EMPTY_TEXT = "A trigger starts a saved workflow at a set time, in a new session of a project. In the morning, you review the work in that session.";
const sentence = (text: string) => text.trim().replace(/\.+$/u, "");

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
  const list = listOf(load);
  const triggers = list?.triggers ?? [];
  const filtering = triggers.length >= FILTER_FROM;
  const shown = filtering ? triggers.filter((trigger) => matchesFilter(trigger, query, projectLabel(trigger.action.cwd))) : triggers;
  const groups = groupTriggers(shown);
  const readError = load.type === "off"
    ? `Triggers are off: ${sentence(load.message)}. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond.`
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
  return <SettingsFrame title="Triggers" onRoom={setRoom}
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
    {filtering ? <ListTools label="Find a trigger">
      <SearchField label="Filter by name, project, or workflow" value={query} onChange={setQuery}
        clear={{ label: "Clear the filter", onClear: () => setQuery("") }} hint={totalWords(triggers)} />
    </ListTools> : null}
    {filtering && query.trim() && shown.length === 0 ? <p>No triggers match “{query.trim()}”.</p> : null}
    {groups.map((group) => <RecordGroup key={group.key} label={group.label} count={group.triggers.length} emphasis={group.key === "attention"}
      open={!closed.has(group.key)} onToggle={() => toggle(group.key)}>
      {group.triggers.map((trigger) => <TriggerRow key={trigger.id} trigger={trigger} clock={clock} project={projectLabel(trigger.action.cwd)}
        plan={plan.row} starting={starting.has(trigger.id)} actions={actions} />)}
    </RecordGroup>)}
  </SettingsFrame>;
}
