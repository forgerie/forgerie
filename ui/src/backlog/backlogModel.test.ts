import { describe, expect, it } from "vitest";
import type { BacklogClaim, BacklogItem, BacklogWarning } from "./backlogApi";
import type { BacklogSourceSummary } from "./backlogApi";
import { accessWarnings, ageText, ageWords, bodyUnderTitle, carryRoute, contestedLine, destinationWords, findItem, firstMessage, groupBacklog, heldSessions, holderOf, ignoredFix, issueNumber,
  launchFolder, matches, openCount, otherWarnings, ownersText, priorityWord, readBacklogPlace, readItemParam, itemParam, refOf, relativePath, sameItem } from "./backlogModel";

type ProjectItem = Extract<BacklogItem, { owner: { kind: "project" } }>;
type SourceItem = Extract<BacklogItem, { owner: { kind: "source" } }>;
const fields = { title: "Fix the scanner", path: "work/items/a.md", status: "To Do", priority: "medium", labels: [], created: "2026-09-01", assignedToMe: true, assignees: [],
  open: true, readiness: "ready" as const, blockingIds: [] };
/** A project's own item. Its owner follows `projectId`, `projectName` and `repo`, so a test names a project once. */
const item = (extra: Partial<ProjectItem> = {}): BacklogItem => {
  const base = { id: "01A", provider: "markdown", projectId: "p1", projectName: "forgerie", repo: "/code/forgerie", ...fields, ...extra };
  return { ...base, owner: { kind: "project", projectId: base.projectId, projectName: base.projectName, repo: base.repo },
    destination: extra.destination ?? { kind: "routed", projectId: base.projectId, reason: "project-owned" } };
};
/** An Azure board's item: no project of its own, only a destination. */
const sourceItem = (extra: Partial<SourceItem> = {}): BacklogItem => ({ id: "contoso:7", provider: "azure-devops", ...fields, path: "contoso/Fabrikam Web#7",
  owner: { kind: "source", sourceId: "s1", label: "Fabrikam Web" }, destination: { kind: "routed", projectId: "p2", reason: "source-destination" }, ...extra });
const summary = (extra: Partial<BacklogSourceSummary> = {}): BacklogSourceSummary => ({ sourceId: "s1", label: "Fabrikam Web", provider: "azure-devops", organization: "contoso",
  destination: { kind: "routed", projectId: "p2", reason: "source-destination" }, warnings: [], ...extra });
const claimed = (sessionId: string, claimedAt = "2026-10-06T10:00:00Z"): BacklogClaim => ({ kind: "claimed", claimId: `c-${sessionId}`, projectId: "p1", provider: "markdown",
  itemId: "x", repo: "/code/forgerie", cwd: "/code/forgerie", claimedAt, sessionId });
const ignored = (projectId: string, path: string): BacklogWarning => ({ projectId, path, kind: "ignored-directory", message: "ignored" });
const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("the backlog place in the URL", () => {
  it("reads the list, one item, and nothing", () => {
    expect(readBacklogPlace(new URLSearchParams("backlog"))).toEqual({});
    expect(readBacklogPlace(new URLSearchParams("backlog=p1/01A"))).toEqual({ item: { projectId: "p1", itemId: "01A", provider: "markdown" } });
    expect(readBacklogPlace(new URLSearchParams("session=s1"))).toBeUndefined();
  });
  it("round-trips an item, and refuses a half", () => {
    expect(readItemParam(itemParam({ projectId: "p1", itemId: "task-013" }))).toEqual({ projectId: "p1", itemId: "task-013", provider: "markdown" });
    expect(readItemParam("p1/")).toBeUndefined();
    expect(readItemParam("/01A")).toBeUndefined();
    expect(readItemParam("github~/7")).toBeUndefined();
  });
  it("names another provider's item, and keeps a markdown link as it was", () => {
    expect(itemParam({ projectId: "p1", itemId: "7", provider: "github" })).toBe("github~p1/7");
    expect(itemParam({ projectId: "p1", itemId: "01A", provider: "markdown" })).toBe("p1/01A");
    expect(readItemParam("github~p1/7")).toEqual({ projectId: "p1", itemId: "7", provider: "github" });
    // A markdown id may hold anything after the first slash, including a tilde.
    expect(readItemParam("p1/odd~id/x")).toEqual({ projectId: "p1", itemId: "odd~id/x", provider: "markdown" });
  });
  it("keeps Azure organization identity in URLs while displaying the short work-item number", () => {
    const azure = sourceItem({ id: "contoso:42" });
    expect(readItemParam(itemParam(refOf(azure)))).toEqual(refOf(azure));
    expect(issueNumber(azure)).toBe("#42");
    expect(matches(azure, "#42")).toBe(true);
    expect(sameItem(refOf(azure), refOf(sourceItem({ id: "other:42" })))).toBe(false);
  });
  it("addresses a source's item through its source, beside a project's item", () => {
    const azure = sourceItem();
    expect(refOf(azure)).toEqual({ sourceId: "s1", itemId: "contoso:7", provider: "azure-devops" });
    expect(itemParam(refOf(azure))).toBe("source:s1/contoso:7");
    expect(readBacklogPlace(new URLSearchParams("backlog=source:s1/contoso:7"))).toEqual({ item: { sourceId: "s1", itemId: "contoso:7", provider: "azure-devops" } });
    expect(readItemParam("source:/7")).toBeUndefined();
    expect(readItemParam("source:s1/")).toBeUndefined();
    // The same item id in a project and in a source is two items.
    expect(sameItem(refOf(azure), { projectId: "s1", itemId: "contoso:7", provider: "azure-devops" })).toBe(false);
    expect(findItem([item(), azure], { sourceId: "s1", itemId: "contoso:7" })).toBe(azure);
  });
  it("tells the same id from two providers apart", () => {
    const issue = item({ id: "7", provider: "github" });
    const file = item({ id: "7" });
    expect(sameItem(refOf(issue), refOf(file))).toBe(false);
    expect(sameItem({ projectId: "p1", itemId: "7" }, refOf(file))).toBe(true);
    expect(findItem([file, issue], { projectId: "p1", itemId: "7", provider: "github" })).toBe(issue);
    expect(issueNumber(issue)).toBe("#7");
    expect(issueNumber(file)).toBeUndefined();
  });
});

describe("ages and priority", () => {
  it("counts whole days and says nothing for a missing date", () => {
    expect(ageText("2026-09-16", NOW)).toBe("21d");
    expect(ageText("2026-10-07", NOW)).toBe("today");
    expect(ageText(undefined, NOW)).toBe("");
    expect(ageText("someday", NOW)).toBe("");
    expect(ageWords("2026-10-06", NOW)).toBe("Yesterday");
    expect(ageWords("2026-09-16", NOW)).toBe("21 days ago");
  });
  it("writes priority as a word", () => {
    expect(priorityWord("high")).toBe("High");
    expect(priorityWord(" ")).toBeUndefined();
    expect(priorityWord(undefined)).toBeUndefined();
  });
});

describe("who holds an item", () => {
  const look = (id: string) => ({ s1: { state: "working", name: "Atomic deploys", time: "41m" }, s2: { state: "errored", time: "2h" },
    s3: { state: "unread", name: "Read me", time: "3m" } } as Record<string, { state: string; name?: string; time: string }>)[id];
  it("speaks in the session list's words", () => {
    expect(holderOf(claimed("s1"), look)).toEqual({ state: "working", name: "Atomic deploys", time: "41m", sessionId: "s1" });
    expect(holderOf(claimed("s2"), look).state).toBe("blocked");
    expect(holderOf(claimed("s3"), look).state).toBe("open");
  });
  it("says when the session is unknown, or the launch is not done", () => {
    expect(holderOf(claimed("gone"), look)).toEqual({ state: "missing", sessionId: "gone" });
    expect(holderOf({ ...claimed("s1"), kind: "launching" } as BacklogClaim, look).state).toBe("starting");
    expect(holderOf({ ...claimed("s1"), kind: "interrupted" } as BacklogClaim, look).state).toBe("interrupted");
  });
});

describe("grouping", () => {
  it("puts held items first, then one group per project by name, priority then newest inside", () => {
    const items = [
      item({ id: "low", priority: "low", created: "2026-10-01" }),
      item({ id: "old-high", priority: "high", created: "2026-08-01" }),
      item({ id: "new-high", priority: "high", created: "2026-09-01" }),
      item({ id: "none", priority: undefined }),
      item({ id: "rocks", projectId: "p2", projectName: "nix-on-rocks" }),
      item({ id: "bazzar", projectId: "p3", projectName: "bazzar" }),
      item({ id: "held", projectId: "p2", projectName: "nix-on-rocks", claim: claimed("s1"), readiness: "claimed" }),
    ];
    const groups = groupBacklog(items, []);
    expect(groups.map((group) => group.label)).toEqual(["In a session", "bazzar", "forgerie", "nix-on-rocks"]);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["held"]);
    expect(groups[2]!.items.map((entry) => entry.id)).toEqual(["new-high", "old-high", "low", "none"]);
  });
  it("hides done items unless asked, then shows them last", () => {
    const items = [item({ id: "done", readiness: "closed", open: false, priority: "high" }), item({ id: "open", priority: "low" })];
    expect(groupBacklog(items, [])[0]!.items.map((entry) => entry.id)).toEqual(["open"]);
    expect(groupBacklog(items, [], { showDone: true })[0]!.items.map((entry) => entry.id)).toEqual(["open", "done"]);
    expect(openCount(items)).toBe(1);
  });
  it("filters on every word, across title, labels, id, and project", () => {
    const entry = item({ title: "Stabilize WiFi", labels: ["bluetooth"], projectName: "nix-on-rocks" });
    expect(matches(entry, "wifi BLUE")).toBe(true);
    expect(matches(entry, "rocks wifi")).toBe(true);
    expect(matches(entry, "audio")).toBe(false);
    expect(groupBacklog([entry], [], { filter: "audio" })).toEqual([]);
  });
  it("puts an ignored folder's warning in its project group, and the rest below the list", () => {
    const warnings = [ignored("p1", "/code/forgerie/.forgerie/backlog/"), ignored("p9", "/code/empty/.forgerie/backlog/"),
      { projectId: "p1", path: "/code/forgerie/work/items/plan.md", kind: "invalid-item", message: "bad" }];
    const groups = groupBacklog([item()], warnings);
    expect(groups[0]!.ignored).toBe(warnings[0]);
    // An empty project's ignored folder holds nothing to lose; files that are not items still need saying.
    expect(otherWarnings(groups, warnings)).toEqual([warnings[2]]);
  });
  it("lists the sessions that hold items", () => {
    expect([...heldSessions([item({ claim: claimed("s1") }), item({ claim: { ...claimed("s2"), kind: "launching" } as BacklogClaim }),
      sourceItem({ claim: claimed("s3") })])]).toEqual(["s1", "s3"]);
  });
});

describe("sources", () => {
  const names = (id: string) => ({ p1: "forgerie", p2: "storefront" } as Record<string, string>)[id];
  it("gives each source one group, labelled with the source and its destination, among the projects by name", () => {
    const sources = [summary(), summary({ sourceId: "s2", label: "Support Desk", destination: { kind: "not-routed", reason: "unset" } })];
    const groups = groupBacklog([item(), sourceItem(), sourceItem({ id: "contoso:8" }),
      sourceItem({ id: "contoso:9", owner: { kind: "source", sourceId: "s2", label: "Support Desk" }, destination: { kind: "not-routed", reason: "unset" } })], [], { sources });
    expect(groups.map((group) => [group.key, group.kind, group.label, group.items.length])).toEqual([
      ["source:s1", "source", "Fabrikam Web", 2], ["project:p1", "project", "forgerie", 1], ["source:s2", "source", "Support Desk", 1]]);
    expect(destinationWords(groups[0]!.source!.destination, names)).toBe("→ storefront");
    expect(destinationWords(groups[2]!.source!.destination, names)).toBe("Not routed");
    expect(groups[0]!.source?.organization).toBe("contoso");
  });
  it("puts held items first, from projects and sources alike, newest claim first", () => {
    const groups = groupBacklog([item(), sourceItem({ claim: claimed("s2", "2026-10-07T10:00:00Z"), readiness: "claimed" }),
      item({ id: "02B", claim: claimed("s1", "2026-10-06T10:00:00Z"), readiness: "claimed" })], [], { sources: [summary()] });
    expect(groups[0]!.label).toBe("In a session");
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["contoso:7", "02B"]);
    expect(groups.map((group) => group.label)).toEqual(["In a session", "forgerie"]);
  });
  it("shows a contested item as held, names every holder, and keeps its warning on its row", () => {
    const message = "Azure work item has contested claims held by: s1, s9.";
    const contested = sourceItem({ claim: claimed("s1"), readiness: "claimed", contested: { claims: [claimed("s1"), claimed("s9")], message } });
    const warning: BacklogWarning = { sourceId: "s1", provider: "azure-devops", path: contested.path, kind: "contested-claim", message };
    const groups = groupBacklog([contested], [warning], { sources: [summary()] });
    expect(groups.map((group) => group.kind)).toEqual(["held"]);
    const look = (id: string) => id === "s1" ? { state: "working", name: "Checkout fix", time: "4m" } : undefined;
    expect(contestedLine(contested, look)).toBe("Held by 2 sessions: Checkout fix, a session not in the list. Archive or release them until one holds it.");
    expect(contestedLine(sourceItem(), look)).toBeUndefined();
    expect(otherWarnings(groups, [warning])).toEqual([]);
  });
  it("keeps a source's overlap note in its group, and a source with no items says it below the list", () => {
    const overlap: BacklogWarning = { sourceId: "s1", provider: "azure-devops", path: "contoso/Fabrikam Web", kind: "source-overlap", message: "Overlaps contoso / Fabrikam Web (no Area Path)." };
    const quiet: BacklogWarning = { ...overlap, sourceId: "s2" };
    const groups = groupBacklog([sourceItem()], [overlap, quiet], { sources: [summary({ warnings: [overlap] })] });
    expect(groups[0]!.notes).toEqual([overlap]);
    expect(otherWarnings(groups, [overlap, quiet])).toEqual([quiet]);
  });
  it("starts a session at the destination's folder, and a not-routed item nowhere", () => {
    const projects = [{ id: "p1", path: "/code/forgerie" }, { id: "p2", path: "/code/storefront" }];
    expect(launchFolder(sourceItem(), projects)).toBe("/code/storefront");
    expect(launchFolder(sourceItem({ destination: { kind: "not-routed", reason: "unset" } }), projects)).toBeUndefined();
    expect(launchFolder(sourceItem({ destination: { kind: "not-routed", reason: "missing-project" } }), projects)).toBeUndefined();
    // A routed destination that left this host's list does not guess.
    expect(launchFolder(sourceItem(), [projects[0]!])).toBeUndefined();
    expect(launchFolder(item(), projects)).toBe("/code/forgerie");
    expect(launchFolder(item(), [])).toBe("/code/forgerie");
  });
  it("says where a source's item starts, and asks when it has no destination", () => {
    expect(carryRoute(sourceItem(), "storefront", true)).toEqual({ text: "Starts in storefront · source destination", attention: false });
    expect(carryRoute(sourceItem(), "forgerie", false)).toEqual({ text: "Starts in forgerie · chosen here", attention: false });
    expect(carryRoute(sourceItem(), undefined, false)).toEqual({ text: "This source has no destination. Choose a project, or set one in Settings → Backlog.", attention: true });
    expect(carryRoute(item(), "forgerie", true)).toBeUndefined();
  });
  it("counts where the items come from", () => {
    expect(ownersText([item(), item({ projectId: "p2" })])).toBe("in 2 projects");
    expect(ownersText([item(), sourceItem()])).toBe("in 1 project and 1 source");
    expect(ownersText([sourceItem(), sourceItem({ owner: { kind: "source", sourceId: "s2", label: "Support Desk" } })])).toBe("in 2 sources");
  });
});

describe("GitHub notes", () => {
  const note = (projectId: string, kind: string): BacklogWarning => ({ projectId, provider: "github", path: "korri-os/korri", kind, message: kind });
  it("puts a project's GitHub notes in its group, setup and install above the list, and the rest under it", () => {
    const warnings = [note("p1", "items-hidden"), note("p1", "provider-auth"), note("p2", "provider-unavailable"),
      { projectId: "p1", path: "work/items/x.md", kind: "invalid-item", message: "bad" }, note("p3", "provider-install")];
    const groups = groupBacklog([item({ id: "7", provider: "github" })], warnings);
    expect(groups[0]!.notes).toEqual([warnings[0]]);
    expect(accessWarnings(warnings)).toEqual([warnings[1], warnings[4]]);
    expect(otherWarnings(groups, warnings)).toEqual([warnings[2], warnings[3]]);
  });
  it("finds an issue by its number or by the word github", () => {
    const issue = item({ id: "7", provider: "github", title: "Crash on boot" });
    expect(matches(issue, "#7")).toBe(true);
    expect(matches(issue, "github")).toBe(true);
    expect(matches(item(), "github")).toBe(false);
  });
});

describe("the ignored folder's fix", () => {
  it("names the two lines for the default folder, and nothing for an override", () => {
    expect(ignoredFix(ignored("p", "/code/bazzar/.forgerie/backlog/"))).toBe(".forgerie/*\n!.forgerie/backlog/");
    expect(ignoredFix(ignored("p", "/code/bazzar/.forgerie/backlog"))).toBe(".forgerie/*\n!.forgerie/backlog/");
    expect(ignoredFix(ignored("p", "/code/forgerie/work/items/"))).toBeUndefined();
  });
});

describe("the first message", () => {
  it("leads with the item, and the author's words follow", () => {
    expect(firstMessage("This is backlog item 01A.\n\n# Fix", "", false)).toBe("This is backlog item 01A.\n\n# Fix");
    expect(firstMessage("This is backlog item 01A.", "  Start with the scanner. ", false)).toBe("This is backlog item 01A.\n\nStart with the scanner.");
  });
  it("lets a skill lead, with the item as its arguments", () => {
    expect(firstMessage("This is backlog item 01A.", "/skill:tdd", true)).toBe("/skill:tdd\n\nThis is backlog item 01A.");
  });
  it("drops a leading heading that repeats the title, and nothing else", () => {
    expect(bodyUnderTitle("# Fix the scanner\n\n## Why\n\nText", "Fix the scanner")).toBe("## Why\n\nText");
    expect(bodyUnderTitle("\n# Fix the scanner #\nText", "Fix the scanner")).toBe("Text");
    expect(bodyUnderTitle("# Another heading\n\nText", "Fix the scanner")).toBe("# Another heading\n\nText");
    expect(bodyUnderTitle("## Fix the scanner\nText", "Fix the scanner")).toBe("## Fix the scanner\nText");
  });
  it("shows a repository path relative to its repository", () => {
    expect(relativePath(item({ path: "/code/forgerie/work/items/a.md" }))).toBe("work/items/a.md");
    expect(relativePath(item({ path: "work/items/a.md" }))).toBe("work/items/a.md");
    expect(relativePath(sourceItem())).toBe("contoso/Fabrikam Web#7");
  });
});
