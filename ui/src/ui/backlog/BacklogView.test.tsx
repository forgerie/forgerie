// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BacklogView, type BacklogBinding } from "./BacklogView";
import type { BacklogClaim, BacklogItem, BacklogList, BacklogWarning } from "../../backlog/backlogApi";
import type { BacklogPlace } from "../../backlog/backlogModel";
import type { GitHubAuthState } from "../../backlog/githubApi";
import { PENDING_POLL_MS } from "../../backlog/useGitHubAuth";

let root: Root;
const item = (extra: Partial<BacklogItem> = {}): BacklogItem => ({ id: "01A", title: "Fix the nested transcript", provider: "markdown", projectId: "p1", projectName: "forgerie",
  repo: "/code/forgerie", path: "work/items/a.md", status: "To Do", priority: "high", labels: ["agents"], created: "2026-09-01", open: true, readiness: "ready",
  blockingIds: [], ...extra });
const held: BacklogClaim = { kind: "claimed", claimId: "c1", projectId: "p1", provider: "markdown", itemId: "02B", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9",
  claimedAt: "2026-10-07T10:00:00Z", sessionId: "s-held", branch: "feat/atomic-deploys" };
const list = (items: BacklogItem[], warnings: BacklogList["warnings"] = []): BacklogList => ({ items, warnings, generatedAt: "now" });

function binding(value: BacklogList, extra: Partial<BacklogBinding> = {}) {
  const places: BacklogPlace[] = [];
  const launched: BacklogItem[] = [];
  const opened: string[] = [];
  const released: string[] = [];
  const b: BacklogBinding = {
    load: { type: "ready", value }, onRefresh: () => {},
    api: {
      detail: async (ref) => {
        const found = value.items.find((entry) => entry.projectId === ref.projectId && entry.id === ref.itemId && entry.provider === (ref.provider ?? "markdown"));
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
    expect(places).toEqual([{ item: { projectId: "p1", itemId: "01A", provider: "markdown" } }]);
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

const app = { clientId: "Iv23liForgerie01", slug: "forgerie-zao" };
const issue = (extra: Partial<BacklogItem> = {}) => item({ id: "7", provider: "github", title: "Crash on boot", path: "korri-os/korri#7",
  url: "https://github.com/korri-os/korri/issues/7", status: "Open", priority: undefined, labels: ["bug"], ...extra });
const needsLogin: BacklogWarning = { projectId: "p1", provider: "github", path: "korri-os/korri", kind: "provider-auth", message: "Connect GitHub to list issues for korri-os/korri." };
/** A scripted GitHub login: each call answers with the next state, and the last state repeats. */
function githubLogin(...states: GitHubAuthState[]) {
  const calls: string[] = [];
  const next = (call: string) => { calls.push(call); return Promise.resolve(states.length > 1 ? states.shift()! : states[0]!); };
  return { calls, api: { status: () => next("status"), login: () => next("login"), disconnect: () => next("disconnect") } };
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

  it("connects from the list: the code shows, the page waits, and the list reads again once GitHub approves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending: GitHubAuthState = { state: "pending", app, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: "2026-10-07T12:15:00Z" };
      const github = githubLogin({ state: "disconnected", app }, pending, pending, { state: "connected", app, login: "simonwjackson" });
      let refreshed = 0;
      const { b } = binding(list([item()], [needsLogin]), { github: github.api, onRefresh: () => { refreshed++; } });
      await render({}, b);
      expect(document.querySelector(".bl-github")!.textContent).toContain("Connect GitHub to list the issues of korri-os/korri.");
      await click(button("Connect GitHub"));
      expect(document.querySelector(".bl-code")!.textContent).toBe("WDJB-MJHT");
      expect(document.querySelector<HTMLAnchorElement>(".bl-github a")!.href).toBe("https://github.com/login/device");
      expect(document.querySelector<HTMLAnchorElement>(".bl-github a")!.rel).toBe("noopener noreferrer");
      await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS); }); await settle();
      expect(refreshed).toBe(0);
      await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS); }); await settle();
      expect(github.calls).toEqual(["status", "login", "status", "status"]);
      expect(refreshed).toBe(1);
      await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS * 3); }); await settle();
      expect(github.calls).toHaveLength(4);
    } finally { vi.useRealTimers(); }
  });

  it("says how to set GitHub up on a machine that has no app, instead of offering a login that cannot work", async () => {
    const { b } = binding(list([], [needsLogin]), { github: githubLogin({ state: "not-configured" }).api });
    await render({}, b);
    expect(document.querySelector(".bl-empty")).toBeNull();
    expect(document.querySelector(".bl-github pre")!.textContent).toBe("scripts/github-app-wizard.sh");
    expect(button("Connect GitHub")).toBeUndefined();
    // Nothing is listed yet, so nothing is "done".
    expect(document.querySelector(".settings-hint")).toBeNull();
  });

  it("logs out from the list's menu once connected", async () => {
    const github = githubLogin({ state: "connected", app, login: "simonwjackson" }, { state: "disconnected", app });
    const { b } = binding(list([issue()]), { github: github.api });
    await render({}, b);
    expect(document.querySelector(".bl-github")).toBeNull();
    await click(button("Backlog commands"));
    await click(button("Log out of GitHub (simonwjackson)"));
    expect(github.calls).toEqual(["status", "disconnect"]);
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

  it("says why an issue left the list", async () => {
    const { b } = binding(list([]));
    await render({ item: { projectId: "p1", itemId: "7", provider: "github" } }, b);
    expect(document.querySelector(".notice")!.textContent).toContain("This issue is no longer listed");
  });
});
