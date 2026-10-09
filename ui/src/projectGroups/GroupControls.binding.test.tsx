// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GroupFilter, useProjectGroups, type ProjectGroupState } from "./GroupControls.binding";
import type { ProjectGroupApi } from "./projectGroupApi";
import { catalog } from "./fixtures/groups";

let root: Root;
let seen: ProjectGroupState | undefined;
const api = { list: async () => catalog } as unknown as ProjectGroupApi;
function Harness({ onManage = () => undefined }: { onManage?: () => void }) {
  const state = useProjectGroups(api);
  seen = state;
  return <GroupFilter state={state} onManage={onManage} />;
}
const select = () => document.querySelector("select")!;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); seen = undefined; });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

it("remembers the chosen group across a reload and scopes the list to its projects", async () => {
  await act(async () => root.render(<Harness />));
  expect(seen?.scope).toBeUndefined();
  await act(async () => { select().value = "kori"; select().dispatchEvent(new Event("change", { bubbles: true })); });
  expect(seen?.scope).toEqual(["core", "plugins"]);
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Harness />));
  expect(select().value).toBe("kori");
  expect(seen?.scope).toEqual(["core", "plugins"]);
});

it("shows all projects when the remembered group no longer exists", async () => {
  localStorage.setItem("forgerie.projectGroup", "gone");
  await act(async () => root.render(<Harness />));
  expect(select().value).toBe("");
  expect(seen?.scope).toBeUndefined();
});

it("Manage hands off to the settings page instead of opening a dialog", async () => {
  const manage = vi.fn();
  await act(async () => root.render(<Harness onManage={manage} />));
  await act(async () => [...document.querySelectorAll("button")].find((node) => node.textContent === "Manage")!.click());
  expect(manage).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).toBeNull();
});
