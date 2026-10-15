import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Project, Workspace } from "../types.js";
import { appTestContext as ctx, registerAppTestHooks } from "../app.testSupport.js";

registerAppTestHooks();

it.each(["allowed-root", "workspace"])("keeps saved credentials readable through ordinary %s file access without sessiond", async scope => {
  const profile = join(scope === "workspace" ? ctx.projectDir : ctx.tempDir, "profile");
  await mkdir(profile, { recursive: true });
  const names = ["decision-gateway.json", "auth.json", "cliproxyapi.json"];
  for (const name of names) await writeFile(join(profile, name), JSON.stringify({ apiKey: `fictional-${name}` }));
  const project = (await ctx.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Credential exposure", path: ctx.projectDir, create: true } })).json<Project>();
  const [workspace] = (await ctx.app.inject(`/api/projects/${project.id}/workspaces`)).json<Workspace[]>();
  if (workspace === undefined) throw new Error("No workspace");
  if (scope === "allowed-root") ctx.piWebConfig = { pathAccess: { allowedPaths: [ctx.tempDir] } };
  ctx.agentProfileResult = { status: "unavailable", error: "Session daemon is down" };
  const requests = ctx.sessionDaemonRequests.length;
  for (const prefix of ["/api", "/api/machines/local"]) for (const name of names) {
    const path = scope === "workspace" ? `profile/${name}` : join(profile, name);
    const response = await ctx.app.inject(`${prefix}/projects/${project.id}/workspaces/${workspace.id}/file?path=${encodeURIComponent(path)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ content: string }>().content).toBe(JSON.stringify({ apiKey: `fictional-${name}` }));
  }
  expect(ctx.sessionDaemonRequests.length).toBe(requests);
});
