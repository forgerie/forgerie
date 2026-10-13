import Fastify from "fastify";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { BacklogLaunchResponse, SessionInfo } from "../../shared/apiTypes.js";
import { azureConfig, azureServer } from "../azureDevops/azureDevops.testSupport.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { createAzureDevopsBacklogProvider } from "./azureDevopsBacklog.js";
import { BacklogClaimStore } from "./backlogClaimStore.js";
import { registerBacklogRoutes } from "./backlogRoutes.js";
import { BacklogService } from "./backlogService.js";
import { BacklogSettingsStore } from "./backlogSettingsStore.js";

it.each(["markdown", "azure-devops"] as const)("allows exact release and another %s launch after failed binding, without a daemon restart", async (provider) => {
  const root = await mkdtemp(join(tmpdir(), "backlog-bind-recovery-"));
  const data = join(root, "data"); const repo = join(root, "repo");
  const app = Fastify(); const azure = await azureServer();
  let finishStop: () => void = () => undefined;
  const stopping = new Promise<void>((resolve) => { finishStop = resolve; });
  let enteredStop: () => void = () => undefined;
  const stopEntered = new Promise<void>((resolve) => { enteredStop = resolve; });
  try {
    await mkdir(data); await mkdir(join(repo, ".forgerie/backlog"), { recursive: true });
    await writeFile(join(repo, ".forgerie/backlog/item.md"), "---\nid: item\ntitle: Item\n---\nWork");
    const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
    const project = await projects.add({ path: repo });
    const settings = new BacklogSettingsStore(join(data, "backlog-settings.json"));
    const source = await settings.createSource(azureConfig);
    const claimPath = join(data, "claims.json");
    const claims = new BacklogClaimStore(claimPath); await claims.initialize();
    let started = 0; const stopped: string[] = [];
    const session: SessionInfo = { id: "session", cwd: repo, path: join(root, "session.jsonl"), created: "today", modified: "today", messageCount: 0, firstMessage: "" };
    const service = new BacklogService({ projects, claims, settings, sourceProvider: createAzureDevopsBacklogProvider(azure.client),
      userSessions: { start: async () => {
        started++;
        // The reservation is already durable. Fail the real snapshot/metadata write during bind.
        if (started === 1) await chmod(data, 0o500);
        return session;
      } }, sessions: { stop: async (current) => {
        stopped.push(current.id); enteredStop(); await stopping;
        await chmod(data, 0o700);
      } }, isArchived: () => Promise.resolve(false),
    });
    registerBacklogRoutes(app, service);
    const itemPath = provider === "azure-devops" ? `/backlog/sources/${source.id}/items/amazeinsights%3A7` : `/backlog/${project.id}/items/item`;
    const launch = () => app.inject({ method: "POST", url: `${itemPath}/launch`, payload: { requestId: "confirmed", start: { cwd: repo } } });
    const release = (claimId: string) => app.inject({ method: "POST", url: `${itemPath}/release`, payload: { claimId } });
    const failedLaunch = Promise.resolve(launch());
    try {
      await stopEntered;
      const reservation = (await claims.list())[0];
      if (reservation === undefined) throw new Error("Expected launch reservation");
      expect(reservation.kind).toBe("launching");
      // Stop is still active. Recovery must not permit a concurrent new launch.
      expect((await release(reservation.claimId)).statusCode).toBe(409);
      finishStop();
      expect((await failedLaunch).statusCode).toBe(503);
      expect(stopped).toEqual([session.id]);
      expect((await claims.list())[0]).toMatchObject({ kind: "interrupted", claimId: reservation.claimId });
      expect(JSON.parse(await readFile(claimPath, "utf8"))).toMatchObject({ claims: [{ kind: "interrupted", claimId: reservation.claimId }] });
      expect((await release("stale-claim")).statusCode).toBe(409);
      expect((await release(reservation.claimId)).statusCode).toBe(200);
      expect(await claims.list()).toEqual([]);
      expect(JSON.parse(await readFile(claimPath, "utf8"))).toMatchObject({ claims: [] });
      const retry = await launch();
      expect(retry.statusCode).toBe(200);
      expect(retry.json<BacklogLaunchResponse>().claim).toMatchObject({ kind: "claimed", provider });
      expect(retry.json<BacklogLaunchResponse>().claim.claimId).not.toBe(reservation.claimId);
      expect(started).toBe(2);
    } finally { finishStop(); await failedLaunch; }
  } finally { finishStop(); await chmod(data, 0o700).catch(() => undefined); await app.close(); await azure.close(); await rm(root, { recursive: true, force: true }); }
});
