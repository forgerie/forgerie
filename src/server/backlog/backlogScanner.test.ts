import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { BacklogClaim, Project } from "../../shared/apiTypes.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import type { BacklogProvider } from "./backlogProvider.js";
import { canonicalBacklogRoot, scanProjectBacklog } from "./backlogScanner.js";
import { markdownBacklogProvider } from "./markdownBacklog.js";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(): Promise<Project> {
  const path = await mkdtemp(join(tmpdir(), "forgerie-backlog-scan-")); directories.push(path);
  await git(path, "init", "-b", "main");
  return { id: "p1", name: "Project one", path, createdAt: "2026-09-01" };
}
async function git(path: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", path, ...args], { env: sanitizedGitEnv() })).stdout;
}
async function file(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, content);
}
function item(id: string, extra = "", body = "\n# Work\n"): string { return `---\nid: ${id}\ntitle: Item ${id}\n${extra}---\n${body}`; }

describe("project backlog scanner", () => {
  it("reads one configured directory and derives same-project dependency and claim states without writes", async () => {
    const project = await fixture();
    await file(join(project.path, ".forgerie/config.json"), JSON.stringify({ backlog: { dir: "work/items/" } }));
    await file(join(project.path, "work/items/parking-lot/a.md"), item("a", "blocked_by: [b, done, missing]\n"));
    await file(join(project.path, "work/items/active/b.md"), item("b"));
    await file(join(project.path, "work/items/done.md"), item("done", "status: Done\n"));
    await file(join(project.path, ".forgerie/backlog/not-selected.md"), item("ignored"));
    const claim: BacklogClaim = { kind: "claimed", projectId: "p1", provider: "markdown", itemId: "b", claimId: "claim", requestId: "request", fingerprint: "hash", repo: project.path, sessionId: "session", cwd: project.path, claimedAt: "2026-09-01" };
    const before = await git(project.path, "status", "--porcelain", "--untracked-files=all");
    const result = await scanProjectBacklog(project, [claim]);
    expect(result.warnings).toEqual([]);
    expect(result.entries.map(({ item: entry }) => [entry.id, entry.readiness, entry.blockingIds]).sort()).toEqual([["a", "blocked", ["b"]], ["b", "claimed", []], ["done", "closed", []]]);
    expect(result.entries.find(({ item: entry }) => entry.id === "b")?.item.claim).toEqual(claim);
    expect(await git(project.path, "status", "--porcelain", "--untracked-files=all")).toBe(before);
  });
  it("uses the default directory and warns when ignored but still reads it", async () => {
    const project = await fixture();
    await file(join(project.path, ".gitignore"), ".forgerie/\n");
    await file(join(project.path, ".forgerie/backlog/a.md"), item("a"));
    const result = await scanProjectBacklog(project, []);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ kind: "ignored-directory" });
    expect(result.warnings[0]?.message).toContain("!.forgerie/backlog/");
  });
  it("reads canonical config and items when a registered project is a linked worktree", async () => {
    const project = await fixture();
    await file(join(project.path, "README.md"), "root");
    await git(project.path, "add", "README.md");
    await git(project.path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init");
    const linked = join(project.path, "linked"); await git(project.path, "worktree", "add", "-b", "feature", linked);
    await file(join(project.path, ".forgerie/config.json"), JSON.stringify({ backlog: { dir: "work/items" } }));
    await file(join(project.path, "work/items/main.md"), item("main-item"));
    await file(join(linked, ".forgerie/backlog/branch-only.md"), item("branch-only"));
    expect(await canonicalBacklogRoot(linked)).toBe(project.path);
    const result = await scanProjectBacklog({ ...project, path: linked }, []);
    expect(result.entries.map((entry) => entry.item.id)).toEqual(["main-item"]);
  });
  it("excludes duplicate ids and malformed items instead of choosing an arbitrary copy", async () => {
    const project = await fixture();
    await file(join(project.path, ".forgerie/backlog/a.md"), item("same"));
    await file(join(project.path, ".forgerie/backlog/b.md"), item("same"));
    await file(join(project.path, ".forgerie/backlog/invalid.md"), "not an item");
    const result = await scanProjectBacklog(project, []);
    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(3);
  });
  it("does not follow symbolic links or permit directory escapes", async () => {
    const project = await fixture();
    const external = join(project.path, "external.md"); await file(external, item("external"));
    await mkdir(join(project.path, ".forgerie/backlog"), { recursive: true });
    await symlink(external, join(project.path, ".forgerie/backlog/linked.md"));
    expect((await scanProjectBacklog(project, [])).warnings[0]?.kind).toBe("invalid-item");
    await file(join(project.path, ".forgerie/config.json"), JSON.stringify({ backlog: { dir: "../outside" } }));
    expect((await scanProjectBacklog(project, [])).warnings[0]?.kind).toBe("project-error");
    expect(await readFile(external, "utf8")).toBe(item("external"));
  });
  it("keeps the same id from two providers as two items and overlays a claim only on its own provider", async () => {
    const project = await fixture();
    await file(join(project.path, ".forgerie/backlog/b.md"), item("b"));
    const other = "github";
    const second: BacklogProvider = {
      id: other, prompt: () => "",
      scan: (scanned, repo) => Promise.resolve({ warnings: [], entries: [{ body: "", item: { id: "b", title: "Remote b", provider: other, projectId: scanned.id,
        projectName: scanned.name, repo, path: "#b", status: "open", labels: [], blocked_by: [], open: true, readiness: "ready", blockingIds: [] } }] }),
    };
    const claim: BacklogClaim = { kind: "claimed", projectId: "p1", provider: "markdown", itemId: "b", claimId: "claim", requestId: "request", fingerprint: "hash", repo: project.path, sessionId: "session", cwd: project.path, claimedAt: "2026-09-01" };
    const result = await scanProjectBacklog(project, [claim], [markdownBacklogProvider, second]);
    expect(result.entries.map(({ item: entry }) => [entry.provider, entry.id, entry.readiness])).toEqual([["markdown", "b", "claimed"], [other, "b", "ready"]]);
  });
  it("reports a failing provider without hiding another provider's items", async () => {
    const project = await fixture();
    await file(join(project.path, ".forgerie/backlog/a.md"), item("a"));
    const failing: BacklogProvider = { id: "markdown", prompt: () => "", scan: () => Promise.reject(new Error("Remote unavailable")) };
    const result = await scanProjectBacklog(project, [], [failing, markdownBacklogProvider]);
    expect(result.entries.map(({ item: entry }) => entry.id)).toEqual(["a"]);
    expect(result.warnings).toMatchObject([{ kind: "project-error", message: "Remote unavailable" }]);
  });
  it("returns an empty result for a missing default directory", async () => {
    expect(await scanProjectBacklog(await fixture(), [])).toEqual({ entries: [], warnings: [] });
  });
  it("rejects an oversized item", async () => {
    const project = await fixture();
    await file(join(project.path, ".forgerie/backlog/large.md"), item("large", "", "x".repeat(300_000)));
    const result = await scanProjectBacklog(project, []);
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]?.message).toContain("256 KiB");
  });
});
