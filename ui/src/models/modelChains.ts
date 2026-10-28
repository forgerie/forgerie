import { chainNameProblem, type ModelChains } from "@shared/modelChains";
import { parseModelReference } from "@shared/thinkingLevels";
import { chainNameOf } from "../agents/agentFile";

/** One chain entry split for the editor: the `provider/id` key and the entry's own thinking level, if it has one. */
export function entryParts(entry: string): { key: string; level: string | undefined } {
  const { model, thinkingLevel } = parseModelReference(entry);
  return { key: model, level: thinkingLevel };
}
export const entryOf = (key: string, level: string | undefined) => level === undefined ? key : `${key}:${level}`;

/** The map with one chain's entries replaced, or the chain added at the end. Every other chain keeps its place. */
export function withChain(chains: ModelChains, name: string, entries: readonly string[]): ModelChains {
  return Object.hasOwn(chains, name) ? Object.fromEntries(Object.entries(chains).map(([key, value]) => [key, key === name ? [...entries] : value]))
    : { ...chains, [name]: [...entries] };
}
/** The map with a chain renamed in place, so the file keeps its order. */
export const renameChain = (chains: ModelChains, from: string, to: string): ModelChains =>
  Object.fromEntries(Object.entries(chains).map(([key, value]) => [key === from ? to : key, value]));
export const withoutChain = (chains: ModelChains, name: string): ModelChains =>
  Object.fromEntries(Object.entries(chains).filter(([key]) => key !== name));
/** The list with one item moved from one place to another. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Why a new or changed name cannot be used: the shared naming rule, then a clash with another chain. */
export function nameProblem(name: string, taken: readonly string[]): string | undefined {
  return chainNameProblem(name) ?? (taken.includes(name) ? `There is already a chain named ${name}.` : undefined);
}

/** The agents that name a chain as their model, each name once, in list order. */
export function chainUsers(agents: readonly { name: string; model?: string | undefined }[], chain: string): string[] {
  return [...new Set(agents.filter((agent) => chainNameOf(agent.model) === chain).map((agent) => agent.name))];
}
/** Names joined for a sentence: "A", "A and B", "A, B and C". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
