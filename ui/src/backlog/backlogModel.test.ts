import { describe, expect, it } from "vitest";
import type { BacklogClaim, BacklogItem, BacklogWarning } from "./backlogApi";
import { accessWarnings, ageText, ageWords, bodyUnderTitle, findItem, firstMessage, groupBacklog, heldSessions, holderOf, ignoredFix, issueNumber, matches, openCount, otherWarnings, priorityWord,
  readBacklogPlace, readItemParam, itemParam, refOf, relativePath, sameItem } from "./backlogModel";

const item = (extra: Partial<BacklogItem> = {}): BacklogItem => ({
  id: "01A", title: "Fix the scanner", provider: "markdown", projectId: "p1", projectName: "forgerie", repo: "/code/forgerie", path: "work/items/a.md",
  status: "To Do", priority: "medium", labels: [], created: "2026-09-01", assignedToMe: true, assignees: [], open: true, readiness: "ready", blockingIds: [], ...extra,
});
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
    const azure = item({ provider: "azure-devops", id: "amazeinsights:42" });
    expect(readItemParam(itemParam(refOf(azure)))).toEqual(refOf(azure));
    expect(issueNumber(azure)).toBe("#42");
    expect(matches(azure, "#42")).toBe(true);
    expect(sameItem(refOf(azure), refOf(item({ provider: "azure-devops", id: "other:42" })))).toBe(false);
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
    expect([...heldSessions([item({ claim: claimed("s1") }), item({ claim: { ...claimed("s2"), kind: "launching" } as BacklogClaim })])]).toEqual(["s1"]);
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
    expect(relativePath({ repo: "/code/forgerie", path: "/code/forgerie/work/items/a.md" })).toBe("work/items/a.md");
    expect(relativePath({ repo: "/code/forgerie", path: "work/items/a.md" })).toBe("work/items/a.md");
  });
});
