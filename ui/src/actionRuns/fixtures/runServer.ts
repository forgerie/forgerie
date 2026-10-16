/**
 * For tests: an Actions run API that holds links per run the way the real
 * server does. Linking finds the run among the listed, derived, and `known`
 * runs; watching a run that is not linked links it with `source: "pull"`.
 * Each method is a Vitest mock, so a test can count calls or make one fail.
 */
import { vi } from "vitest";
import type { ActionRun, ActionRunApi, ActionRunLink, SessionActionRuns } from "../actionRunApi";
import { link } from "./actionRuns";

const AT = "2026-10-15T12:00:00.000Z";

export function runServer(initial: SessionActionRuns, known: readonly ActionRun[] = []) {
  let current = initial;
  const runOf = (id: number) => [...current.items.flatMap((item) => item.run ? [item.run] : []), ...current.derived.flatMap((group) => group.runs), ...known]
    .find((run) => run.runId === id);
  const setLink = (next: ActionRunLink) => {
    const linked = current.items.some((item) => item.link.runId === next.runId);
    current = { ...current, items: linked ? current.items.map((item) => item.link.runId === next.runId ? { ...item, link: next } : item)
      : [...current.items, { link: next, run: runOf(next.runId) ?? null }] };
    return next;
  };
  const linkOf = (id: number) => current.items.find((item) => item.link.runId === id)?.link ?? link(id, { kind: "off" }, "pull");
  const api = {
    list: vi.fn(async () => current),
    read: vi.fn(async (_ref, id: number) => {
      const item = current.items.find((candidate) => candidate.link.runId === id);
      if (!item?.run) throw new Error(item?.error ?? "Not linked.");
      return { link: item.link, run: item.run };
    }),
    link: vi.fn(async (_ref, run: number | string) => {
      const id = typeof run === "number" ? run : Number(/runs\/(\d+)/u.exec(run)?.[1]);
      const found = runOf(id);
      if (!found) throw new Error(`GitHub has no run ${String(id)} on forgerie/forgerie.`);
      return { link: setLink(linkOf(id)), run: found };
    }),
    unlink: vi.fn(async (_ref, id: number) => { const removed = linkOf(id); current = { ...current, items: current.items.filter((item) => item.link.runId !== id) }; return removed; }),
    watch: vi.fn(async (_ref, id: number) => setLink({ ...linkOf(id), watch: { kind: "watching", since: AT, wakes: 0 } })),
    stopWatch: vi.fn(async (_ref, id: number) => setLink({ ...linkOf(id), watch: { kind: "stopped", reason: "Stopped by you", at: AT } })),
  } satisfies ActionRunApi;
  return { api, set: (next: SessionActionRuns) => { current = next; } };
}
