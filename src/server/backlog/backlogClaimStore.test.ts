import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BacklogClaimStore } from "./backlogClaimStore.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = { projectId: "project", itemId: "item", repo: "/repo", cwd: "/repo", requestId: "request", fingerprint: "hash" };
async function path(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "forgerie-claims-")); directories.push(dir); return join(dir, "claims.json"); }

describe("durable backlog claims", () => {
  it("allows only the first concurrent claimant, including duplicate registrations of a canonical repo", async () => {
    const claims = new BacklogClaimStore(await path()); await claims.initialize();
    const results = await Promise.allSettled([claims.reserve(input), claims.reserve({ ...input, projectId: "alias", requestId: "second" })]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await claims.list()).toHaveLength(1);
  });
  it("persists ownership and releases only the matching claim or session", async () => {
    const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
    const reservation = await claims.reserve(input);
    const bound = await claims.bind(reservation.claimId, "session", "/repo/worktree", "feature");
    const reloaded = new BacklogClaimStore(file); await reloaded.initialize();
    expect(await reloaded.get("/repo", "item")).toEqual(bound);
    await expect(reloaded.release("/repo", "item", "stale")).rejects.toThrow("Claim changed");
    await reloaded.releaseSessions(["unrelated"]); expect(await reloaded.list()).toHaveLength(1);
    await reloaded.releaseSessions(["session"]); expect(await reloaded.list()).toEqual([]);
    await reloaded.release("/repo", "item", bound.claimId);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, claims: [] });
  });
  it("retains an interrupted reservation after restart without a lease or silent retry", async () => {
    const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
    const reservation = await claims.reserve(input);
    await expect(claims.release("/repo", "item", reservation.claimId)).rejects.toThrow("Wait for the launch");
    const restarted = new BacklogClaimStore(file); await restarted.initialize();
    expect(await restarted.get("/repo", "item")).toMatchObject({ kind: "interrupted", claimId: reservation.claimId });
    await expect(restarted.reserve(input)).rejects.toThrow("already has a claim");
    await restarted.release("/repo", "item", reservation.claimId);
    expect(await restarted.list()).toEqual([]);
  });
  it("fails closed on invalid disk state", async () => {
    const file = await path(); await writeFile(file, '{"version":1,"claims":[{}]}');
    await expect(new BacklogClaimStore(file).initialize()).rejects.toThrow("Invalid backlog claim file");
    expect(await readFile(file, "utf8")).toBe('{"version":1,"claims":[{}]}');
  });
  it("keeps its last committed snapshot when disk replacement fails", async () => {
    const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
    await claims.reserve(input);
    await rm(join(file, ".."), { recursive: true });
    await writeFile(join(file, ".."), "not a directory");
    await expect(claims.bind((await claims.list())[0]?.claimId ?? "", "session", "/repo")).rejects.toThrow();
    expect((await claims.list())[0]?.kind).toBe("launching");
  });
});
