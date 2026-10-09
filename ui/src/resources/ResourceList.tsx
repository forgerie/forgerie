import { ListSection } from "../ui/ListSection";
import { ListTools } from "../ui/ListTools";
import { SearchField } from "../ui/SearchField";
import { OptionRow } from "../ui/OptionRow";
import { ToggleGroup } from "../ui/ToggleGroup";
import { resourceKinds, type ResourceEntry, type ResourceKind } from "./resourceApi";
import { inactive, KIND_LABELS, kindCounts, rowFlags, sections } from "./resourceModel";

const SEARCH_LABELS: Record<ResourceKind, string> = { skill: "Search skills", prompt: "Search prompts", context: "Search context files" };
const EMPTY: Record<ResourceKind, string> = {
  skill: "No skills here.", prompt: "No prompt templates here.", context: "No context files here.",
};

/**
 * Organism: the skills, prompt templates and context files one place loads,
 * one kind at a time, in sections by where each file comes from. A file that
 * is hidden, turned off or broken stays in the list, dimmed, with the reason.
 */
export function ResourceList({ entries, kind, query, diagnostics, unsaved, onKind, onQuery, onOpen }: {
  entries: readonly ResourceEntry[];
  kind: ResourceKind; query: string;
  /** Files Pi could not list, in the server's words. */
  diagnostics: readonly string[];
  /** Whether a file has a draft that is not saved. */
  unsaved: (id: string) => boolean;
  onKind: (kind: ResourceKind) => void; onQuery: (query: string) => void; onOpen: (id: string) => void;
}) {
  const counts = kindCounts(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const shown = sections(entries, kind, query);
  return <>
    <ListTools label="Choose files">
      <ToggleGroup label="Kind of file" value={kind} onChange={onKind}
        options={resourceKinds.map((value) => ({ value, label: KIND_LABELS[value], count: counts[value] }))} />
      <SearchField label={SEARCH_LABELS[kind]} value={query} onChange={onQuery} />
    </ListTools>
    {shown.length === 0 ? <ListSection title={KIND_LABELS[kind]} empty={query.trim() ? `Nothing matches “${query.trim()}”.` : EMPTY[kind]} /> : null}
    {shown.map((section) => <ListSection key={section.origin} title={section.title} empty={EMPTY[kind]}
      note={<>{section.roots.length === 1 ? "In " : "In these folders: "}{section.roots.map((root, index) => <span key={root}>{index ? ", " : ""}<code>{root}</code></span>)}</>}>
      {section.entries.map((entry) => <li key={entry.id}><OptionRow name={entry.name} tone={inactive(entry) ? "faint" : "plain"}
        variant={entry.origin.kind === "package" ? entry.origin.source : undefined} onClick={() => onOpen(entry.id)}
        details={[...(entry.description ? [entry.description] : []),
          ...rowFlags(entry, byId, unsaved(entry.id)).map((flag) => flag.tone ? { text: flag.text, strong: true } : flag.text)]} /></li>)}
    </ListSection>)}
    {diagnostics.length ? <ListSection title="Not listed" empty="">
      {diagnostics.map((line) => <li key={line}>{line}</li>)}
    </ListSection> : null}
  </>;
}
