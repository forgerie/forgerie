import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  expect(await restarted.launchContent(reservation.claimId)).toEqual(content);
  expect(JSON.stringify(await restarted.list())).not.toContain("aGVsbG8=");
  await restarted.releaseSessions(["image-session"]);
  expect(await restarted.launchContent(reservation.claimId)).toBeUndefined();
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, claims: [] });
});

const launchContent = { initialPrompt: "Inspect the image", images: [{ kind: "image" as const, mimeType: "image/png" as const, data: "aGVsbG8=", name: "image.png" }] };
it("stores snapshots separately with private permissions and reads only the requested snapshot", async () => {
  const file = await path(); const store = new BacklogClaimStore(file); await store.initialize();
  const snapshots = join(file, "..", "backlog-launch");
  const first = await store.reserve(input); await store.bind(first.claimId, "first", "/repo", undefined, launchContent);
  const second = await store.reserve({ ...input, itemId: "second" }); await store.bind(second.claimId, "second", "/repo", undefined, launchContent);
  expect((await stat(snapshots)).mode & 0o777).toBe(0o700);
  expect((await stat(join(snapshots, `${first.claimId}.json`))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(snapshots, `${first.claimId}.json`), "utf8"))).toEqual(launchContent);
  const metadata = await readFile(file, "utf8"); expect(metadata).not.toContain("launchContents"); expect(metadata).not.toContain("aGVsbG8=");
  await writeFile(join(snapshots, `${second.claimId}.json`), "corrupt second snapshot");
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect(await restarted.launchContent(first.claimId)).toEqual(launchContent);
  await expect(restarted.launchContent(second.claimId)).rejects.toThrow("Invalid backlog launch snapshot");
  await store.release(key, first.claimId); expect(await readdir(snapshots)).toEqual([`${second.claimId}.json`]);
  await store.releaseSessions(["second"]); expect(await readdir(snapshots)).toEqual([]);
});

it("removes orphan snapshots and leftover temporary files at startup, even without claim metadata", async () => {
  const file = await path(); const snapshots = join(file, "..", "backlog-launch"); await mkdir(snapshots);
  await writeFile(join(snapshots, "orphan.json"), JSON.stringify(launchContent));
  await writeFile(join(snapshots, "orphan.random.tmp"), "partial snapshot");
  const store = new BacklogClaimStore(file); await store.initialize();
  expect(await readdir(snapshots)).toEqual([]);
  const held = await store.reserve(input); await store.bind(held.claimId, "held", "/repo", undefined, launchContent);
  await writeFile(join(snapshots, "removed.json"), JSON.stringify(launchContent));
  await writeFile(join(snapshots, `${held.claimId}.random.tmp`), "partial replacement");
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect(await readdir(snapshots)).toEqual([`${held.claimId}.json`]);
  expect(await restarted.launchContent(held.claimId)).toEqual(launchContent);
});

it("migrates inline snapshots before removing them from claim metadata and preserves retry contents", async () => {
  const file = await path(); const store = new BacklogClaimStore(file); await store.initialize();
  const reservation = await store.reserve(input); const claim = await store.bind(reservation.claimId, "legacy", "/repo");
  await writeFile(file, JSON.stringify({ version: 1, claims: [claim], launchContents: { [claim.claimId]: launchContent, orphan: launchContent } }));
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect(await restarted.get(key)).toEqual(claim); expect(await restarted.launchContent(claim.claimId)).toEqual(launchContent);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, claims: [claim] });
  expect(await readdir(join(file, "..", "backlog-launch"))).toEqual([`${claim.claimId}.json`]);
});

it("keeps metadata small and does not rewrite existing snapshots during other claim mutations", async () => {
  const file = await path(); const store = new BacklogClaimStore(file); await store.initialize();
  const payload = { ...launchContent, images: launchContent.images.map((image) => ({ ...image, data: "a".repeat(1024 * 1024) })) };
  const first = await store.reserve(input); await store.bind(first.claimId, "first", "/repo", undefined, payload);
  const snapshot = join(file, "..", "backlog-launch", `${first.claimId}.json`);
  const original = await stat(snapshot);
  for (let i = 1; i < 5; i++) {
    const next = await store.reserve({ ...input, itemId: `item-${String(i)}` }); await store.bind(next.claimId, `session-${String(i)}`, "/repo", undefined, payload);
  }
  expect((await stat(file)).size).toBeLessThan(8192);
  expect((await stat(snapshot)).mtimeMs).toBe(original.mtimeMs); expect((await stat(snapshot)).ino).toBe(original.ino);
});

it("removes a snapshot written before a failed bind and a snapshot left with an interrupted reservation", async () => {
  const file = await path(); const store = new BacklogClaimStore(file); await store.initialize();
  const reservation = await store.reserve(input);
  await rm(file); await mkdir(file);
  await expect(store.bind(reservation.claimId, "session", "/repo", undefined, launchContent)).rejects.toThrow();
  const snapshots = join(file, "..", "backlog-launch"); expect(await readdir(snapshots)).toEqual([]);
  expect((await store.get(key))?.kind).toBe("launching");
  await rm(file, { recursive: true }); await writeFile(file, JSON.stringify({ version: 1, claims: [reservation] }));
  await writeFile(join(snapshots, `${reservation.claimId}.json`), JSON.stringify(launchContent));
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect((await restarted.get(key))?.kind).toBe("interrupted"); expect(await readdir(snapshots)).toEqual([]);
});

it("keeps inline migration data intact if its private snapshot cannot be saved", async () => {
  const file = await path(); const store = new BacklogClaimStore(file); await store.initialize();
  const reservation = await store.reserve(input); const claim = await store.bind(reservation.claimId, "legacy", "/repo");
  const original = JSON.stringify({ version: 1, claims: [claim], launchContents: { [claim.claimId]: launchContent } });
  await writeFile(file, original); await writeFile(join(file, "..", "backlog-launch"), "not a directory");
  await expect(new BacklogClaimStore(file).initialize()).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe(original);
});

it("serializes one Azure claim across two destination repositories, but keeps Markdown repo identities", async () => {
  const store = new BacklogClaimStore();
  const input = { projectId: "p", repo: "/a", cwd: "/a", provider: "azure-devops", itemId: "org:1", requestId: "request", fingerprint: "hash" };
  const results = await Promise.allSettled([store.reserve(input), store.reserve({ ...input, projectId: "q", repo: "/b", cwd: "/b" })]);
  expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  await store.reserve({ ...input, provider: "markdown" });
  await store.reserve({ ...input, provider: "markdown", repo: "/b" });
  expect(await store.list()).toHaveLength(3);
});
it("keeps legacy duplicate Azure claims releasable by either exact claimId", async () => {
  const root = await mkdtemp(join(tmpdir(), "contested-claims-"));
  try {
    const path = join(root, "claims.json");
    const claim = { kind: "claimed", projectId: "p", provider: "azure-devops", itemId: "org:1", requestId: "r", fingerprint: "hash", cwd: "/a", claimedAt: "today" };
    await writeFile(path, JSON.stringify({ version: 1, claims: [{ ...claim, repo: "/a", claimId: "a", sessionId: "session-a" }, { ...claim, repo: "/b", claimId: "b", sessionId: "session-b" }] }));
    const store = new BacklogClaimStore(path); await store.initialize();
    expect(await store.list()).toHaveLength(2);
    await expect(store.reserve({ projectId: "q", repo: "/c", cwd: "/c", provider: "azure-devops", itemId: "org:1", requestId: "new", fingerprint: "hash" })).rejects.toThrow("claim");
    await store.release({ repo: "/ignored", provider: "azure-devops", itemId: "org:1" }, "b");
    expect((await store.list()).map((held) => held.claimId)).toEqual(["a"]);
    await store.releaseSessions(["session-a"]);
    expect(await store.list()).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});


it("interrupts only the exact launching reservation and retains ownership until guarded release", async () => {
  const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
  const first = await claims.reserve(input);
  const second = await claims.reserve({ ...input, itemId: "second" });
  await claims.bind(second.claimId, "session", "/repo");
  await expect(claims.interrupt("stale")).rejects.toThrow("Launch reservation changed");
  await expect(claims.interrupt(second.claimId)).rejects.toThrow("Launch reservation changed");
  await claims.interrupt(first.claimId);
  expect(await claims.get(key)).toMatchObject({ ...first, kind: "interrupted" });
  expect((await claims.list()).find((claim) => claim.claimId === second.claimId)?.kind).toBe("claimed");
  await expect(claims.reserve(input)).rejects.toThrow("already has a claim");
  const restarted = new BacklogClaimStore(file); await restarted.initialize();
  expect(await restarted.get(key)).toMatchObject({ ...first, kind: "interrupted" });
  await expect(claims.release(key, "stale")).rejects.toThrow("Claim changed");
  await claims.release(key, first.claimId);
  expect((await claims.reserve(input)).kind).toBe("launching");
});
it("fails closed without changing disk or memory when interruption cannot persist", async () => {
  const file = await path(); const claims = new BacklogClaimStore(file); await claims.initialize();
  const reservation = await claims.reserve(input); const before = await readFile(file, "utf8");
  const directory = join(file, ".."); await chmod(directory, 0o500);
  try {
    await expect(claims.interrupt(reservation.claimId)).rejects.toThrow();
    expect(await claims.get(key)).toEqual(reservation);
    expect(await readFile(file, "utf8")).toBe(before);
    await expect(claims.release(key, reservation.claimId)).rejects.toThrow("Wait for the launch");
  } finally { await chmod(directory, 0o700); }
  await claims.interrupt(reservation.claimId);
  expect(await claims.get(key)).toMatchObject({ kind: "interrupted" });
});
