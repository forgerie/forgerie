// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectGroups } from "./ProjectGroups";
import { RelatedRepos } from "./RelatedRepos";
import { catalog, related } from "./fixtures/groups";
let root: Root;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label)!;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("keeps the original revision and draft across catalog updates and a refused save", async () => {
  const saves: unknown[] = [];
  const onSave = async (...args: unknown[]) => { saves.push(args); throw new Error("stale"); };
  const view = (revision: number, error?: string) => <ProjectGroups catalog={{ ...catalog, groups: catalog.groups.map((group) => ({ ...group, revision })) }} pending={false} error={error} onSave={onSave} onRemove={async () => undefined} onRefresh={() => undefined} />;
  await act(async () => root.render(view(1)));
  await act(async () => button("Edit KORI").click());
  await act(async () => root.render(view(2, "The group changed. Reload before saving.")));
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saves).toEqual([["kori", "KORI", ["core", "plugins"], 1]]);
  expect(document.querySelector<HTMLInputElement>("input:not([type=checkbox])")?.value).toBe("KORI");
  expect(document.body.textContent).toContain("The group changed");
});
it("group deletion needs confirmation and does not invoke save or remove projects", async () => {
  const removals: string[] = [];
  await act(async () => root.render(<ProjectGroups catalog={catalog} pending={false} onSave={async () => { throw new Error("Unexpected save"); }} onRemove={async (id) => { removals.push(id); }} onRefresh={() => undefined} />));
  await act(async () => button("Delete KORI").click());
  expect(removals).toEqual([]);
  await act(async () => button("Confirm delete KORI").click());
  expect(removals).toEqual(["kori"]);
});
it("shows target-repo controls without moving the chat and blocks lifecycle actions during a run", async () => {
  const actions: string[] = [];
  await act(async () => root.render(<RelatedRepos context={related} busy onPrepare={() => actions.push("prepare")} onAction={(action, info) => actions.push(`${action}:${info.id}`)} onClose={() => undefined} onRefresh={() => undefined} />));
  expect(document.body.textContent).toContain("same agent");
  expect(button("Prepare worktree").disabled).toBe(true);
  expect(button("Land on main").disabled).toBe(true);
  expect(button("Discard").disabled).toBe(true);
  await act(async () => button("Changes and files").click());
  expect(actions).toEqual(["changes:secondary"]);
});
