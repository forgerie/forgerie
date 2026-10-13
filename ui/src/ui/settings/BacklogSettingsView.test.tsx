// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BacklogSettingsView } from "../../backlog/BacklogSettings.binding";
import { BacklogSettingsRefusal, createBacklogSettingsApi, type BacklogSettingsApi, type BacklogSettingsCatalog } from "../../backlog/backlogSettingsApi";
import { azureSourcesOverlap, sourceOverlapMessage, type BacklogSourceInput } from "@shared/backlogSources";
let root: Root;
/** Source writes for the tests about projects, which never make one. */
const noSources: Pick<BacklogSettingsApi, "createSource" | "saveSource" | "removeSource"> = { createSource: async () => ({}), saveSource: async () => ({}), removeSource: async () => ({}) };
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === name)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); await settle(); };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("saves explicit sources and restores the repo; shows a 409 without losing the edit", async () => {
  let catalog: BacklogSettingsCatalog = { settings: { sources: [], projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] }, projects: [{ id: "p", name: "Project", path: "/repo" }] };
  const saves: unknown[] = []; let conflict = false;
  const api: BacklogSettingsApi = { ...noSources, list: async () => catalog, githubLogin: async () => ({}), save: async (id, backlog, baseRevision) => {
    saves.push({ id, backlog, baseRevision }); if (conflict) throw new BacklogSettingsRefusal("changed", 409);
    catalog = { ...catalog, settings: { sources: [], projects: [{ projectId: id, source: "forgerie", backlog, revision: 1 }] } }; return {};
  }, remove: async () => { catalog = { ...catalog, settings: { sources: [], projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] } }; return {}; } };
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
  const api: BacklogSettingsApi = { ...noSources, list: async () => ({ settings: { sources: [], projects: [{ projectId: "p", source: "repo-file", backlog: { providers: ["github"] } }] }, projects: [{ id: "p", name: "Project", path: "/repo" }] }), save: async () => ({}), remove: async () => ({}), githubLogin: async (login) => { logins.push(login); return {}; } };
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
  const settings = { sources: [], githubLogin: "octocat", projects: [
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

/**
 * A backlog settings server in memory: the same overlap rule and revisions as Forgerie's, behind the real client.
 * `elsewhere` adds a source as another tab would, after this page read the list.
 */
function settingsServer() {
  const projects = [{ id: "p1", name: "forgerie", path: "/code/forgerie" }, { id: "p2", name: "storefront", path: "/code/storefront" }];
  let sources: (BacklogSourceInput & { id: string; provider: "azure-devops"; revision: number; updatedAt: string })[] = [];
  let revision = 0; let ids = 0;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const refuse = (error: string) => Response.json({ kind: "conflict", error }, { status: 409 });
  const settings = () => ({ sources: sources.map((source) => ({ ...source, warnings: sources.filter((other) => other.id !== source.id && azureSourcesOverlap(source, other)).map(sourceOverlapMessage) })),
    projects: [{ projectId: "p1", source: "repo-file", backlog: { providers: ["markdown"] }, warnings: ["This repository's .forgerie/config.json has an Azure DevOps section. Forgerie now reads Azure boards from Settings → Backlog → Sources."] }] });
  const add = (input: BacklogSourceInput) => { ids += 1; revision += 1; const source = { ...input, id: `00000000-0000-4000-8000-00000000000${String(ids)}`, provider: "azure-devops" as const, revision, updatedAt: "2026-10-13T10:00:00Z" }; sources.push(source); return source; };
  const fetchFn = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (path === "/api/projects") return Response.json(projects);
    if (path === "/api/backlog/settings") return Response.json(settings());
    const id = /\/sources\/([^/]+)$/u.exec(path)?.[1];
    const input = body as BacklogSourceInput & { baseRevision?: number };
    const { baseRevision, ...fields } = input;
    const overlap = method === "DELETE" ? undefined : sources.find((other) => other.id !== id && azureSourcesOverlap(fields, other));
    if (method === "POST") return overlap ? refuse(sourceOverlapMessage(overlap)) : Response.json(add(fields));
    const current = sources.find((source) => source.id === id);
    if (!current || current.revision !== baseRevision) return refuse("The backlog source changed. Reload before saving.");
    if (method === "DELETE") { sources = sources.filter((source) => source !== current); revision += 1; return Response.json({ removed: true }); }
    if (overlap) return refuse(sourceOverlapMessage(overlap));
    revision += 1; sources = sources.map((source) => source === current ? { ...fields, id: current.id, provider: "azure-devops" as const, revision, updatedAt: current.updatedAt } : source);
    return Response.json(sources.find((source) => source.id === id));
  };
  /** Another tab saves a source: its revision moves on. */
  const touch = (id: string) => { revision += 1; sources = sources.map((source) => source.id === id ? { ...source, revision } : source); };
  return { api: createBacklogSettingsApi(fetchFn), calls, elsewhere: add, touch };
}
const typeInto = async (label: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const alert = () => document.querySelector('[role="alert"]')?.textContent;
const sourceRows = () => [...document.querySelectorAll<HTMLButtonElement>(".agent-row")].filter((row) => row.closest("section")?.querySelector("h2")?.textContent === "Sources");

it("adds an Azure DevOps source with a destination, refuses an overlapping board before and at save, changes it, and deletes it", async () => {
  const server = settingsServer();
  let selected: string | undefined;
  const show = async () => { await act(async () => root.render(<BacklogSettingsView api={server.api} selected={selected} onOpen={(id) => { selected = id; }} back={null} close={null} />)); await settle(); };
  const press = async (node: HTMLElement | undefined) => { expect(node).toBeDefined(); await click(node!); await show(); };
  const choose = async (picker: string, option: string) => {
    await press(document.querySelector<HTMLButtonElement>(`[aria-label^="${picker}:"]`)!);
    await press([...document.querySelectorAll<HTMLButtonElement>(".option-row")].find((row) => row.textContent?.startsWith(option)));
  };
  await show();
  expect(document.body.textContent).toContain("No Azure DevOps boards yet.");

  await press(button("Add Azure DevOps source"));
  expect(document.querySelector("h1")!.textContent).toBe("New Azure DevOps source");
  expect(button("Add source").disabled).toBe(true);
  await typeInto("Organization", "contoso"); await typeInto("Azure project", "Fabrikam Web");
  await choose("Destination", "storefront");
  await press(button("Add source"));
  expect(server.calls.at(-3)).toEqual({ method: "POST", path: "/api/backlog/settings/sources", body: { organization: "contoso", project: "Fabrikam Web", destinationProjectId: "p2" } });
  expect(selected).toBeUndefined();
  expect(sourceRows().map((row) => row.textContent)).toEqual(["Fabrikam Webcontoso→ storefront"]);

  // The same board, in other letters: refused with the server's own words before the press.
  await press(button("Add Azure DevOps source"));
  await typeInto("Organization", "Contoso"); await typeInto("Azure project", "fabrikam web"); await typeInto("Area Path", "Fabrikam Web\\Checkout");
  await show();
  expect(alert()).toBe("Overlaps contoso / Fabrikam Web (no Area Path). Give both sources Area Paths that do not overlap.");
  expect(button("Add source").disabled).toBe(true);
  // Another tab adds a board this page has not seen; the server refuses at save, and the draft stays.
  await typeInto("Organization", "fabrikam"); await typeInto("Azure project", "Support Desk"); await typeInto("Area Path", "");
  server.elsewhere({ organization: "fabrikam", project: "Support Desk" });
  await show();
  expect(alert()).toBeUndefined();
  await press(button("Add source"));
  expect(alert()).toContain("Overlaps fabrikam / Support Desk (no Area Path).");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Azure project"]')!.value).toBe("Support Desk");
  // Reload reads the other tab's board, and the same reason now shows before the press.
  await press(button("Reload"));
  expect(alert()).toBe("Overlaps fabrikam / Support Desk (no Area Path). Give both sources Area Paths that do not overlap.");
  expect(button("Add source").disabled).toBe(true);

  // Back to the list: open the first source and send its sessions nowhere ahead.
  selected = undefined; await show();
  expect(sourceRows().map((row) => row.textContent)).toEqual(["Fabrikam Webcontoso→ storefront", "Support DeskfabrikamNot routed: each start asks for a project"]);
  await press(sourceRows()[0]);
  expect(document.querySelector("h1")!.textContent).toBe("Fabrikam Web");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Organization"]')!.value).toBe("contoso");
  await choose("Destination", "None: ask each time");
  // A save from another tab first: this one is refused, and keeps the draft until Reload.
  server.touch("00000000-0000-4000-8000-000000000001");
  await press(button("Save changes"));
  expect(alert()).toContain("The backlog source changed. Reload before saving.");
  expect(document.querySelector<HTMLButtonElement>('[aria-label^="Destination:"]')!.textContent).toBe("None: ask each time");
  await press(button("Reload"));
  expect(alert()).toBeUndefined();
  await choose("Destination", "None: ask each time");
  await press(button("Save changes"));
  expect(server.calls.filter((call) => call.method === "PUT").at(-1)).toEqual({ method: "PUT", path: "/api/backlog/settings/sources/00000000-0000-4000-8000-000000000001",
    body: { organization: "contoso", project: "Fabrikam Web", baseRevision: 3 } });

  // Delete asks twice, then sends the revision it read.
  await press(button("Delete source"));
  expect(server.calls.some((call) => call.method === "DELETE")).toBe(false);
  expect(document.body.textContent).toContain("Press again to delete.");
  await press(button("Delete this source"));
  expect(server.calls.find((call) => call.method === "DELETE")).toEqual({ method: "DELETE", path: "/api/backlog/settings/sources/00000000-0000-4000-8000-000000000001", body: { baseRevision: 4 } });
  expect(selected).toBeUndefined();
  expect(sourceRows().map((row) => row.textContent)).toEqual(["Support DeskfabrikamNot routed: each start asks for a project"]);
});

it("offers a project only Markdown and GitHub, and says when its repo file still has an Azure DevOps section", async () => {
  const server = settingsServer();
  await act(async () => root.render(<BacklogSettingsView api={server.api} selected="p1" onOpen={() => {}} back={null} close={null} />)); await settle();
  expect([...document.querySelectorAll(".choice-list-label")].map((node) => node.textContent)).toEqual(["Markdown", "GitHub"]);
  expect(document.querySelector('[aria-label="Organization"]')).toBeNull();
  expect(document.querySelector('[role="status"]')!.textContent).toContain("Forgerie now reads Azure boards from Settings → Backlog → Sources.");
});
