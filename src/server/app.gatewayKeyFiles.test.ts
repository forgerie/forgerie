import { link, mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { Project, Workspace } from "./types.js";
import { appTestContext as ctx, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();
const secret = "DISTINCTIVE-browser-forbidden-gateway-key";
async function fixture(inside = false) {
  const profile = ctx.agentProfileResult;
  if (profile.status !== "available") throw new Error("No profile");
  if (inside) profile.profile = { ...profile.profile, dir: join(ctx.projectDir, "profile") };
  await mkdir(profile.profile.dir, { recursive: true });
  const key = join(profile.profile.dir, "decision-gateway.json");
  await writeFile(key, JSON.stringify({ apiKey: secret }));
  const project = (await ctx.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Credential boundary", path: ctx.projectDir, create: true } })).json<Project>();
  const workspace = (await ctx.app.inject(`/api/projects/${project.id}/workspaces`)).json<Workspace[]>()[0];
  if (!workspace) throw new Error("No workspace");
  ctx.piWebConfig = { pathAccess: { allowedPaths: [ctx.tempDir] } };
  const base = `/api/projects/${project.id}/workspaces/${workspace.id}`;
  await link(key, join(ctx.projectDir, "HARD-ALIAS.JSON"));
  await symlink(key, join(ctx.projectDir, "linked.svg"));
  await symlink(key, join(ctx.projectDir, "linked.html"));
  await writeFile(join(ctx.projectDir, "ordinary.json"), "public");
  return { base, key, profile: profile.profile };
}
describe("browser file access excludes the active gateway credential", () => {
  it.each([false, true])("denies direct, symlink, hard-link and .. aliases (profile inside workspace: %s)", async inside => {
    const f = await fixture(inside);
    const forbidden = await ctx.app.inject(`${f.base}/file?path=${encodeURIComponent("/")}`);
    for (const path of [f.key, `${f.profile.dir}/../${basename(f.profile.dir)}/decision-gateway.json`, join(ctx.projectDir, "linked.html"), "HARD-ALIAS.JSON"]) {
      const response = await ctx.app.inject(`${f.base}/file?path=${encodeURIComponent(path)}`);
      expect(response.statusCode, path).toBe(forbidden.statusCode);
      expect(response.json(), path).toEqual(forbidden.json());
      expect(response.body).not.toContain(secret);
    }
  });
  it("leaves auth.json and cliproxyapi.json exposure unchanged for the separate follow-up", async () => {
    const f = await fixture();
    for (const name of ["auth.json", "cliproxyapi.json"]) {
      const path = join(f.profile.dir, name); await writeFile(path, JSON.stringify({ apiKey: `fixture-${name}` }));
      const response = await ctx.app.inject(`${f.base}/file?path=${encodeURIComponent(path)}`);
      expect(response.statusCode).toBe(200); expect(response.body).toContain(`fixture-${name}`);
    }
  });
  it("excludes aliases from previews, tree metadata, file search, git status hashes and diffs", async () => {
    const f = await fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: ctx.projectDir, encoding: "utf8" });
    git("init", "-q"); git("add", "HARD-ALIAS.JSON", "ordinary.json");
    for (const url of [`${f.base}/file/preview?path=linked.svg`, `${f.base}/preview/linked.html`, `${f.base}/git/diff?path=HARD-ALIAS.JSON&staged=true`, `${f.base}/git/diff?staged=true`]) {
      const response = await ctx.app.inject(url);
      expect(response.body, url).not.toContain(secret);
      expect(response.body, url).not.toContain("HARD-ALIAS.JSON");
    }
    const tree = await ctx.app.inject(`${f.base}/tree`);
    expect(tree.body).not.toMatch(/HARD-ALIAS|linked\./);
    for (const suffix of ["", "&mode=path", "&scope=all"]) {
      const search = await ctx.app.inject(`${f.base}/files?q=${suffix}`);
      expect(search.body).not.toMatch(/HARD-ALIAS|linked\./);
    }
    const status = await ctx.app.inject(`${f.base}/git/status`);
    expect(status.body).not.toContain("HARD-ALIAS.JSON");
    await writeFile(f.key, JSON.stringify({ apiKey: `${secret}-changed` }));
    expect((await ctx.app.inject(`${f.base}/git/status`)).json()).toEqual(status.json());
    const file = await ctx.app.inject(`${f.base}/file?path=ordinary.json`);
    expect(file.statusCode).toBe(200); expect(file.body).toContain("public");
  });
});
