// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BacklogView, type BacklogBinding } from "./BacklogView";
import type { BacklogClaim, BacklogItem, BacklogList, BacklogSourceSummary, BacklogWarning } from "../../backlog/backlogApi";
import { refOf, sameItem, type BacklogPlace } from "../../backlog/backlogModel";
import type { GitHubAppState, GitHubSetup } from "../../backlog/githubApi";
import type { GitHubAppPage } from "../../backlog/useGitHubApp";

let root: Root;
type ProjectItem = Extract<BacklogItem, { owner: { kind: "project" } }>;
type SourceItem = Extract<BacklogItem, { owner: { kind: "source" } }>;
const fields = { title: "Fix the nested transcript", path: "work/items/a.md", status: "To Do", priority: "high", labels: ["agents"], created: "2026-09-01", assignedToMe: true,
  assignees: [], open: true, readiness: "ready" as const, blockingIds: [] };
/** A project's own item. Its owner follows `projectId`, `projectName` and `repo`. */
const item = (extra: Partial<ProjectItem> = {}): BacklogItem => {
  const base = { id: "01A", provider: "markdown", projectId: "p1", projectName: "forgerie", repo: "/code/forgerie", ...fields, ...extra };
  return { ...base, owner: { kind: "project", projectId: base.projectId, projectName: base.projectName, repo: base.repo },
    destination: { kind: "routed", projectId: base.projectId, reason: "project-owned" } };
};
/** An Azure board's work item: listed under its source, with a destination instead of a project. */
const sourceItem = (extra: Partial<SourceItem> = {}): BacklogItem => ({ ...fields, id: "contoso:7", provider: "azure-devops", path: "contoso/Fabrikam Web#7", labels: [],
  title: "Checkout total ignores the second code", owner: { kind: "source", sourceId: "src-1", label: "Fabrikam Web" },
  destination: { kind: "routed", projectId: "p2", reason: "source-destination" }, ...extra });
const summary = (extra: Partial<BacklogSourceSummary> = {}): BacklogSourceSummary => ({ sourceId: "src-1", label: "Fabrikam Web", provider: "azure-devops", organization: "contoso",
  areaPath: "Fabrikam Web\\Checkout", destination: { kind: "routed", projectId: "p2", reason: "source-destination" }, warnings: [], ...extra });
const held: BacklogClaim = { kind: "claimed", claimId: "c1", projectId: "p1", provider: "markdown", itemId: "02B", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9",
  claimedAt: "2026-10-07T10:00:00Z", sessionId: "s-held", branch: "feat/atomic-deploys" };
const list = (items: BacklogItem[], warnings: BacklogList["warnings"] = [], sources: BacklogSourceSummary[] = []): BacklogList => ({ items, warnings, sources, generatedAt: "now" });

function binding(value: BacklogList, extra: Partial<BacklogBinding> = {}) {
  const places: BacklogPlace[] = [];
  const launched: BacklogItem[] = [];
  const opened: string[] = [];
  const released: string[] = [];
  const b: BacklogBinding = {
    load: { type: "ready", value }, onRefresh: () => {},
    api: {
      detail: async (ref) => {
        const found = value.items.find((entry) => sameItem(refOf(entry), ref));
        if (!found) throw Object.assign(new Error("Backlog item not found or invalid"), { kind: "not-found" });
        return { item: found, body: "## Why it matters\n\nThe scanner lists **8,946** files.", initialPrompt: "" };
      },
      release: async (_ref, claimId) => { released.push(claimId); return { released: true }; },
    },
    look: (id) => id === "s-held" ? { state: "working", name: "Atomic deploys", time: "41m" } : undefined,
    onPlace: (place) => places.push(place), onLaunch: (entry) => launched.push(entry), onOpenSession: (claim) => opened.push(claim.sessionId),
    ...extra,
  };
  return { b, places, launched, opened, released };
}
const settle = () => act(async () => { for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(place: BacklogPlace, b: BacklogBinding) { await act(async () => root.render(<BacklogView place={place} binding={b} />)); await settle(); }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim().startsWith(name) || node.getAttribute("aria-label") === name);
const click = async (node: HTMLElement | undefined) => { expect(node).toBeDefined(); await act(async () => node!.click()); await settle(); };
const groups = () => [...document.querySelectorAll(".bl-group")].map((node) => node.getAttribute("aria-label"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("the backlog list", () => {
  it("shows held items first with their session's words, then each project", async () => {
    const { b } = binding(list([item(), item({ id: "02B", title: "Atomic deploys", claim: held, readiness: "claimed" }),
      item({ id: "03C", projectId: "p2", projectName: "bazzar", title: "Gallery plugin" })]));
    await render({}, b);
    expect(groups()).toEqual(["In a session", "bazzar", "forgerie"]);
    expect(document.querySelector(".bl-held")!.textContent).toBe("forgerieWorking in Atomic deploys");
    expect(document.querySelector(".bl-total")!.textContent).toBe("3 items in 2 projects");
  });

  it("filters, and says when nothing matches", async () => {
    const { b } = binding(list([item(), item({ id: "03C", title: "Gallery plugin" })]));
    await render({}, b);
    const input = document.querySelector<HTMLInputElement>(".bl-filter input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "gallery");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...document.querySelectorAll(".bl-title")].map((node) => node.textContent)).toEqual(["Gallery plugin"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "audio");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector(".settings-hint")!.textContent).toBe("No items match “audio”.");
  });

  it("names the fix for an ignored folder inside its project, and keeps the items", async () => {
    const { b } = binding(list([item({ projectName: "bazzar" })], [{ projectId: "p1", path: "/code/bazzar/.forgerie/backlog/", kind: "ignored-directory", message: "x" },
      { projectId: "p1", path: "/code/bazzar/.forgerie/backlog/notes.md", kind: "invalid-item", message: "Invalid item frontmatter" }]));
    await render({}, b);
    expect(document.querySelector(".bl-warning pre")!.textContent).toBe(".forgerie/*\n!.forgerie/backlog/");
    expect(document.querySelectorAll(".bl-row")).toHaveLength(1);
    expect(document.querySelector(".bl-problems summary")!.textContent).toBe("1 file is not readable as items");
  });

  it("caps a long project at eight rows, with the rest one press away", async () => {
    const { b } = binding(list(Array.from({ length: 11 }, (_, index) => item({ id: `i${String(index)}`, title: `Item ${String(index)}` }))));
    await render({}, b);
    expect(document.querySelectorAll(".bl-row")).toHaveLength(8);
    await click(button("Show all 11"));
    expect(document.querySelectorAll(".bl-row")).toHaveLength(11);
  });

  it("hides done items until asked", async () => {
    const { b } = binding(list([item(), item({ id: "09Z", title: "Shipped", readiness: "closed", open: false })]));
    await render({}, b);
    expect(document.querySelectorAll(".bl-row")).toHaveLength(1);
    await click(button("Backlog commands"));
    await click(button("Show done items"));
    expect(document.querySelectorAll(".bl-row")).toHaveLength(2);
  });

  it("says where Forgerie looks when there is nothing", async () => {
    const { b } = binding(list([]));
    await render({}, b);
    expect(document.querySelector(".bl-empty")!.textContent).toContain(".forgerie/backlog/");
    expect(document.querySelector(".bl-empty")!.textContent).toContain("backlog.dir");
  });

  it("opens an item", async () => {
    const { b, places } = binding(list([item()]));
    await render({}, b);
    await click(document.querySelector<HTMLButtonElement>(".bl-row")!);
    expect(places).toEqual([{ item: { projectId: "p1", itemId: "01A", provider: "markdown", scope: "mine" } }]);
  });
});

describe("an item", () => {
  it("reads as a document with one way on: Start session", async () => {
    const { b, launched } = binding(list([item()]));
    await render({ item: { projectId: "p1", itemId: "01A" } }, b);
    expect(document.querySelector(".bl-body strong")!.textContent).toBe("8,946");
    expect(document.querySelector(".bl-file")!.textContent).toBe("work/items/a.md");
    await click(button("Start session"));
    expect(launched.map((entry) => entry.id)).toEqual(["01A"]);
  });

  it("held by a session: shows it, and Open session replaces Start", async () => {
    const { b, opened } = binding(list([item({ id: "02B", claim: held, readiness: "claimed" })]));
    await render({ item: { projectId: "p1", itemId: "02B" } }, b);
    expect(document.querySelector(".bl-claim")!.textContent).toContain("Working in Atomic deploys");
    expect(document.querySelector(".bl-claim")!.textContent).toContain("feat/atomic-deploys");
    expect(button("Start session")).toBeUndefined();
    await click(button("Open session"));
    expect(opened).toEqual(["s-held"]);
  });

  it("an interrupted launch offers Release, and releases the exact claim", async () => {
    const interrupted: BacklogClaim = { kind: "interrupted", claimId: "c-int", projectId: "p1", provider: "markdown", itemId: "02B", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9", claimedAt: "2026-10-07T10:00:00Z" };
    const { b, released } = binding(list([item({ id: "02B", claim: interrupted, readiness: "claimed" })]));
    await render({ item: { projectId: "p1", itemId: "02B" } }, b);
    expect(document.querySelector(".bl-claim")!.textContent).toContain("A launch did not finish");
    await click(button("Release item"));
    expect(released).toEqual(["c-int"]);
  });

  it("a live claim releases only after a second press", async () => {
    const { b, released } = binding(list([item({ id: "02B", claim: held, readiness: "claimed" })]));
    await render({ item: { projectId: "p1", itemId: "02B" } }, b);
    await click(button("Item commands"));
    await click(button("Release item"));
    expect(released).toEqual([]);
    await click(button("Release? The session keeps running"));
    expect(released).toEqual(["c1"]);
  });

  it("blocked: Start waits, and each blocker opens", async () => {
    const { b, places } = binding(list([item({ readiness: "blocked", blockingIds: ["02B"] }), item({ id: "02B", title: "Land the scanner" })]));
    await render({ item: { projectId: "p1", itemId: "01A" } }, b);
    expect(button("Start session")!.disabled).toBe(true);
    await click(button("Land the scanner"));
    expect(places).toEqual([{ item: { projectId: "p1", itemId: "02B", provider: "markdown" } }]);
  });

  it("a removed item says so instead of a blank page", async () => {
    const { b } = binding(list([]));
    await render({ item: { projectId: "p1", itemId: "gone" } }, b);
    expect(document.querySelector(".notice")!.textContent).toContain("no longer in the backlog");
  });
});

const configured: GitHubAppState = { state: "configured", app: { slug: "forgerie-zao", owner: "simonwjackson", url: "https://github.com/apps/forgerie-zao" },
  installUrl: "https://github.com/apps/forgerie-zao/installations/new" };
const issue = (extra: Partial<ProjectItem> = {}) => item({ id: "7", provider: "github", title: "Crash on boot", path: "korri-os/korri#7",
  url: "https://github.com/korri-os/korri/issues/7", status: "Open", priority: undefined, labels: ["bug"], ...extra });
const notSetUp: BacklogWarning = { projectId: "p1", provider: "github", path: "korri-os/korri", kind: "provider-auth", message: "Set up GitHub in the backlog to list issues for korri-os/korri." };
const notInstalled: BacklogWarning = { projectId: "p1", provider: "github", path: "korri-os/korri", kind: "provider-install", message: "Not installed." };
/** A scripted GitHub App: `status` answers with `state`, and each call is recorded. */
function githubApp(state: GitHubAppState, options: { created?: () => Promise<GitHubAppState>; returned?: { code: string; state: string } } = {}) {
  const calls: string[] = [];
  const submitted: GitHubSetup[] = [];
  let returned = options.returned;
  const setup: GitHubSetup = { action: "https://github.com/settings/apps/new?state=forgerie-1", manifest: "{}" };
  const api = {
    status: () => { calls.push("status"); return Promise.resolve(state); },
    setup: (origin: string) => { calls.push(`setup ${origin}`); return Promise.resolve(setup); },
    created: (code: string, value: string) => { calls.push(`created ${code} ${value}`); return options.created?.() ?? Promise.resolve(configured); },
    remove: () => { calls.push("remove"); return Promise.resolve<GitHubAppState>({ state: "not-configured" }); },
  };
  const page: GitHubAppPage = { origin: "https://forgerie.tail.ts.net", setupReturn: () => returned, clearSetupReturn: () => { calls.push("clear"); returned = undefined; },
    submit: (value) => { submitted.push(value); } };
  return { calls, submitted, api, page };
}

describe("GitHub issues", () => {
  it("shows an issue's number beside the project's files, and GitHub's notes inside the group", async () => {
    const hidden: BacklogWarning = { projectId: "p1", provider: "github", path: "korri-os/korri", kind: "items-hidden", message: "2 issues from outside contributors are hidden." };
    const { b } = binding(list([item(), issue()], [hidden]));
    await render({}, b);
    expect([...document.querySelectorAll(".bl-title")].map((node) => node.textContent)).toEqual(["Fix the nested transcript", "Crash on boot"]);
    expect(document.querySelector(".bl-issue")!.textContent).toBe("#7");
    expect(document.querySelector(".bl-group .bl-note-line")!.textContent).toBe("2 issues from outside contributors are hidden.");
    expect(document.querySelector(".bl-problems")).toBeNull();
  });

  it("sets GitHub up from the list: one button leaves for GitHub with this page's address, and no terminal", async () => {
    const github = githubApp({ state: "not-configured" });
    const { b } = binding(list([], [notSetUp]), { github: github.api, githubPage: github.page });
    await render({}, b);
    expect(document.querySelector(".bl-empty")).toBeNull();
    expect(document.querySelector(".bl-github")!.textContent).toContain("Set up GitHub to list the issues of korri-os/korri.");
    expect(document.querySelector(".bl-github pre")).toBeNull();
    // Nothing is listed yet, so nothing is "done".
    expect(document.querySelector(".settings-hint")).toBeNull();
    await click(button("Set up GitHub"));
    expect(github.calls).toEqual(["status", "setup https://forgerie.tail.ts.net"]);
    expect(github.submitted.map((setup) => setup.action)).toEqual(["https://github.com/settings/apps/new?state=forgerie-1"]);
  });

  it("finishes the setup when GitHub sends the person back, clears the code first, and reads the list again", async () => {
    const github = githubApp({ state: "not-configured" }, { returned: { code: "code-1", state: "forgerie-1" } });
    let refreshed = 0;
    const { b } = binding(list([item()], [notInstalled]), { github: github.api, githubPage: github.page, onRefresh: () => { refreshed++; } });
    await render({}, b);
    expect(github.calls).toEqual(["clear", "created code-1 forgerie-1"]);
    expect(refreshed).toBe(1);
    const install = document.querySelector<HTMLAnchorElement>(".bl-github a")!;
    expect([install.textContent, install.href, install.target, install.rel]).toEqual(["Install on GitHub", "https://github.com/apps/forgerie-zao/installations/new", "_blank", "noopener noreferrer"]);
    expect(document.querySelector(".bl-github")!.textContent).toContain("forgerie-zao is not installed on korri-os/korri.");
    await click(button("Check again"));
    expect(refreshed).toBe(2);
  });

  it("says why a setup return failed, and offers to start again", async () => {
    const github = githubApp({ state: "not-configured" }, { returned: { code: "old", state: "forgerie-1" }, created: () => Promise.reject(new Error("This GitHub setup is older than an hour. Start the setup again.")) });
    const { b } = binding(list([]), { github: github.api, githubPage: github.page });
    await render({}, b);
    expect(document.querySelector(".bl-github-error")!.textContent).toContain("Start the setup again");
    expect(button("Set up GitHub")).toBeDefined();
  });

  it("shows no GitHub panel once the app reads every repo, and removes the app from the list's menu", async () => {
    const github = githubApp(configured);
    const { b } = binding(list([issue()]), { github: github.api, githubPage: github.page });
    await render({}, b);
    expect(document.querySelector(".bl-github")).toBeNull();
    await click(button("Backlog commands"));
    await click(button("Remove GitHub App (forgerie-zao)"));
    expect(github.calls).toEqual(["status", "remove"]);
  });

  it("an issue page links to GitHub, warns that a stranger may have written it, and starts like any item", async () => {
    const { b, launched } = binding(list([item({ id: "7" }), issue()]));
    await render({ item: { projectId: "p1", itemId: "7", provider: "github" } }, b);
    expect(document.querySelector(".settings-title, h1")?.textContent ?? document.querySelector(".bl-item-title")!.textContent).toContain("Crash on boot");
    const link = document.querySelector<HTMLAnchorElement>(".bl-issue-link")!;
    expect([link.textContent, link.href, link.target]).toEqual(["korri-os/korri#7", "https://github.com/korri-os/korri/issues/7", "_blank"]);
    expect(document.querySelector(".bl-untrusted")!.textContent).toContain("Someone on GitHub wrote this issue");
    expect([...document.querySelectorAll(".agent-field-label")].map((node) => node.textContent)).toContain("Status on GitHub");
    await click(button("Start session"));
    expect(launched.map((entry) => [entry.provider, entry.id])).toEqual([["github", "7"]]);
  });

  it("shows Azure work-item links and actions without GitHub or file labels", async () => {
    const azure = sourceItem({ url: "https://dev.azure.com/contoso/Fabrikam%20Web/_workitems/edit/7", status: "Active" });
    const { b, launched } = binding(list([azure]));
    await render({}, b);
    expect(document.querySelector(".bl-issue")!.textContent).toBe("#7");
    expect(document.querySelector(".bl-issue")!.getAttribute("title")).toBe("Azure DevOps work item");
    await render({ item: refOf(azure) }, b);
    expect(document.querySelector<HTMLAnchorElement>(".bl-issue-link")!.href).toBe(azure.url);
    expect(document.body.textContent).toContain("Status on Azure DevOps");
    expect(document.body.textContent).toContain("does not change its Azure assignment or status");
    await click(button("Item commands"));
    expect(button("Copy work item link")).toBeDefined();
    expect(button("Copy file path")).toBeUndefined();
    await click(button("Start session"));
    expect(launched).toEqual([azure]);
  });

  it("keeps Azure access failures out of GitHub setup and visible with no items", async () => {
    const { b } = binding(list([], [{ sourceId: "src-1", provider: "azure-devops", path: "contoso/Fabrikam Web", kind: "provider-auth",
      message: "Azure DevOps rejected the PAT. Replace it on the server." }]));
    await render({}, b);
    expect(document.querySelector(".bl-github")).toBeNull();
    expect(document.querySelector(".bl-problems summary")!.textContent).toContain("Azure DevOps has 1 note");
    expect(document.querySelector(".bl-problems")!.textContent).toContain("Replace it on the server");
    expect(document.querySelector(".bl-empty")).toBeNull();
  });

  it("explains that Azure items can leave the assigned list", async () => {
    const { b } = binding(list([]));
    await render({ item: { sourceId: "src-1", itemId: "contoso:7", provider: "azure-devops" } }, b);
    expect(document.querySelector(".notice")!.textContent).toContain("It was reassigned");
    expect(document.querySelector(".notice")!.textContent).not.toContain("front matter");
  });

  it("says why an issue left the list", async () => {
    const { b } = binding(list([]));
    await render({ item: { projectId: "p1", itemId: "7", provider: "github" } }, b);
    expect(document.querySelector(".notice")!.textContent).toContain("This issue is no longer listed");
  });
});

it("persists the scope control and shows You and assignees in Everyone", async () => {
  const { useBacklogScope } = await import("../../backlog/backlogScope");
  window.localStorage.clear();
  const { b } = binding(list([item({ assignees: ["Ada"], assignedToMe: true })]));
  function Scoped() { const { scope, setScope } = useBacklogScope(); return <BacklogView place={{}} binding={{ ...b, scope, onScope: setScope }} />; }
  await act(async () => root.render(<Scoped />)); await settle();
  expect(button("Mine")!.getAttribute("aria-pressed")).toBe("true");
  await click(button("Everyone"));
  expect(document.querySelector(".bl-meta")!.textContent).toContain("YouAda");
  await act(async () => root.render(<div />)); await act(async () => root.render(<Scoped />)); await settle();
  expect(button("Everyone")!.getAttribute("aria-pressed")).toBe("true");
  window.localStorage.clear();
});

it("shows Azure image delivery and known omissions beside the session action without loading images", async () => {
  const entry = sourceItem();
  const { b } = binding(list([entry]));
  b.api.detail = async () => ({ item: entry, body: "Before [Image 1: screenshot] after", initialPrompt: "", imageSummary: { count: 2, eligibleCount: 1,
    skipped: [{ index: 2, name: "external", reason: "not an allowed Azure attachment URL for this organization" }] } });
  await render({ item: refOf(entry) }, b);
  expect(document.body.textContent).toContain("1 image will be given to the agent");
  expect(document.body.textContent).toContain("Image 2 (external) cannot be attached");
  expect(document.body.textContent).toContain("Select an image-capable model");
  expect(document.querySelector("img")).toBeNull(); expect(button("Start session")).toBeDefined();
});

describe("Azure DevOps sources", () => {
  const projects = [{ id: "p1", name: "forgerie" }, { id: "p2", name: "storefront" }];
  it("gives each source one group with its board and destination, after the held items", async () => {
    const support = summary({ sourceId: "src-2", label: "Support Desk", areaPath: undefined, destination: { kind: "not-routed", reason: "unset" } });
    const { b } = binding(list([item(), sourceItem(), sourceItem({ id: "contoso:8", title: "Refund button stays grey" }),
      sourceItem({ id: "contoso:9", title: "Reply macro drops the signature", owner: { kind: "source", sourceId: "src-2", label: "Support Desk" }, destination: support.destination }),
      sourceItem({ id: "contoso:10", title: "Held work item", claim: { ...held, provider: "azure-devops", itemId: "contoso:10", sourceId: "src-1" }, readiness: "claimed" })],
    [], [summary(), support]), { projects });
    await render({}, b);
    expect(groups()).toEqual(["In a session", "Fabrikam Web", "forgerie", "Support Desk"]);
    const fabrikam = document.querySelector('[aria-label="Fabrikam Web"]')!;
    expect(fabrikam.querySelector(".bl-source-board")!.textContent).toBe("contoso · Fabrikam Web\\Checkout");
    expect(fabrikam.querySelector(".bl-destination")!.textContent).toBe("→ storefront");
    expect(fabrikam.querySelectorAll(".bl-title")).toHaveLength(2);
    expect(document.querySelector('[aria-label="Support Desk"] .bl-destination')!.textContent).toBe("Not routed");
    expect(document.querySelector('[aria-label="forgerie"] .bl-source')).toBeNull();
    // A held source item names its source where a project's would name its project.
    expect(document.querySelector('[aria-label="In a session"] .bl-held')!.textContent).toBe("Fabrikam WebWorking in Atomic deploys");
    expect(document.querySelector(".bl-total")!.textContent).toBe("5 items in 1 project and 2 sources");
  });

  it("says when a source's destination project left Forgerie, and keeps its overlap note in its group", async () => {
    const overlap: BacklogWarning = { sourceId: "src-1", provider: "azure-devops", path: "contoso/Fabrikam Web", kind: "source-overlap",
      message: "Overlaps contoso / Fabrikam Web (no Area Path). Give both sources Area Paths that do not overlap." };
    const gone = summary({ destination: { kind: "not-routed", reason: "missing-project" }, warnings: [overlap] });
    const { b } = binding(list([sourceItem({ destination: gone.destination })], [overlap], [gone]), { projects });
    await render({}, b);
    const group = document.querySelector('[aria-label="Fabrikam Web"]')!;
    expect(group.querySelector(".bl-destination")!.textContent).toBe("Not routed");
    expect(group.textContent).toContain("destination project is no longer registered");
    expect(group.textContent).toContain("Give both sources Area Paths that do not overlap");
    expect(document.querySelector(".bl-problems")).toBeNull();
  });

  it("shows a contested item as held, with every session that holds it", async () => {
    const other: BacklogClaim = { ...held, claimId: "c2", sessionId: "s-other" };
    const message = "Azure work item has contested claims held by: s-held, s-other.";
    const contested = sourceItem({ claim: held, readiness: "claimed", contested: { claims: [held, other], message } });
    const { b } = binding(list([contested], [{ sourceId: "src-1", provider: "azure-devops", path: contested.path, kind: "contested-claim", message }], [summary()]), { projects });
    await render({}, b);
    expect(groups()).toEqual(["In a session"]);
    expect(document.querySelector(".bl-contested")!.textContent).toBe("Held by 2 sessions: Atomic deploys, a session not in the list. Archive or release them until one holds it.");
    expect(document.querySelector(".bl-problems")).toBeNull();
    await render({ item: refOf(contested) }, b);
    expect(document.querySelector(".bl-claim")!.textContent).toContain("Held by 2 sessions");
    expect(button("Open session")).toBeDefined();
  });

  it("an item page names its source and where its session starts, and starts like any item", async () => {
    const entry = sourceItem();
    const { b, launched } = binding(list([entry], [], [summary()]), { projects });
    await render({ item: refOf(entry) }, b);
    const properties = [...document.querySelectorAll(".agent-field")].map((node) => node.textContent);
    expect(properties).toContain("SourceFabrikam Web");
    expect(properties).toContain("Destinationstorefront");
    expect(properties.some((text) => text?.startsWith("Project"))).toBe(false);
    await click(button("Start session"));
    expect(launched).toEqual([entry]);
    const unrouted = sourceItem({ destination: { kind: "not-routed", reason: "unset" } });
    await render({ item: refOf(unrouted) }, binding(list([unrouted], [], [summary()]), { projects }).b);
    expect(document.body.textContent).toContain("Not routed. You choose a project when you start a session");
  });
});
