import { useRef, useState, type RefObject } from "react";
import { PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { chainEntryProblem, MAX_MODEL_CHAIN_LENGTH, type ModelChains } from "@shared/modelChains";
import type { SessionModel } from "../contracts";
import { modelKey } from "../modelChoice";
import { thinkingLevelsFor } from "../newSession";
import { ActionRow } from "../ui/ActionRow";
import { Consequence } from "../ui/Consequence";
import { ListSection } from "../ui/ListSection";
import { MenuButton } from "../ui/MenuButton";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ui/ModelPicker";
import { ReorderList } from "../ui/ReorderList";
import { TextButton } from "../ui/TextButton";
import { TextSubmit } from "../ui/TextSubmit";
import { chainUsers, entryOf, entryParts, listWords, moveItem, nameProblem, renameChain, withChain, withoutChain } from "./modelChains";

/** What the Models page gives the chains section. */
export interface ModelChainsSectionProps {
  /** The chains as the page holds them, in the file's order. */
  chains: ModelChains;
  /** Why Forgerie ignores every chain in the file. While it is set the section shows the chains and changes nothing. */
  problem: string | null;
  /** The models a signed-in provider offers. */
  models: readonly SessionModel[];
  /** The agents Settings knows, to say which name a chain and to warn before one they name goes away. Undefined while unknown. */
  agents: readonly { name: string; model?: string | undefined }[] | undefined;
  /** A save failed, and nothing changes until the page reads the lists again. */
  locked: boolean;
  /** Where the chains are saved, as the page names paths. */
  where: string;
  onChange: (chains: ModelChains) => void;
}

const COPY = {
  title: "Model chains",
  help: "A child agent that names a chain tries its first model first, and moves down the list when a model is unavailable.",
  empty: "No chains yet. Create one, then choose it as an agent's model.",
  pending: "Add a model to save this chain.",
  limit: `A chain holds at most ${String(MAX_MODEL_CHAIN_LENGTH)} models.`,
  lastEntry: "A chain keeps at least one model. Delete the chain instead.",
  unavailable: "No signed-in provider offers this model, so runs skip it.",
  nameHint: "Agents name the chain by it: lower-case letters, digits and hyphens.",
  inherit: { id: "inherit", label: "Inherit" },
} as const;
const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
/** One key per entry that survives a move: the entry, and which of its repeats it is. */
const rowKeys = (entries: readonly string[]) => entries.map((entry, index) => `${entry}#${String(entries.slice(0, index).filter((other) => other === entry).length)}`);

type Slot = number | "add";

/**
 * Shape: Settings > Models > Model chains. Each chain is a row with its entries in order under it. Changes save at
 * once, as the rest of the page does; a new chain waits here until its first model is chosen, since a chain holds at
 * least one. Renaming or deleting a chain that agents name asks first, because those agents stop finding it.
 */
export function ModelChainsSection({ chains, problem, models, agents, locked, where, onChange }: ModelChainsSectionProps) {
  /** New chains with no model yet. They are not saved, and live as long as the page. */
  const [pending, setPending] = useState<string[]>([]);
  const [creating, setCreating] = useState<{ error?: string | undefined }>();
  const [renaming, setRenaming] = useState<{ name: string; error?: string | undefined }>();
  const [deleting, setDeleting] = useState<string>();
  const [open, setOpen] = useState<{ chain: string; slot: Slot; at: PickerOpen }>();
  const anchors = useRef(new Map<string, RefObject<HTMLSpanElement | null>>());
  const anchor = (chain: string, slot: Slot) => {
    const key = `${chain}\n${String(slot)}`;
    let ref = anchors.current.get(key);
    if (!ref) { ref = { current: null }; anchors.current.set(key, ref); }
    return ref;
  };
  const frozen = locked || problem !== null;
  const names = [...Object.keys(chains), ...pending.filter((name) => !Object.hasOwn(chains, name))];
  const listModels = async () => [...models];
  const modelFor = (key: string): SessionModel => {
    const offered = models.find((model) => modelKey(model) === key);
    if (offered) return offered;
    const slash = key.indexOf("/");
    return slash > 0 ? { provider: key.slice(0, slash), id: key.slice(slash + 1), name: key } : { id: key, name: key };
  };
  const offered = (key: string) => models.some((model) => modelKey(model) === key);

  /** Saves a chain's entries. A new chain is saved with its first model. */
  const save = (name: string, entries: readonly string[]) => {
    onChange(withChain(chains, name, entries));
    setPending((current) => current.filter((item) => item !== name));
  };
  const remove = (name: string) => {
    setDeleting(undefined);
    if (renaming?.name === name) setRenaming(undefined);
    if (Object.hasOwn(chains, name)) onChange(withoutChain(chains, name));
    setPending((current) => current.filter((item) => item !== name));
  };
  const rename = (from: string, to: string) => {
    if (Object.hasOwn(chains, from)) onChange(renameChain(chains, from, to));
    setPending((current) => current.map((item) => item === from ? to : item));
    setRenaming(undefined);
  };
  const pickerProps = (chain: string, slot: Slot) => ({
    anchor: anchor(chain, slot),
    open: open?.chain === chain && open.slot === slot ? open.at : undefined,
    onOpenChange: (at: PickerOpen | undefined) => { setOpen(at ? { chain, slot, at } : undefined); },
  });

  const entryBinding = (chain: string, entries: readonly string[], index: number): ModelBinding => {
    const { key, level } = entryParts(entries[index] ?? "");
    const model = modelFor(key);
    const replace = (entry: string) => { save(chain, entries.map((item, at) => at === index ? entry : item)); };
    return {
      model, thinkingLevel: level, disabled: frozen, unsetLevel: COPY.inherit,
      listModels, listThinkingLevels: async () => thinkingLevelsFor(models.find((item) => modelKey(item) === key)),
      onModel: async (provider, id) => {
        // A level stays with the entry while the new model can think.
        const next = models.find((item) => item.provider === provider && item.id === id);
        replace(entryOf(`${provider}/${id}`, next?.reasoning === false ? undefined : level));
      },
      onThinkingLevel: async (picked) => { replace(entryOf(key, picked === COPY.inherit.id ? undefined : picked)); },
    };
  };
  const addBinding = (chain: string, entries: readonly string[]): ModelBinding => ({
    disabled: frozen || entries.length >= MAX_MODEL_CHAIN_LENGTH, thinking: false, listModels, listThinkingLevels: async () => [],
    onModel: async (provider, id) => { save(chain, [...entries, `${provider}/${id}`]); },
    onThinkingLevel: async () => undefined,
  });

  const create = async (value: string) => {
    const refused = nameProblem(value, names);
    setCreating({ error: refused });
    if (refused) throw new Error(refused);
    setPending((current) => [...current, value]);
    setCreating(undefined);
    // A chain is saved with its first model, so the model list opens at once.
    setOpen({ chain: value, slot: "add", at: { query: "" } });
  };
  const submitRename = async (from: string, value: string) => {
    if (value === from) { setRenaming(undefined); return; }
    const refused = nameProblem(value, names.filter((name) => name !== from));
    setRenaming({ name: from, error: refused });
    if (refused) throw new Error(refused);
    const users = agents ? chainUsers(agents, from) : [];
    if (users.length === 0 || !Object.hasOwn(chains, from)) { rename(from, value); return; }
    const one = users.length === 1;
    return { message: `${listWords(users)} ${one ? "names" : "name"} ${from} as ${one ? "its" : "their"} model and will not find it under the new name. Choose the chain again in ${one ? "that agent" : "each agent"} after the rename.`,
      action: "Rename anyway", run: async () => { rename(from, value); } };
  };

  const lede = problem === null ? COPY.help : <>
    <p>{COPY.help}</p>
    <Consequence icon={<TriangleAlertIcon />} tone="warn"><p>Forgerie ignores every chain until the file is fixed. {problem} Fix <code>modelChains</code> in <code>{where}</code>, then reload this page.</p></Consequence>
  </>;
  const foot = creating
    ? <TextSubmit label="New chain" hint={COPY.nameHint} action="Create" placeholder="worker" pending={false} error={creating.error} autoFocus
      cancel={{ label: "Cancel", onPress: () => setCreating(undefined) }} onSubmit={create} />
    : <TextButton label="New chain" icon={<PlusIcon aria-hidden />} disabled={frozen} onPress={() => setCreating({})} />;

  return <ListSection title={COPY.title} lede={lede} empty={COPY.empty} foot={foot}
    note={<>Saved in Forgerie's config, <code>{where}</code>, as <code>modelChains</code>.</>}>
    {names.map((name) => {
      const saved = Object.hasOwn(chains, name);
      const entries = chains[name] ?? [];
      const users = agents ? chainUsers(agents, name) : undefined;
      const keys = rowKeys(entries);
      const one = users?.length === 1;
      const below = <>
        {renaming?.name === name ? <TextSubmit label={`Rename ${name}`} hint={COPY.nameHint} action="Rename" placeholder={name} pending={false}
          initial={name} autoFocus error={renaming.error} cancel={{ label: "Cancel", onPress: () => setRenaming(undefined) }}
          onSubmit={(value) => submitRename(name, value)} /> : null}
        {deleting === name && users && users.length > 0 ? <Consequence icon={<TriangleAlertIcon />} tone="warn"
          actions={[{ label: "Delete anyway", onPress: () => remove(name) }, { label: "Keep chain", onPress: () => setDeleting(undefined) }]}>
          <p>{listWords(users)} {one ? "names" : "name"} this chain as {one ? "its" : "their"} model. Until you choose another model for {one ? "it" : "them"}, {one ? "its" : "their"} runs will not start.</p>
        </Consequence> : null}
        <ReorderList label={`Models in ${name}, first tried first`} disabled={frozen} empty={COPY.pending}
          removeBlocked={entries.length === 1 ? COPY.lastEntry : undefined}
          rows={entries.map((entry, index) => {
            const { key } = entryParts(entry);
            const wrong = chainEntryProblem(entry);
            return { key: keys[index] ?? entry, label: modelFor(key).name ?? key,
              note: wrong ? { text: wrong, tone: "danger" as const } : offered(key) ? undefined : { text: COPY.unavailable, tone: "warn" as const },
              content: <span ref={anchor(name, index)}><ModelPicker look="value" minWidthRem={18} binding={entryBinding(name, entries, index)} {...pickerProps(name, index)} /></span> };
          })}
          foot={<span ref={anchor(name, "add")}><ModelPicker word="Add model" wordIcon={<PlusIcon aria-hidden size={14} />} minWidthRem={18} binding={addBinding(name, entries)} {...pickerProps(name, "add")} /></span>}
          note={entries.length >= MAX_MODEL_CHAIN_LENGTH ? COPY.limit : undefined}
          onMove={(from, to) => save(name, moveItem(entries, from, to))}
          onRemove={(index) => save(name, entries.filter((_, at) => at !== index))} />
      </>;
      return <ActionRow key={name} name={name} layout="head" status={saved ? plural(entries.length, "model", "models") : "Not saved yet"}
        detail={users === undefined ? undefined : users.length > 0 ? `Used by ${listWords(users)}.` : "No agent uses it yet."}
        actions={<MenuButton label={`More commands for ${name}`} layer="window" commands={[
          { label: "Rename chain", icon: <PencilIcon aria-hidden />, disabled: frozen, onSelect: () => { setDeleting(undefined); setRenaming({ name }); } },
          { label: "Delete chain", icon: <Trash2Icon aria-hidden />, tone: "danger", disabled: frozen,
            confirm: saved && !(users && users.length > 0) ? "Delete for good?" : undefined,
            onSelect: () => { if (saved && users && users.length > 0) { setRenaming(undefined); setDeleting(name); } else remove(name); } },
        ]} />}
        below={below} />;
    })}
  </ListSection>;
}
