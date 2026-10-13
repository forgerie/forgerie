// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BacklogSettingsView } from "../../backlog/BacklogSettings.binding";
import { BacklogSettingsRefusal, type BacklogSettingsApi, type BacklogSettingsCatalog } from "../../backlog/backlogSettingsApi";
let root: Root;
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === name)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("saves explicit sources and restores the repo; shows a 409 without losing the edit", async () => {
  let catalog: BacklogSettingsCatalog = { settings: { projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] }, projects: [{ id: "p", name: "Project", path: "/repo" }] };
  const saves: unknown[] = []; let conflict = false;
  const api: BacklogSettingsApi = { list: async () => catalog, githubLogin: async () => ({}), save: async (id, backlog, baseRevision) => {
    saves.push({ id, backlog, baseRevision }); if (conflict) throw new BacklogSettingsRefusal("changed", 409);
    catalog = { ...catalog, settings: { projects: [{ projectId: id, source: "forgerie", backlog, revision: 1 }] } }; return {};
  }, remove: async () => { catalog = { ...catalog, settings: { projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] } }; return {}; } };
  await act(async () => root.render(<BacklogSettingsView selected="p" api={api} onOpen={() => {}} back={null} close={null} />)); await settle();
  expect(document.body.textContent).toContain("Default: Markdown");
  await click(document.querySelector<HTMLInputElement>('.choice-list-rows li:nth-child(2) input')!);
  await click(button("Save changes"));
  expect(saves).toEqual([{ id: "p", backlog: { providers: ["markdown", "github"], github: { authors: "trusted" } }, baseRevision: 0 }]);
  expect(document.body.textContent).toContain("Set in Forgerie");
  conflict = true; await click(document.querySelector<HTMLInputElement>('.choice-list-rows li:nth-child(1) input')!); await click(button("Save changes"));
  expect(document.body.textContent).toContain("Reload before saving");
  expect(document.querySelector<HTMLInputElement>('.choice-list-rows li:nth-child(1) input')!.checked).toBe(false);
  await click(button("Use the repo file")); expect(document.body.textContent).toContain("Default: Markdown");
});
it("shows the project list and saves a GitHub username", async () => {
  const logins: (string | null)[] = [];
  const api: BacklogSettingsApi = { list: async () => ({ settings: { projects: [{ projectId: "p", source: "repo-file", backlog: { providers: ["github"] } }] }, projects: [{ id: "p", name: "Project", path: "/repo" }] }), save: async () => ({}), remove: async () => ({}), githubLogin: async (login) => { logins.push(login); return {}; } };
  const opened: (string | undefined)[] = [];
  await act(async () => root.render(<BacklogSettingsView api={api} onOpen={(id) => opened.push(id)} back={null} close={null} />)); await settle();
  const input = document.querySelector<HTMLInputElement>('[aria-label="GitHub username"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "octocat"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button("Save username")); expect(logins).toEqual(["octocat"]);
  await click(document.querySelector<HTMLButtonElement>(".agent-row")!); expect(opened).toEqual(["p"]);
});

it("shows a project read error while the GitHub username and healthy project's settings stay editable", async () => {
  const { createBacklogSettingsApi } = await import("../../backlog/backlogSettingsApi");
  const saves: unknown[] = []; const logins: unknown[] = [];
  const settings = { githubLogin: "octocat", projects: [
    { projectId: "good", source: "default", backlog: { providers: ["markdown"] } },
    { projectId: "missing", error: "Cannot read this project's backlog settings. Check its project folder and .forgerie/config.json, then reload." },
  ] };
  const api = createBacklogSettingsApi(async (path, init) => {
    if (init?.method === "PUT") {
      const body: unknown = JSON.parse(String(init.body));
      if (path.endsWith("github-login")) logins.push(body); else saves.push({ path, body });
      return Response.json({ saved: true });
    }
    return Response.json(path === "/api/projects" ? [{ id: "good", name: "Healthy", path: "/repo" }, { id: "missing", name: "Missing", path: "/gone" }] : settings);
  });
  let selected: string | undefined;
  const renderPage = async () => { await act(async () => root.render(<BacklogSettingsView api={api} selected={selected} onOpen={(id) => { selected = id; }} back={null} close={null} />)); await settle(); };
  await renderPage();
  expect(document.body.textContent).toContain("Check its project folder");
  const input = document.querySelector<HTMLInputElement>('[aria-label="GitHub username"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new-login"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(button("Save username")); expect(logins).toEqual([{ githubLogin: "new-login" }]);
  const healthy = [...document.querySelectorAll<HTMLButtonElement>(".agent-row")].find((row) => row.textContent?.includes("Healthy"))!;
  await click(healthy); await renderPage();
  await click(document.querySelector<HTMLInputElement>('.choice-list-rows li:nth-child(2) input')!);
  await click(button("Save changes"));
  expect(saves).toEqual([{ path: "/api/backlog/settings/projects/good", body: { backlog: { providers: ["markdown", "github"], github: { authors: "trusted" } }, baseRevision: 0 } }]);
});

it("shows the server's corrupt-settings recovery message rather than an empty/default settings page", async () => {
  const { createBacklogSettingsApi } = await import("../../backlog/backlogSettingsApi");
  const message = "Cannot read backlog-settings.json. Restore it from a backup, or remove it to use repo-file/default backlog settings, then reload. The file has not been overwritten.";
  const api = createBacklogSettingsApi(async (path) => path === "/api/projects" ? Response.json([]) : Response.json({ error: message }, { status: 503 }));
  await act(async () => root.render(<BacklogSettingsView api={api} onOpen={() => {}} back={null} close={null} />)); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(message);
  expect(document.querySelector('[aria-label="GitHub username"]')).toBeNull();
});
