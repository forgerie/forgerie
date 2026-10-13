import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BacklogClaimStore } from "./backlogClaimStore.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = { projectId: "project", provider: "markdown" as const, itemId: "item", repo: "/repo", cwd: "/repo", requestId: "request", fingerprint: "hash" };
const key = { repo: "/repo", provider: "markdown" as const, itemId: "item" };
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
    expect(await reloaded.get(key)).toEqual(bound);
    await expect(reloaded.release(key, "stale")).rejects.toThrow("Claim changed");
    await reloaded.releaseSessions(["unrelated"]); expect(await reloaded.list()).toHaveLength(1);
    await reloaded.releaseSessions(["session"]); expect(await reloaded.list()).toEqual([]);
    await reloaded.release(key, bound.claimId);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, claims: [] });
  });
  it("retains an interrupted reservation after restart without a lease or silent retry", async () => {
    const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
    const reservation = await claims.reserve(input);
    await expect(claims.release(key, reservation.claimId)).rejects.toThrow("Wait for the launch");
    const restarted = new BacklogClaimStore(file); await restarted.initialize();
    expect(await restarted.get(key)).toMatchObject({ kind: "interrupted", claimId: reservation.claimId });
    await expect(restarted.reserve(input)).rejects.toThrow("already has a claim");
    await restarted.release(key, reservation.claimId);
    expect(await restarted.list()).toEqual([]);
  });
  it("loads claims written before providers existed as markdown claims", async () => {
    const file = await path();
    const legacy = { projectId: "project", itemId: "item", repo: "/repo", cwd: "/repo", requestId: "request", fingerprint: "hash", kind: "claimed", claimId: "legacy", claimedAt: "2026-10-06", sessionId: "session" };
    await writeFile(file, JSON.stringify({ version: 1, claims: [legacy] }));
    const claims = new BacklogClaimStore(file); await claims.initialize();
    expect(await claims.get(key)).toMatchObject({ claimId: "legacy", provider: "markdown" });
    await expect(claims.reserve(input)).rejects.toThrow("already has a claim");
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

it("keeps private launch images across restart, never includes them in claims, and removes them with ownership", async () => {
  const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
  const reservation = await claims.reserve({ ...input, provider: "azure-devops" });
  const content = { initialPrompt: "Examine every image", images: [{ kind: "image" as const, mimeType: "image/png" as const, data: "aGVsbG8=", name: "image.png" }] };
  await claims.bind(reservation.claimId, "image-session", "/repo", undefined, content);
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect(restarted.launchContent(reservation.claimId)).toEqual(content);
  expect(JSON.stringify(await restarted.list())).not.toContain("aGVsbG8=");
  await restarted.releaseSessions(["image-session"]);
  expect(restarted.launchContent(reservation.claimId)).toBeUndefined();
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, claims: [] });
});
