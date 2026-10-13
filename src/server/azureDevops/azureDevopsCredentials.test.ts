import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureDevopsCredentials, type AzureCliRunner } from "./azureDevopsCredentials.js";

const TOKEN = "cliOnlyTestAccessToken1234567890";
const PAT = "patOnlyTestReadToken1234567890";
const TIME = Date.parse("2026-10-07T12:00:00Z");
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(run?: AzureCliRunner) {
  const directory = await mkdtemp(join(tmpdir(), "azure-auth-")); directories.push(directory);
  let now = TIME; let calls = 0;
  const runner: AzureCliRunner = async (...args) => { calls++; return run === undefined ? JSON.stringify({ accessToken: TOKEN, expires_on: (now + 3600_000) / 1000 }) : run(...args); };
  const source = new AzureDevopsCredentials({ directory, runner, now: () => now, azureCliCommand: "/pinned/bin/az" });
  return { source, directory, path: join(directory, "amazeinsights.pat"), calls: () => calls, advance: (ms: number) => { now += ms; } };
}

describe("Azure credentials", () => {
  it("prefers a private organization PAT, then uses CLI after removal", async () => {
    const f = await fixture(); await writeFile(f.path, PAT, { mode: 0o600 });
    expect(await f.source.read("AMAZEINSIGHTS")).toEqual({ ok: true, authorization: `Basic ${Buffer.from(`:${PAT}`).toString("base64")}` });
    expect(f.calls()).toBe(0); await rm(f.path);
    expect(await f.source.read("amazeinsights")).toEqual({ ok: true, authorization: `Bearer ${TOKEN}` });
    expect(f.calls()).toBe(1);
    await writeFile(f.path, PAT, { mode: 0o600 });
    expect(await f.source.read("amazeinsights")).toMatchObject({ ok: true, authorization: `Basic ${Buffer.from(`:${PAT}`).toString("base64")}` });
    expect(f.calls()).toBe(1);
  });
  it.each(["public", "malformed", "symlink", "dangling"] as const)("never falls through an existing %s PAT", async (kind) => {
    const f = await fixture();
    if (kind === "symlink" || kind === "dangling") {
      const other = join(f.directory, "other");
      if (kind === "symlink") await writeFile(other, PAT, { mode: 0o600 });
      await symlink(other, f.path);
    } else { await writeFile(f.path, kind === "malformed" ? "bad" : PAT, { mode: 0o600 }); if (kind === "public") await chmod(f.path, 0o644); }
    expect(await f.source.read("amazeinsights")).toMatchObject({ ok: false }); expect(f.calls()).toBe(0);
  });
  it("isolates extensions and uses the configured binary, fixed args and execution bounds", async () => {
    let extensionDir = "";
    const f = await fixture(async (command, args, options) => {
      expect(command).toBe("/pinned/bin/az");
      expect(args).toEqual(["account", "get-access-token", "--resource", "499b84ac-1321-427f-aa17-267ca6975798", "-o", "json"]);
      expect(options.shell).toBe(false); expect(options.timeout).toBe(30_000); expect(options.maxBuffer).toBe(256 * 1024);
      extensionDir = options.env["AZURE_EXTENSION_DIR"] ?? "";
      expect(await readdir(extensionDir)).toEqual([]);
      expect(JSON.stringify(options.env)).not.toContain(TOKEN);
      return JSON.stringify({ accessToken: TOKEN, expires_on: (TIME + 3600_000) / 1000 });
    });
    expect(await f.source.read("amazeinsights")).toMatchObject({ ok: true });
    await expect(readdir(extensionDir)).rejects.toThrow();
  });
  it("caches across organizations until five minutes before expiry and invalidates a rejected header", async () => {
    const f = await fixture(); const first = await f.source.read("amazeinsights");
    expect(await f.source.read("another-org")).toEqual(first); expect(f.calls()).toBe(1);
    f.advance(55 * 60_000 - 1); expect(await f.source.read("amazeinsights")).toEqual(first); expect(f.calls()).toBe(1);
    f.advance(1); await f.source.read("amazeinsights"); expect(f.calls()).toBe(2);
    if (!first.ok) throw new Error("missing credential");
    f.source.invalidate(first.authorization); await f.source.read("amazeinsights"); expect(f.calls()).toBe(3);
  });
  it("ignores a late rejection of the previous token after refreshing", async () => {
    let number = 0;
    const f = await fixture(() => { number++; return Promise.resolve(JSON.stringify({ accessToken: `${TOKEN}${String(number)}`, expires_on: (TIME + 7200_000) / 1000 })); });
    const first = await f.source.read("amazeinsights"); if (!first.ok) throw new Error("missing credential");
    f.source.invalidate(first.authorization); const second = await f.source.read("amazeinsights");
    expect(second).not.toEqual(first); expect(f.calls()).toBe(2);
    f.source.invalidate(first.authorization); expect(await f.source.read("amazeinsights")).toEqual(second); expect(f.calls()).toBe(2);
  });
  it("uses each organization's PAT path when a shared CLI refresh fails", async () => {
    const f = await fixture(() => Promise.reject(new Error("CLI unavailable")));
    const results = await Promise.all([f.source.read("amazeinsights"), f.source.read("another-org")]);
    expect(JSON.stringify(results[0])).toContain(join(f.directory, "amazeinsights.pat"));
    expect(JSON.stringify(results[1])).toContain(join(f.directory, "another-org.pat"));
  });
  it("single-flights concurrent refreshes", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture(async () => { await hold; return JSON.stringify({ accessToken: TOKEN, expires_on: (TIME + 3600_000) / 1000 }); });
    const reads = Array.from({ length: 10 }, () => f.source.read("amazeinsights"));
    release(); const results = await Promise.all(reads);
    expect(results.every((r) => r.ok)).toBe(true); expect(f.calls()).toBe(1);
  });
  it("prefers epoch expiry over a conflicting local-time expiry", async () => {
    const f = await fixture(() => Promise.resolve(JSON.stringify({ accessToken: TOKEN, expires_on: String((TIME + 3600_000) / 1000), expiresOn: "2000-01-01 00:00:00.000000" })));
    expect(await f.source.read("amazeinsights")).toMatchObject({ ok: true });
  });
  it("parses the CLI's local-time expiresOn without treating it as UTC", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const local = new Date(2026, 9, 7, 12, 0, 0).getTime();
    const directory = await mkdtemp(join(tmpdir(), "azure-local-expiry-")); directories.push(directory);
    let now = local; let calls = 0;
    const source = new AzureDevopsCredentials({ directory, now: () => now, runner: (command) => { expect(command).toBe("az"); calls++; return Promise.resolve(JSON.stringify({ accessToken: TOKEN, expiresOn: "2026-10-07 13:00:00.000000" })); } });
    expect(await source.read("amazeinsights")).toMatchObject({ ok: true });
    now += 55 * 60_000 - 1; await source.read("amazeinsights"); expect(calls).toBe(1);
    now += 1; await source.read("amazeinsights"); expect(calls).toBe(2);
  });
  it.each(["not json", JSON.stringify({ accessToken: TOKEN }), JSON.stringify({ accessToken: TOKEN, expires_on: "garbage" }), JSON.stringify({ accessToken: TOKEN, expires_on: 1 }), JSON.stringify({ accessToken: "bad\nheader", expires_on: (TIME + 3600_000) / 1000 })])("sanitizes malformed or expired CLI output", async (output) => {
    const f = await fixture(() => Promise.resolve(output)); const result = await f.source.read("amazeinsights");
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).toContain("Run `az login` as the Forgerie user, or put a PAT in");
  });
  it.each(["timeout", "stderr"])("sanitizes a CLI %s failure", async (kind) => {
    const f = await fixture(() => Promise.reject(Object.assign(new Error(TOKEN), { killed: kind === "timeout", stdout: TOKEN, stderr: `noise ${TOKEN}\nERROR: Bearer ${TOKEN} rejected\nERROR: second line ${PAT}` })));
    const result = await f.source.read("amazeinsights");
    expect(result).toMatchObject({ ok: false }); const text = JSON.stringify(result);
    expect(text).not.toContain(TOKEN); expect(text).not.toContain(PAT); expect(text).not.toContain("second line");
    expect(text).toContain("Run `az login`");
    expect(kind === "timeout" ? text.includes("30 seconds") : text.includes("[redacted]")).toBe(true);
  });
});
