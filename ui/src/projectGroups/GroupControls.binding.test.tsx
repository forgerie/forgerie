// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectGroupSettings, useProjectGroups, type ProjectGroupState } from "./GroupControls.binding";
import { ApiError, type GroupCatalog, type ProjectGroupApi } from "./projectGroupApi";
import { catalog } from "./fixtures/groups";

let root: Root;
let seen: ProjectGroupState | undefined;
let served: GroupCatalog;
const calls: unknown[][] = [];
const api = {
  list: async () => served,
  allWorkspaces: async () => ({ related: [] }),
  save: async (...args: unknown[]) => { calls.push(["save", ...args]); throw new Error("This group changed in another window."); },
  remove: async (group: { id: string }) => { calls.push(["remove", group.id]); served = { ...served, groups: served.groups.filter((item) => item.id !== group.id) }; return { removed: true }; },
  register: async (path: string) => { const project = { id: "new-project", name: "extra", path }; served = { ...served, projects: [...served.projects, project] }; return project; },
} as unknown as ProjectGroupApi;

function Harness({ group, onOpen = () => undefined }: { group?: string | undefined; onOpen?: (group: string | undefined) => void }) {
  const state = useProjectGroups(api);
  seen = state;
  return <ProjectGroupSettings api={api} state={state} group={group} onOpen={onOpen} back={null} close={null} />;
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const checkbox = (name: string) => [...document.querySelectorAll("label")].find((node) => node.textContent?.includes(name))!.querySelector("input")!;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  seen = undefined; served = catalog; calls.length = 0;
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

it("remembers the chosen group across a reload and scopes the list to its projects", async () => {
  await act(async () => root.render(<Harness />));
  await flush();
  expect(seen?.scope).toBeUndefined();
  expect(seen?.filter.options).toEqual([{ value: "kori", label: "KORI", detail: "2 projects" }]);
  await act(async () => seen!.filter.onChoose("kori"));
  expect(seen?.scope).toEqual(["core", "plugins"]);
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Harness />));
  await flush();
  expect(seen?.filter.value).toBe("kori");
  expect(seen?.scope).toEqual(["core", "plugins"]);
});

it("shows all projects when the remembered group no longer exists", async () => {
  localStorage.setItem("forgerie.projectGroup", "gone");
  await act(async () => root.render(<Harness />));
  await flush();
  expect(seen?.filter.value).toBe("");
  expect(seen?.scope).toBeUndefined();
});

it("a refused save keeps the draft and the revision it started from", async () => {
  await act(async () => root.render(<Harness group="kori" />));
  await flush();
  await act(async () => checkbox("korri-plugins").click());
  expect(document.body.textContent).toContain("Unsaved changes");
  served = { ...catalog, groups: catalog.groups.map((group) => ({ ...group, revision: 2 })) };
  await act(async () => { await seen!.refresh(); });
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(calls[0]?.slice(0, 3)).toEqual(["save", "KORI", ["core"]]);
  expect(calls[0]?.[3]).toMatchObject({ id: "kori", revision: 1 });
  expect(checkbox("korri-plugins").checked).toBe(false);
  expect(document.body.textContent).toContain("This group changed in another window.");
});

it("deleting a group asks twice and removes only the group", async () => {
  const opened: (string | undefined)[] = [];
  await act(async () => root.render(<Harness group="kori" onOpen={(group) => opened.push(group)} />));
  await flush();
  await act(async () => button("Group commands")!.click());
  await act(async () => button("Delete group")!.click());
  expect(calls).toEqual([]);
  await act(async () => button("Delete? Its projects and chats stay")!.click());
  await flush();
  expect(calls).toEqual([["remove", "kori"]]);
  expect(seen?.catalog.projects).toHaveLength(2);
  expect(opened).toEqual([undefined]);
});

it("a folder added from a group's page is checked in that group's draft", async () => {
  await act(async () => root.render(<Harness group="kori" />));
  await flush();
  const field = document.querySelector<HTMLInputElement>("input[placeholder='/path/to/repository']")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "/code/extra"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(checkbox("extra").checked).toBe(true);
  expect(document.body.textContent).toContain("Unsaved changes");
});

it("a folder that does not exist is offered for creation, and is created only on confirm", async () => {
  const register = vi.spyOn(api, "register").mockImplementation(async (path: string, create = false) => {
    calls.push(["register", path, create]);
    if (!create) throw new ApiError(`No folder at ${path}`, "missing-folder");
    const project = { id: "new-project", name: "fresh", path };
    served = { ...served, projects: [...served.projects, project] };
    return project;
  });
  await act(async () => root.render(<Harness group="kori" />));
  await flush();
  const field = document.querySelector<HTMLInputElement>("input[placeholder='/path/to/repository']")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "/code/fresh"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  expect(calls).toEqual([["register", "/code/fresh", false]]);
  expect(document.body.textContent).toContain("No folder at /code/fresh. Create it and add it as a project?");
  expect(seen?.error).toBeUndefined();
  expect(field.value).toBe("/code/fresh");
  await act(async () => button("Create folder")!.click());
  await flush();
  expect(calls).toEqual([["register", "/code/fresh", false], ["register", "/code/fresh", true]]);
  expect(checkbox("fresh").checked).toBe(true);
  expect(button("Create folder")).toBeUndefined();
  expect(field.value).toBe("");
  register.mockRestore();
});
