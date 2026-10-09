// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectGroups } from "./ProjectGroups";
import { relatedSections, type RelatedAction } from "./relatedSections";
import { SessionMenu } from "../ui/WorktreeActions";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
import { catalog, related } from "./fixtures/groups";
let root: Root;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label)!;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("lists each group with its project names, and hides the worktree section when there are none", async () => {
  await act(async () => root.render(<ProjectGroups catalog={catalog} loaded worktrees={[]} onNew={() => undefined} onOpen={() => undefined} onRefresh={() => undefined} onWorktree={() => undefined} />));
  expect(document.body.textContent).toContain("korri, korri-plugins");
  expect(document.body.textContent).toContain("2 projects");
  expect(document.body.textContent).not.toContain("Related worktrees");
  expect(document.querySelector("dialog")).toBeNull();
});

it("offers Land and Discard for a related worktree from its row menu", async () => {
  const commands: string[] = [];
  await act(async () => root.render(<ProjectGroups catalog={catalog} loaded worktrees={related.related} onNew={() => undefined} onOpen={() => undefined}
    onRefresh={() => undefined} onWorktree={(info, command) => commands.push(`${command}:${info.id}`)} />));
  expect(document.body.textContent).toContain("2 commits ahead, 3 changed files");
  await act(async () => button("Commands for korri-plugins").click());
  await act(async () => button("Land on main").click());
  await act(async () => button("Commands for korri-plugins").click());
  await act(async () => button("Discard worktree").click());
  expect(commands).toEqual(["land:secondary", "discard:secondary"]);
});

const menu = (worktrees: readonly WorktreeInfo[], busy: boolean, onAction: (action: RelatedAction, info: WorktreeInfo) => void, notes: Record<string, number> = {}) =>
  <SessionMenu busy={busy} sections={relatedSections(worktrees, { busy, notes, failures: {}, onAction })} />;
const openMenu = () => act(async () => document.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click());

it("draws no menu for a chat with no worktree of its own and none in other repos", async () => {
  await act(async () => root.render(menu([], false, () => undefined)));
  expect(document.body.textContent).toBe("");
});

it("the header menu holds each related worktree's review, pull requests, Land and Discard, and counts them on its button", async () => {
  const actions: string[] = [];
  const render = (busy: boolean) => act(async () => root.render(menu(related.related, busy, (action, info) => actions.push(`${action}:${info.id}`), { secondary: 2 })));
  await render(false);
  expect(document.querySelector("[aria-haspopup=menu]")?.getAttribute("aria-label")).toBe("Session menu, 1 other worktree");
  expect(document.querySelector("[aria-haspopup=menu]")?.textContent).toBe("1");
  for (const label of ["Changes and files", "Pull requests", "Add 2 review notes to the message", "Land on main…", "Discard worktree…"]) {
    await openMenu();
    await act(async () => button(label).click());
  }
  expect(actions).toEqual(["changes:secondary", "pulls:secondary", "notes:secondary", "land:secondary", "discard:secondary"]);
  await render(true);
  await openMenu();
  expect([...document.querySelectorAll("[role=menuitem]")].find((node) => node.textContent?.startsWith("Land on main"))?.hasAttribute("disabled")).toBe(true);
  expect(button("Changes and files").disabled).toBe(false);
});

it("a failed setup offers a retry and the log, and a finished worktree leaves the menu", async () => {
  const actions: string[] = [];
  const failed: WorktreeInfo = { ...related.related[0]!, setup: { phase: "failed", log: "npm ERR!", error: "hook exited 1" } };
  const done: WorktreeInfo = { ...related.related[0]!, id: "done", state: { kind: "landed", sha: "abc1234", at: "2026-10-09" }, cleanup: { kind: "done" } };
  await act(async () => root.render(menu([failed, done], false, (action) => actions.push(action))));
  await openMenu();
  expect(document.querySelectorAll("[role=group]")).toHaveLength(1);
  expect(document.body.textContent).toContain("Setup failed: hook exited 1");
  await act(async () => button("Retry setup").click());
  await openMenu();
  await act(async () => button("Ask the agent about the failure").click());
  expect(actions).toEqual(["retry", "explain"]);
});

it("keeps the chat's own branch first, with its Land and Discard, above the related worktrees", async () => {
  const own: string[] = [];
  const mine: WorktreeInfo = { ...related.related[0]!, id: "mine", repo: "/code/korri", branch: "s-mine" };
  await act(async () => root.render(<SessionMenu info={mine} busy={false} onCommand={(command) => own.push(command)}
    sections={relatedSections(related.related, { busy: false, notes: {}, failures: {}, onAction: () => undefined })} />));
  await openMenu();
  const items = [...document.querySelectorAll("[role=menuitem]")].map((node) => node.textContent);
  expect(items.slice(0, 2)).toEqual(["Land on main…", "Discard worktree…"]);
  expect(document.querySelector("[role=group]")?.getAttribute("aria-label")).toBe("korri-plugins");
  await act(async () => (document.querySelector("[role=menuitem]") as HTMLButtonElement).click());
  expect(own).toEqual(["land"]);
});
