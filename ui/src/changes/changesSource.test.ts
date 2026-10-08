import { describe, expect, it } from "vitest";
import { createChangesSource, entriesOf } from "./changesSource";

describe("change entries", () => {
  it("splits a file changed in both the index and the working tree, and puts untracked folders, which have no diff, last", () => {
    expect(entriesOf([
      { path: "src/b.ts", index: "modified", workingTree: "modified" },
      { path: "src/a.ts", index: "unmodified", workingTree: "deleted" },
      { path: "new.md", index: "untracked", workingTree: "untracked" },
      { path: "nested/", index: "untracked", workingTree: "untracked" },
      { path: "skip.log", index: "ignored", workingTree: "ignored" },
    ])).toEqual([
      { key: "unstaged:new.md", path: "new.md", staged: false, state: "untracked", diffable: true },
      { key: "unstaged:src/a.ts", path: "src/a.ts", staged: false, state: "deleted", diffable: true },
      { key: "staged:src/b.ts", path: "src/b.ts", staged: true, state: "modified", diffable: true },
      { key: "unstaged:src/b.ts", path: "src/b.ts", staged: false, state: "modified", diffable: true },
      { key: "unstaged:nested/", path: "nested/", staged: false, state: "untracked", diffable: false },
    ]);
  });
});

describe("changes source", () => {
  function fake() {
    const paths: string[] = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const request = async (path: string) => {
      paths.push(path);
      if (path === "/api/projects") return json([{ id: "p", path: "/repo" }]);
      if (path === "/api/projects/p/workspaces") return json([{ id: "w", projectId: "p", path: "/repo/wt" }]);
      if (path === "/api/projects/p/workspaces/w/git/status") return json({ isGitRepo: true, hash: "h", branch: "main", files: [{ path: "a.ts", index: "unmodified", workingTree: "modified" }], submodules: [] });
      if (path.startsWith("/api/projects/p/workspaces/w/git/diff?")) return json({ path: "a.ts", staged: true, hash: "h", diff: "@@ -1 +1 @@\n-a\n+b\n", truncated: true });
      return json({ error: "Unexpected" }, 404);
    };
    return { paths, request };
  }

  it("resolves the session's workspace once, then reads status and one file's diff", async () => {
    const { paths, request } = fake();
    const source = createChangesSource("/repo/wt/", request);
    const signal = new AbortController().signal;
    const changes = await source.changes(signal);
    expect(changes).toEqual({ isGitRepo: true, branch: "main", entries: [{ key: "unstaged:a.ts", path: "a.ts", staged: false, state: "modified", diffable: true }] });
    const diff = await source.diff({ key: "staged:a.ts", path: "a.ts", staged: true, state: "modified", diffable: true }, signal);
    expect(diff.truncated).toBe(true);
    expect(diff.rows.map((row) => row.kind)).toEqual(["hunk", "remove", "add"]);
    expect(paths).toEqual(["/api/projects", "/api/projects/p/workspaces", "/api/projects/p/workspaces/w/git/status",
      "/api/projects/p/workspaces/w/git/diff?path=a.ts&staged=true&context=full"]);
  });

  it("says plainly when the session's folder is not a registered workspace", async () => {
    const { request } = fake();
    await expect(createChangesSource("/elsewhere", request).changes(new AbortController().signal)).rejects.toThrow(/registered workspace/u);
  });
});
