// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { RelatedWorkspaces } from "./RelatedWorkspaces.binding";
import { related } from "./fixtures/groups";
import type { ProjectGroupApi } from "./projectGroupApi";
import { markdownView } from "../ui/markdownView";
import { loadMarkdownKit } from "../ui/markdownKit";

let root: Root;
const WORKTREE = related.related[0]!.path;
const DIFF = ["diff --git a/README.md b/README.md", "--- a/README.md", "+++ b/README.md", "@@ -1,3 +1,3 @@", " # Plugins", " ", "-Old line.", "+New line.", ""].join("\n");
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
const pressed = () => [...document.querySelectorAll<HTMLButtonElement>('dialog.changes-dialog [role="group"][aria-label="View"] button')]
  .find((node) => node.getAttribute("aria-pressed") === "true")?.textContent;

const request = vi.fn(async (path: string) => {
  if (path === "/api/projects") return Response.json([{ id: "p", path: WORKTREE }]);
  if (path === "/api/projects/p/workspaces") return Response.json([{ id: "w", projectId: "p", path: WORKTREE }]);
  if (path === "/api/projects/p/workspaces/w/git/status") return Response.json({ isGitRepo: true, hash: "h", branch: "s-12345678", submodules: [],
    files: [{ path: "README.md", index: "unmodified", workingTree: "modified" }] });
  if (path.startsWith("/api/projects/p/workspaces/w/git/diff?")) return Response.json({ path: "README.md", staged: false, hash: "h", diff: DIFF, truncated: false });
  if (path === "/api/projects/p/workspaces/w/file?path=README.md") {
    const content = "# Plugins\n\nNew line.\n";
    return Response.json({ path: "README.md", content, size: content.length, binary: false, truncated: false, version: "v:readme" });
  }
  if (path.startsWith("/api/projects/p/workspaces/w/tree?")) return Response.json({ entries: [], truncated: false });
  throw new Error(`Unexpected request ${path}`);
});
const api = { context: async () => related, prepare: async () => undefined } as unknown as ProjectGroupApi;

// The review loads its editors on demand; loading them once keeps those cold imports out of the test's time limit.
beforeAll(async () => { await Promise.all([import("../ui/DiffEditor"), import("../ui/CodeEditor"), import("../ui/MarkdownEditor"), loadMarkdownKit()]); }, 30_000);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); localStorage.clear(); });

/** Open the related worktree's review from the header menu, then its README in the editor. */
async function openReadme() {
  await act(async () => document.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click());
  await act(async () => button("Changes and files")!.click());
  await until(() => button("Edit file") !== undefined);
  await act(async () => button("Edit file")!.click());
  await until(() => pressed() !== undefined && document.querySelector(".changes-body .change-message") === null);
}

it("opens a related worktree's review in the view chosen on this device since the menu mounted", async () => {
  markdownView.write("rich");
  await act(async () => root.render(<RelatedWorkspaces api={api} request={request} source={{ id: "chat", cwd: "/code/korri" }} busy={false} links={[]} onAsk={() => undefined} />));
  await until(() => document.querySelector("[aria-haspopup=menu]") !== null);
  // Another view, such as a skill file, switches to Source after this menu mounted.
  markdownView.write("source");
  await openReadme();
  expect(pressed()).toBe("Source");
  expect(document.querySelector(".changes-body .cm-content")).not.toBeNull();

  await act(async () => button("Close changes")!.click());
  markdownView.write("rich");
  await openReadme();
  expect(pressed()).toBe("Rich");
  expect(document.querySelector('.changes-body [role="textbox"] h1')?.textContent).toBe("Plugins");
});

it("retains its context on reveal and excludes hidden body-level review portals", async () => {
  const context = vi.fn(async () => related);
  const bound = { ...api, context };
  const render = (visible: boolean, id = "chat", busy = false) => root.render(<RelatedWorkspaces api={bound} request={request} source={{ id, cwd: "/code/korri" }} busy={busy} visible={visible} links={[]} onAsk={() => undefined} />);
  await act(async () => render(true));
  await until(() => context.mock.calls.length === 1);
  await openReadme();
  expect(document.querySelector("dialog.changes-dialog")).not.toBeNull();
  await act(async () => render(false));
  expect(document.querySelector("dialog.changes-dialog")).toBeNull();
  expect(context).toHaveBeenCalledTimes(1);
  await act(async () => render(true));
  expect(context).toHaveBeenCalledTimes(1);
  await until(() => document.querySelector("dialog.changes-dialog") !== null);
  await act(async () => render(true, "other"));
  expect(context).toHaveBeenCalledTimes(2);
  await act(async () => render(true, "other", true));
  await act(async () => render(true, "other", false));
  expect(context).toHaveBeenCalledTimes(3);
});
