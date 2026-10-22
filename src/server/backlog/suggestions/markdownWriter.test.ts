import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { writeMarkdownSuggestion } from "./markdownWriter.js";
import { parseBacklogItem } from "../backlogItem.js";
import { git, repository, suggestion } from "./suggestionTestSupport.js";

async function expectNoScratch(root: string) {
  expect((await git(root, "worktree", "list", "--porcelain")).split("worktree ").length).toBe(2);
  expect(await git(root, "branch", "--list", "forgerie-backlog-scratch/*")).toBe("");
  expect(await readdir(join(root, ".worktrees/forgerie-backlog-scratch")).catch(() => [])).toEqual([]);
}
describe("Markdown suggestion filing", () => {
  it("commits with the user's identity, fast-forwards main and leaves no uncommitted item or scratch branch", async () => {
    const repo = await repository(); const record = suggestion();
    try {
      const before = await git(repo.root, "rev-parse", "HEAD");
      expect(await writeMarkdownSuggestion(repo.worktrees, repo.project, record)).toMatchObject({ kind: "filed", provider: "markdown" });
      const file = record.destination.provider === "markdown" ? record.destination.path : "";
      const item = parseBacklogItem(await readFile(join(repo.root, file), "utf8"));
      expect(item.metadata).toMatchObject({ id: "2026-10-20-improve-launch-recovery", title: record.title, status: "To Do", created: "2026-10-20", source: "forgerie-suggestion chat/suggestion" });
      expect(item.body).toContain("## Context"); expect(item.body).toContain("src/launch.ts"); expect(item.body).toContain("Use durable receipts"); expect(item.body).toContain("Suggested in Main work (chat), 2026-10-20");
      expect(await git(repo.root, "rev-parse", "HEAD^")).toBe(before);
      expect(await git(repo.root, "log", "-1", "--format=%an <%ae>%n%s")).toBe("Backlog User <backlog@example.test>\nchore(backlog): add Improve launch recovery");
      expect(await git(repo.root, "status", "--porcelain", "--", file)).toBe(""); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
  it("refuses main on another branch, or a dirty new item path, without changing either", async () => {
    const repo = await repository(); const record = suggestion(); const file = record.destination.provider === "markdown" ? record.destination.path : "";
    try {
      await git(repo.root, "switch", "-c", "other");
      await expect(writeMarkdownSuggestion(repo.worktrees, repo.project, record)).rejects.toThrow("default branch");
      await git(repo.root, "switch", "main"); await mkdir(dirname(join(repo.root, file)), { recursive: true }); await writeFile(join(repo.root, file), "user draft");
      await expect(writeMarkdownSuggestion(repo.worktrees, repo.project, record)).rejects.toThrow("overlapping dirty");
      expect(await readFile(join(repo.root, file), "utf8")).toBe("user draft"); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
  it("checks open Markdown titles with the file_issue rule before writing", async () => {
    const repo = await repository();
    try {
      const path = ".forgerie/backlog/existing.md"; await mkdir(dirname(join(repo.root, path)), { recursive: true });
      await writeFile(join(repo.root, path), "---\nid: old\ntitle: 'fix: Improve launch recovery'\nstatus: To Do\n---\nExisting\n");
      await git(repo.root, "add", path); await git(repo.root, "commit", "-m", "existing backlog"); const before = await git(repo.root, "rev-parse", "HEAD");
      expect(await writeMarkdownSuggestion(repo.worktrees, repo.project, suggestion())).toEqual({ kind: "duplicate", matches: [{ path, title: "fix: Improve launch recovery", state: "open" }] });
      expect(await git(repo.root, "rev-parse", "HEAD")).toBe(before); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
  it("checks uncommitted open items in main as well as the default-branch snapshot", async () => {
    const repo = await repository();
    try {
      const path = ".forgerie/backlog/draft.md"; await mkdir(dirname(join(repo.root, path)), { recursive: true });
      const source = "---\nid: draft\ntitle: Improve launch recovery\nstatus: To Do\n---\nUser draft\n";
      await writeFile(join(repo.root, path), source);
      expect(await writeMarkdownSuggestion(repo.worktrees, repo.project, suggestion())).toMatchObject({ kind: "duplicate", matches: [{ path }] });
      expect(await readFile(join(repo.root, path), "utf8")).toBe(source); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
  it("does not overwrite an ignored, untracked closed item in main", async () => {
    const repo = await repository(); const record = suggestion();
    try {
      await writeFile(join(repo.root, ".gitignore"), ".forgerie/\n"); await git(repo.root, "add", ".gitignore"); await git(repo.root, "commit", "-m", "ignore local data");
      if (record.destination.provider !== "markdown") throw new Error("Expected Markdown");
      const path = record.destination.path; await mkdir(dirname(join(repo.root, path)), { recursive: true });
      const closed = "---\nid: local\ntitle: Improve launch recovery\nstatus: Done\n---\nPrivate local draft\n";
      await writeFile(join(repo.root, path), closed);
      await expect(writeMarkdownSuggestion(repo.worktrees, repo.project, record)).rejects.toThrow();
      expect(await readFile(join(repo.root, path), "utf8")).toBe(closed); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
  it("removes scratch files and branch after a commit failure", async () => {
    const repo = await repository();
    try {
      // Missing user identity fails commit-tree after the item blob and private index exist.
      await git(repo.root, "config", "user.name", "");
      await expect(writeMarkdownSuggestion(repo.worktrees, repo.project, suggestion())).rejects.toThrow();
      expect(await readdir(join(repo.root, ".forgerie/backlog")).catch(() => [])).toEqual([]); await expectNoScratch(repo.root);
    } finally { await repo.dispose(); }
  });
});
