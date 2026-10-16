import { createVerify, generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defined, FakeGitHub, json, stateOf } from "./fakeGitHub.testSupport.js";
import { GitHubApp } from "./githubApp.js";
import { GitHubAppStore } from "./githubAppStore.js";

const CONVERT = "POST https://api.github.com/app-manifests/code-1/conversions";
const INSTALLATION = "GET https://api.github.com/repos/korri-os/korri/installation";
const TOKEN = "POST https://api.github.com/app/installations/77/access_tokens";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const created = { id: 42, slug: "forgerie-zao", client_id: "Iv23liForgerie01", html_url: "https://github.com/apps/forgerie-zao", owner: { login: "simonwjackson" },
  pem: privateKey, client_secret: "secret-not-kept", webhook_secret: "hook-not-kept" };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-github-app-")); directories.push(dir);
  const path = join(dir, "github-app.json");
  const store = new GitHubAppStore(path); await store.initialize();
  const github = new FakeGitHub();
  let clock = Date.parse("2026-10-07T12:00:00Z");
  const app = new GitHubApp({ store, fetch: github.fetch, now: () => clock, machineName: "zao" });
  return { path, store, github, app, advance: (ms: number) => { clock += ms; } };
}
async function setUp(f: Awaited<ReturnType<typeof fixture>>) {
  const state = stateOf(f.app.startSetup("https://forgerie.tail.ts.net").action);
  f.github.on(CONVERT, json(created, { status: 201 }));
  await f.app.finishSetup({ code: "code-1", state });
}
const token = (value: string, expiresAt: string) => json({ token: value, expires_at: expiresAt }, { status: 201 });

describe("GitHub App setup", () => {
  it("asks GitHub for an Actions-enabled, webhook-free app that returns to this page", async () => {
    const f = await fixture();
    expect(f.app.status()).toEqual({ state: "not-configured" });
    const start = f.app.startSetup("https://forgerie.tail.ts.net/some/path?backlog");
    expect(start.action).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=forgerie-[a-f0-9]{32}$/u);
    expect(JSON.parse(start.manifest)).toEqual({
      name: "Forgerie (zao)", url: "https://forgerie.tail.ts.net", description: "Lists issues in Forgerie's backlog, and lets Forgerie's agents work on issues and pull requests.", public: true,
      redirect_url: "https://forgerie.tail.ts.net/", setup_url: "https://forgerie.tail.ts.net/?backlog", setup_on_update: true,
      default_permissions: { issues: "write", pull_requests: "write", contents: "write", checks: "read", statuses: "read", actions: "write" }, default_events: [],
    });
    // A plain-http origin still returns there; only the homepage falls back to github.com.
    expect(JSON.parse(f.app.startSetup("http://zao:8510").manifest)).toMatchObject({ url: "https://github.com", redirect_url: "http://zao:8510/" });
  });

  it("keeps the key and identity, drops the secrets, and stores them owner-only", async () => {
    const f = await fixture();
    await setUp(f);
    expect(f.app.status()).toEqual({ state: "configured", app: { slug: "forgerie-zao", owner: "simonwjackson", url: "https://github.com/apps/forgerie-zao" },
      installUrl: "https://github.com/apps/forgerie-zao/installations/new" });
    const file = await readFile(f.path, "utf8");
    expect(file).not.toContain("secret-not-kept");
    expect(file).not.toContain("hook-not-kept");
    expect(JSON.parse(file)).toMatchObject({ version: 1, app: { id: 42, clientId: "Iv23liForgerie01", privateKey } });
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(f.app.status())).not.toContain("PRIVATE KEY");
  });

  it("refuses a reply it did not start, a reused one, and one older than an hour", async () => {
    const f = await fixture();
    await expect(f.app.finishSetup({ code: "code-1", state: "forgerie-00000000000000000000000000000000" })).rejects.toThrow("did not start here");
    const state = stateOf(f.app.startSetup("https://forgerie.tail.ts.net").action);
    f.github.on(CONVERT, json(created, { status: 201 }));
    await f.app.finishSetup({ code: "code-1", state });
    await expect(f.app.finishSetup({ code: "code-1", state })).rejects.toThrow("did not start here");
    const late = stateOf(f.app.startSetup("https://forgerie.tail.ts.net").action);
    f.advance(61 * 60_000);
    await expect(f.app.finishSetup({ code: "code-1", state: late })).rejects.toThrow("older than an hour");
    expect(f.github.count(CONVERT)).toBe(1);
  });

  it("says to start again when GitHub will not hand the app over, and keeps nothing", async () => {
    const f = await fixture();
    const state = stateOf(f.app.startSetup("https://forgerie.tail.ts.net").action);
    f.github.on(CONVERT, json({ message: "Not Found" }, { status: 404 }));
    await expect(f.app.finishSetup({ code: "code-1", state })).rejects.toThrow("Start the setup again");
    expect(f.app.status()).toEqual({ state: "not-configured" });
  });
});

describe("reading as the app", () => {
  it("signs an app token GitHub can verify, finds the repo's installation, and reuses its token for the hour", async () => {
    const f = await fixture();
    await setUp(f);
    f.github.on(INSTALLATION, json({ id: 77 })).on(TOKEN, token("ghs_one", "2026-10-07T13:00:00Z"));
    expect(await f.app.tokenFor("korri-os/korri")).toEqual({ ok: true, token: "ghs_one" });
    expect(await f.app.tokenFor("Korri-OS/Korri")).toEqual({ ok: true, token: "ghs_one" });
    expect([f.github.count(INSTALLATION), f.github.count(TOKEN)]).toEqual([1, 1]);
    const jwt = defined(f.github.requests[1]?.headers["authorization"], "an app token on the installation lookup").replace("Bearer ", "");
    const [header = "", claims = "", signature = ""] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    const now = Date.parse("2026-10-07T12:00:00Z") / 1000;
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iat: now - 60, exp: now + 540, iss: "Iv23liForgerie01" });
  });

  it("renews the token five minutes before it expires, once for overlapping reads", async () => {
    const f = await fixture();
    await setUp(f);
    f.github.on(INSTALLATION, json({ id: 77 })).on(TOKEN, token("ghs_one", "2026-10-07T13:00:00Z"), token("ghs_two", "2026-10-07T14:00:00Z"));
    await f.app.tokenFor("korri-os/korri");
    f.advance(56 * 60_000);
    const both = await Promise.all([f.app.tokenFor("korri-os/korri"), f.app.tokenFor("korri-os/korri")]);
    expect(both).toEqual([{ ok: true, token: "ghs_two" }, { ok: true, token: "ghs_two" }]);
    expect(f.github.count(TOKEN)).toBe(2);
  });

  it("names the install page when the app is not on the repo, and asks again after a minute", async () => {
    const f = await fixture();
    await setUp(f);
    f.github.on(INSTALLATION, json({ message: "Not Found" }, { status: 404 }), json({ id: 77 })).on(TOKEN, token("ghs_one", "2026-10-07T13:00:00Z"));
    const missing = await f.app.tokenFor("korri-os/korri");
    expect(missing).toMatchObject({ ok: false, kind: "install" });
    expect(!missing.ok && missing.message).toContain("https://github.com/apps/forgerie-zao/installations/new");
    await f.app.tokenFor("korri-os/korri");
    expect(f.github.count(INSTALLATION)).toBe(1);
    f.advance(61_000);
    expect(await f.app.tokenFor("korri-os/korri")).toEqual({ ok: true, token: "ghs_one" });
  });

  it("says when GitHub no longer accepts the app, and asks for setup when there is none", async () => {
    const f = await fixture();
    const none = await f.app.tokenFor("korri-os/korri");
    expect(none).toMatchObject({ ok: false, kind: "auth" });
    expect(!none.ok && none.message).toContain("Set up GitHub in the backlog");
    await setUp(f);
    f.github.on(INSTALLATION, json({ message: "Bad credentials" }, { status: 401 }));
    const refused = await f.app.tokenFor("korri-os/korri");
    expect(refused).toMatchObject({ ok: false, kind: "auth" });
    expect(!refused.ok && refused.message).toContain("deleted");
  });

  it("throws when GitHub is unreachable, so the caller keeps its last list", async () => {
    const f = await fixture();
    await setUp(f);
    f.github.on(INSTALLATION, () => { throw new TypeError("fetch failed"); });
    await expect(f.app.tokenFor("korri-os/korri")).rejects.toThrow("fetch failed");
  });

  it("forgets everything on remove, and a restart keeps the app", async () => {
    const f = await fixture();
    await setUp(f);
    const restarted = new GitHubApp({ store: await reload(f.path), fetch: f.github.fetch });
    expect(restarted.status().state).toBe("configured");
    expect(await f.app.remove()).toEqual({ state: "not-configured" });
    expect(JSON.parse(await readFile(f.path, "utf8"))).toEqual({ version: 1 });
  });
});

describe("GitHub App file", () => {
  it("tightens a loosened file and fails closed on a malformed one", async () => {
    const f = await fixture();
    await setUp(f);
    await chmod(f.path, 0o644);
    await reload(f.path);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    await writeFile(f.path, '{"version":1,"app":{"id":1}}');
    await expect(reload(f.path)).rejects.toThrow("Invalid GitHub App file");
  });
});

async function reload(path: string): Promise<GitHubAppStore> { const store = new GitHubAppStore(path); await store.initialize(); return store; }
