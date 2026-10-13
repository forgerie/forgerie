import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AzureDevopsCredentials } from "./azureDevopsCredentials.js";
import { azureDevopsRequest } from "./azureDevopsRequest.js";
import { AzureDevopsClient } from "./azureDevopsClient.js";
import { AzurePullReader } from "./azurePullReader.js";
import { azurePr, azureRepo } from "./azurePull.testSupport.js";
import { azureConfig } from "./azureDevops.testSupport.js";

const TIME = Date.parse("2026-10-07T12:00:00Z");
const token = (number: number) => `testOnlyCliAccessToken1234567890${String(number)}`;
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "azure-auth-request-")); directories.push(directory);
  let calls = 0;
  const credentials = new AzureDevopsCredentials({ directory, now: () => TIME, runner: () => { calls++; return Promise.resolve(JSON.stringify({ accessToken: token(calls), expires_on: (TIME + 3600_000) / 1000 })); } });
  return { directory, credentials, calls: () => calls };
}

describe("authenticated Azure reads", () => {
  it("runs az again for a 401 while the original refresh is still cleaning up", async () => {
    const directory = await mkdtemp(join(tmpdir(), "azure-refresh-cleanup-")); directories.push(directory);
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const running = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const credentials = new AzureDevopsCredentials({ directory, now: () => TIME, runner: async (_command, _args, options) => {
      const number = ++calls;
      if (number === 1) {
        // Simulate extension files so the real recursive cleanup crosses several I/O turns.
        const extensionDir = options.env["AZURE_EXTENSION_DIR"] ?? "";
        await Promise.all(Array.from({ length: 32 }, (_, index) => writeFile(join(extensionDir, `extension-${String(index)}`), "placeholder")));
        started(); await hold;
      }
      return JSON.stringify({ accessToken: token(number), expires_on: (TIME + 3600_000) / 1000 });
    } });
    const priming = credentials.read("amazeinsights");
    const headers: string[] = [];
    await running;
    try {
      const request = azureDevopsRequest(credentials, "amazeinsights", "https://dev.azure.com/", { method: "GET" }, (_url, init) => {
        const header = new Headers(init.headers).get("Authorization") ?? ""; headers.push(header);
        return Promise.resolve(new Response("", { status: header === `Bearer ${token(1)}` ? 401 : 200 }));
      });
      release();
      const result = await request; await priming;
      expect(result.ok && result.response.status).toBe(200);
      expect(headers).toEqual([`Bearer ${token(1)}`, `Bearer ${token(2)}`]);
      expect(calls).toBe(2);
    } finally { release(); await priming; }
  });
  it("does not reuse a refresh invalidated while its cleanup is held", async () => {
    const directory = await mkdtemp(join(tmpdir(), "azure-invalidated-cleanup-")); directories.push(directory);
    let release: () => void = () => undefined;
    let cleaning: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const cleanupStarted = new Promise<void>((resolve) => { cleaning = resolve; });
    let calls = 0; let cleanups = 0;
    const credentials = new AzureDevopsCredentials({ directory, now: () => TIME,
      runner: () => { calls++; return Promise.resolve(JSON.stringify({ accessToken: token(calls), expires_on: (TIME + 3600_000) / 1000 })); },
      removeExtensionDirectory: async (path) => {
        if (++cleanups === 1) { cleaning(); await hold; }
        await rm(path, { recursive: true, force: true });
      },
    });
    const priming = credentials.read("amazeinsights");
    await cleanupStarted;
    try {
      credentials.invalidate(`Bearer ${token(1)}`);
      const headers: string[] = [];
      const result = await azureDevopsRequest(credentials, "amazeinsights", "https://dev.azure.com/", { method: "GET" }, (_url, init) => {
        const header = new Headers(init.headers).get("Authorization") ?? ""; headers.push(header);
        return Promise.resolve(new Response("", { status: header === `Bearer ${token(2)}` ? 200 : 401 }));
      });
      expect(result.ok && result.response.status).toBe(200);
      expect(headers).toEqual([`Bearer ${token(2)}`]); expect(calls).toBe(2);
      release();
      expect(await priming).toEqual({ ok: true, authorization: `Bearer ${token(2)}` });
      expect(await credentials.read("amazeinsights")).toEqual({ ok: true, authorization: `Bearer ${token(2)}` });
      expect(calls).toBe(2);
    } finally { release(); await priming; }
  });
  it.each(["backlog", "pull-request"] as const)("shares CLI authorization and refreshes once after a %s 401", async (first) => {
    const f = await fixture(); const authorizations: string[] = [];
    const fetcher = (url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("Authorization") ?? ""; authorizations.push(auth);
      expect(init.redirect).toBe("error");
      if (auth === `Bearer ${token(1)}`) return Promise.resolve(new Response(token(1), { status: 401 }));
      const path = new URL(url).pathname;
      return Promise.resolve(Response.json(path.endsWith("/wiql") ? { workItems: [] }
        : /\/(evaluations|statuses|threads)$/u.test(path) ? { value: [] } : azurePr()));
    };
    const backlog = new AzureDevopsClient({ credentials: f.credentials, fetch: fetcher });
    const prs = new AzurePullReader({ credentials: f.credentials, fetch: fetcher, resolveRepo: () => Promise.resolve(azureRepo) });
    const readBacklog = async () => { expect(await backlog.assignedItems(azureConfig)).toEqual({ ok: true, items: [], truncated: false }); };
    const readPr = async () => { expect((await prs.pull("/workspace", 9)).pull.complete).toBe(true); };
    if (first === "backlog") { await readBacklog(); await readPr(); } else { await readPr(); await readBacklog(); }
    expect(f.calls()).toBe(2);
    expect(authorizations).toEqual([`Bearer ${token(1)}`, ...Array.from({ length: 5 }, () => `Bearer ${token(2)}`)]);
  });
  it("single-flights refreshes when two HTTP reads reject the same cached token", async () => {
    const f = await fixture(); await f.credentials.read("amazeinsights");
    const fetcher = (_url: string, init: RequestInit) => Promise.resolve(new Response("", { status: new Headers(init.headers).get("Authorization") === `Bearer ${token(1)}` ? 401 : 200 }));
    const results = await Promise.all(["amazeinsights", "another-org"].map((org) => azureDevopsRequest(f.credentials, org, "https://dev.azure.com/", { method: "GET" }, fetcher)));
    expect(results.every((r) => r.ok && r.response.status === 200)).toBe(true); expect(f.calls()).toBe(2);
  });
  it("stops after the second 401 and exposes only an auth error with the fix-it message", async () => {
    const f = await fixture(); let requests = 0;
    const backlog = new AzureDevopsClient({ credentials: f.credentials, fetch: () => { requests++; return Promise.resolve(new Response(token(1), { status: 401 })); } });
    const result = await backlog.assignedItems(azureConfig);
    expect(result).toMatchObject({ ok: false, kind: "auth" });
    expect(JSON.stringify(result)).toContain("Run `az login` as the Forgerie user, or put a PAT in");
    expect(JSON.stringify(result)).not.toContain(token(1)); expect(JSON.stringify(result)).not.toContain(token(2));
    expect(requests).toBe(2); expect(f.calls()).toBe(2);
  });
  it("keeps a rejected PAT authoritative, with no CLI fallback", async () => {
    const f = await fixture(); const pat = "testOnlyPatToken1234567890";
    await writeFile(join(f.directory, "amazeinsights.pat"), pat, { mode: 0o600 });
    let requests = 0;
    const result = await azureDevopsRequest(f.credentials, "amazeinsights", "https://dev.azure.com/", { method: "GET" }, (_url, init) => {
      requests++; expect(new Headers(init.headers).get("Authorization")).toBe(`Basic ${Buffer.from(`:${pat}`).toString("base64")}`);
      return Promise.resolve(new Response(pat, { status: 401 }));
    });
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(pat);
    expect(requests).toBe(2); expect(f.calls()).toBe(0);
  });
  it("does not make an Azure request when CLI credentials fail", async () => {
    const f = await fixture();
    const credentials = new AzureDevopsCredentials({ directory: f.directory, runner: () => Promise.reject(new Error(token(1))) });
    let requests = 0;
    const backlog = new AzureDevopsClient({ credentials, fetch: () => { requests++; throw new Error("Unexpected fetch"); } });
    expect(await backlog.assignedItems(azureConfig)).toMatchObject({ ok: false, kind: "auth" }); expect(requests).toBe(0);
    const prs = new AzurePullReader({ credentials, fetch: () => { requests++; throw new Error("Unexpected fetch"); }, resolveRepo: () => Promise.resolve(azureRepo) });
    await expect(prs.pull("/workspace", 9)).rejects.toMatchObject({ kind: "auth" }); expect(requests).toBe(0);
  });
});
