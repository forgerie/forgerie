import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, resolveSessionFileFromList, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";
import { SessionUnreadStore } from "./sessionUnreadStore.js";

const childCwd = resolve("/workspace-feature");
const timestamp = "2026-01-01T00:00:00.000Z";

const cases = [
  { name: "reciprocal persisted links", kind: "verified", tracked: true },
  { name: "a copied child whose parent names the original file", kind: "copied", tracked: false },
  { name: "a child whose header no longer records its parent", kind: "detached", tracked: false },
  { name: "a parent whose header has a different session id", kind: "wrong-parent", tracked: false },
  { name: "a child without a historical marker", kind: "no-marker", tracked: false },
  { name: "a parent without a reciprocal child link", kind: "no-link", tracked: false },
  { name: "an unreadable parent transcript", kind: "unreadable", tracked: false },
] as const;

describe("historical tracked children", () => {
  it.each(cases)("recovers $name without starting a parent or sending completion notices", async ({ kind, tracked }) => {
    const dir = await mkdtemp(join(tmpdir(), "forgerie-historical-child-"));
    const parentFile = join(dir, "parent.jsonl");
    const childFile = join(dir, "child.jsonl");
    const originalFile = join(dir, "original-child.jsonl");
    const parentHeader = { type: "session", version: 3, id: kind === "wrong-parent" ? "other-parent" : "parent-1", cwd: dir, timestamp };
    const childHeader = { type: "session", version: 3, id: "child-1", cwd: childCwd, timestamp, ...(kind === "detached" ? {} : { parentSession: parentFile }) };
    const parentLink = { type: "custom", id: "parent-link", parentId: null, timestamp, customType: "pi-web.subsession.link", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1", spawnedSessionFile: kind === "copied" ? originalFile : childFile, cwd: childCwd } };
    const childMarker = { type: "custom", id: "child-marker", parentId: null, timestamp, customType: "pi-web.subsession.spawned", data: { version: 1, spawnedBySessionId: "parent-1", spawnedSessionId: "child-1" } };
    let service: PiSessionService | undefined;
    try {
      await writeFile(parentFile, [parentHeader, ...(kind === "no-link" ? [] : [parentLink])].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      await writeFile(childFile, [childHeader, ...(kind === "no-marker" ? [] : [childMarker])].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      if (kind === "copied") await writeFile(originalFile, JSON.stringify(childHeader) + "\n");
      const childManager = SessionManager.open(childFile);
      const child = fakeRuntime("child-1", { sessionFile: childFile, sessionManager: childManager });
      const unreadStore = new SessionUnreadStore({ createCatalogId: () => "historical-children" });
      unreadStore.observeActivityState("child-1", childCwd, true);
      unreadStore.observeActivityState("child-1", childCwd, false);
      await unreadStore.flush();
      const records = [{ ...sessionRecord("child-1", childCwd), path: childFile, ...(kind === "detached" ? {} : { parentSessionPath: parentFile }) }];
      const delegationCapabilities: boolean[] = [];
      service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir: join(dir, "agent"),
        modelRuntime: testModelRuntime,
        createAgentRuntime: (_factory, options) => {
          delegationCapabilities.push(options.delegationToolsEnabled);
          return Promise.resolve(child.runtime);
        },
        sessionManager: {
          create: () => childManager,
          list: () => Promise.resolve(records),
          listAll: () => Promise.resolve(records),
          listParentSessionPaths: () => Promise.resolve([]),
          invalidateSessionFile: () => undefined,
          resolveSessionFile: resolveSessionFileFromList(() => Promise.resolve(records)),
          open: (file) => {
            if (kind === "unreadable" && file === parentFile) throw new Error("Parent transcript unavailable");
            return SessionManager.open(file);
          },
        },
        archiveStore: emptyArchiveStore(),
        heartbeatIntervalMs: 60_000,
        unreadStore,
      });
      await service.status(sessionRef("child-1", childCwd));
      const restored = await service.unreadCatalog();
      expect(restored.sessions.map((session) => session.sessionId)).toEqual(tracked ? [] : ["child-1"]);
      child.session.isStreaming = true;
      child.emit({ type: "agent_start" });
      child.session.isStreaming = false;
      child.emit({ type: "agent_end" });
      const completed = await service.unreadCatalog();
      expect(completed.sessions.map((session) => session.sessionId)).toEqual(tracked ? [] : ["child-1"]);
      expect(delegationCapabilities).toEqual([!tracked]);
      expect(child.calls.prompt).toEqual([]);
      expect(child.calls.sendCustomMessage).toEqual([]);
      expect((await service.list(childCwd))[0]?.parentSessionPath).toBe(kind === "detached" ? undefined : parentFile);
    } finally {
      await service?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
