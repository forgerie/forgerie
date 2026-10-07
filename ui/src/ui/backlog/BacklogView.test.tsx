// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BacklogView, type BacklogBinding } from "./BacklogView";
import type { BacklogClaim, BacklogItem, BacklogList } from "../../backlog/backlogApi";
import type { BacklogPlace } from "../../backlog/backlogModel";

let root: Root;
const item = (extra: Partial<BacklogItem> = {}): BacklogItem => ({ id: "01A", title: "Fix the nested transcript", projectId: "p1", projectName: "forgerie",
  repo: "/code/forgerie", path: "work/items/a.md", status: "To Do", priority: "high", labels: ["agents"], created: "2026-09-01", open: true, readiness: "ready",
  blockingIds: [], ...extra });
const held: BacklogClaim = { kind: "claimed", claimId: "c1", projectId: "p1", itemId: "02B", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9",
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
      detail: async (projectId, itemId) => {
        const found = value.items.find((entry) => entry.projectId === projectId && entry.id === itemId);
        if (!found) throw Object.assign(new Error("Backlog item not found or invalid"), { kind: "not-found" });
        return { item: found, body: "## Why it matters\n\nThe scanner lists **8,946** files.", initialPrompt: "" };
      },
      release: async (_projectId, _itemId, claimId) => { released.push(claimId); return { released: true }; },
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
    expect(places).toEqual([{ item: { projectId: "p1", itemId: "01A" } }]);
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
    const interrupted: BacklogClaim = { kind: "interrupted", claimId: "c-int", projectId: "p1", itemId: "02B", repo: "/code/forgerie", cwd: "/code/forgerie/.worktree/s-9", claimedAt: "2026-10-07T10:00:00Z" };
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
    expect(places).toEqual([{ item: { projectId: "p1", itemId: "02B" } }]);
  });

  it("a removed item says so instead of a blank page", async () => {
    const { b } = binding(list([]));
    await render({ item: { projectId: "p1", itemId: "gone" } }, b);
    expect(document.querySelector(".notice")!.textContent).toContain("no longer in the backlog");
  });
});
