import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { BrowserFileAccess, openBrowserFile } from "./browserFileAccess.js";

it("protects real-path and inode aliases, temporary key writes, and only this profile credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-file-access-"));
  try {
    const profile = join(root, "profile"); await mkdir(profile);
    const path = join(profile, "decision-gateway.json"); await writeFile(path, "private");
    const access = new BrowserFileAccess(profile);
    await symlink(path, join(root, "symlink.md")); await link(path, join(root, "CASE-ALIAS.HTML"));
    const temporary = `${path}.example.tmp`; await writeFile(temporary, "replacement"); await link(temporary, join(root, "temporary-alias"));
    for (const candidate of [path, `${profile}/../profile/decision-gateway.json`, join(root, "symlink.md"), join(root, "CASE-ALIAS.HTML"), temporary, join(root, "temporary-alias")]) {
      expect(await access.isReadable(candidate)).toBe(false);
      await expect(openBrowserFile(candidate, access)).rejects.toThrow("Path is outside allowed paths");
    }
    // This fix is identity-scoped, not a ban on names or other credential files.
    for (const name of ["decision-gateway.json", "auth.json", "cliproxyapi.json"]) {
      const ordinary = join(root, name); await writeFile(ordinary, "public fixture");
      expect(await access.isReadable(ordinary)).toBe(true);
    }
    await rm(path); await writeFile(path, "new inode"); await link(path, join(root, "new-alias"));
    expect(await access.isReadable(join(root, "new-alias"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("filters private aliases before Git produces committed, staged and unstaged review patches", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readWorktreeReview } = await import("./workspaces/worktreeReview.js");
  const root = await mkdtemp(join(tmpdir(), "gateway-review-access-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-qb", "main"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
    await writeFile(join(root, "ordinary.txt"), "public"); git("add", "ordinary.txt"); git("commit", "-qm", "Initial");
    const base = git("rev-parse", "HEAD").trim();
    const profile = join(root, "profile"); await mkdir(profile);
    const key = join(profile, "decision-gateway.json"); await writeFile(key, '{"apiKey":"DISTINCTIVE-private-review-key"}');
    await link(key, join(root, "alias.txt")); git("add", "alias.txt"); git("commit", "-qm", "Private fixture");
    await writeFile(key, '{"apiKey":"DISTINCTIVE-private-review-replacement"}'); git("add", "alias.txt");
    await symlink(key, join(root, "untracked-alias.md"));
    const review = await readWorktreeReview(root, base, new BrowserFileAccess(profile));
    expect(JSON.stringify(review)).not.toMatch(/DISTINCTIVE|alias\.txt|untracked-alias|decision-gateway/);
    expect(review.sections.every(section => section.diff === "")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
