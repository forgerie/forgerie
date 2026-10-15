import { mkdir, open, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DecisionGatewayKeyStore } from "./decisionGatewayKey.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "decision-gateway-key-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const key = "distinctive-private-gateway-key-October15";

describe("decision gateway key storage", () => {
  it("creates private files and atomically replaces the old inode", async () => {
    const store = new DecisionGatewayKeyStore({ agentDir: dir, env: {} });
    expect(await store.status()).toEqual({ keyPresent: false, source: "none" });
    await store.set(key);
    const path = join(dir, "decision-gateway.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ apiKey: key });
    const old = await open(path, "r");
    try {
      await store.set("replacement-private-gateway-key");
      expect((await stat(path)).ino).not.toBe((await old.stat()).ino);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await old.readFile("utf8")).toContain(key);
      expect(await store.readApiKey()).toBe("replacement-private-gateway-key");
    } finally { await old.close(); }
    expect(await readdir(dir)).toEqual(["decision-gateway.json"]);
    await store.clear();
    expect(await store.status()).toEqual({ keyPresent: false, source: "none" });
    expect(await readdir(dir)).toEqual([]);
    await store.clear();
  });
  it("observes other writers, including same-sized atomic replacements with the same mtime", async () => {
    const reader = new DecisionGatewayKeyStore({ agentDir: dir, env: {} });
    const writer = new DecisionGatewayKeyStore({ agentDir: dir, env: {} });
    await writer.set("first-key"); expect(await reader.readApiKey()).toBe("first-key");
    const path = join(dir, "decision-gateway.json"); const before = await stat(path);
    await writer.set("other-key"); await utimes(path, before.atime, before.mtime);
    expect(await reader.readApiKey()).toBe("other-key");
    await writer.clear(); expect(await reader.readApiKey()).toBeUndefined();
  });
  it("gives the captured environment precedence and refuses both mutations", async () => {
    const file = new DecisionGatewayKeyStore({ agentDir: dir, env: {} }); await file.set(key);
    const store = new DecisionGatewayKeyStore({ agentDir: dir, env: { DECISION_GATEWAY_API_KEY: "env-private-key" } });
    expect(await store.readApiKey()).toBe("env-private-key");
    expect(await store.status()).toEqual({ keyPresent: true, source: "environment" });
    await expect(store.set("new-key")).rejects.toThrow("DECISION_GATEWAY_API_KEY");
    await expect(store.clear()).rejects.toThrow("DECISION_GATEWAY_API_KEY");
    expect(await file.readApiKey()).toBe(key);
  });
  it.each(["", "  ", "a\nb", "\tkey", "key\u0000", "key\u007f", "key\u0085", "x".repeat(4097)])("rejects invalid input without echoing it", async value => {
    const store = new DecisionGatewayKeyStore({ agentDir: dir, env: {} });
    await expect(store.set(value)).rejects.toThrow("Gateway key must");
    expect(await readdir(dir)).toEqual([]);
  });
  it("leaves no temporary secret file after a failed rename and contains the error", async () => {
    await mkdir(join(dir, "decision-gateway.json"));
    const store = new DecisionGatewayKeyStore({ agentDir: dir, env: {} });
    try { await store.set(key); throw new Error("Expected the save to fail"); }
    catch (error) { expect(String(error)).toContain("Cannot save the gateway key file"); expect(String(error)).not.toContain(key); }
    expect(await readdir(dir)).toEqual(["decision-gateway.json"]);
  });
  it("trims input and contains damaged-file errors without exposing data", async () => {
    const store = new DecisionGatewayKeyStore({ agentDir: dir, env: {} }); await store.set(`  ${key}  `);
    expect(await store.readApiKey()).toBe(key);
    await writeFile(join(dir, "decision-gateway.json"), `{"apiKey":"${key}`);
    expect(await store.status()).toEqual({ keyPresent: false, source: "settings", invalid: true });
    try { await store.readApiKey(); } catch (error) { expect(String(error)).not.toContain(key); }
    await store.clear(); expect(await store.status()).toEqual({ keyPresent: false, source: "none" });
  });
});
