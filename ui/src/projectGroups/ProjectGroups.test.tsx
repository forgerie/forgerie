// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectGroups } from "./ProjectGroups";
import { RelatedRepos } from "./RelatedRepos";
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

it("shows target-repo controls without moving the chat and blocks lifecycle actions during a run", async () => {
  const actions: string[] = [];
  await act(async () => root.render(<RelatedRepos context={related} busy onPrepare={() => actions.push("prepare")} onAction={(action, info) => actions.push(`${action}:${info.id}`)} onClose={() => undefined} onRefresh={() => undefined} />));
  expect(document.body.textContent).toContain("same agent");
  expect(button("Prepare worktree").disabled).toBe(true);
  expect(button("Land on main").disabled).toBe(true);
  expect(button("Discard").disabled).toBe(true);
  await act(async () => button("Changes and files").click());
  expect(actions).toEqual(["changes:secondary"]);
});
