import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeGitHub, json } from "./fakeGitHub.testSupport.js";
import { GitHubAuth } from "./githubAuth.js";
import { GitHubAuthStore } from "./githubAuthStore.js";

const DEVICE = "POST https://github.com/login/device/code";
const TOKEN = "POST https://github.com/login/oauth/access_token";
const USER = "GET https://api.github.com/user";
const app = { clientId: "Iv23liForgerie01", slug: "forgerie-zao" };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(start = Date.parse("2026-10-07T12:00:00Z")) {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-github-auth-")); directories.push(dir);
  const path = join(dir, "github-auth.json");
  const store = new GitHubAuthStore(path); await store.initialize();
  const github = new FakeGitHub();
  let clock = start;
  const delays: number[] = [];
  const auth = new GitHubAuth({ store, fetch: github.fetch, now: () => clock, wait: (ms) => { delays.push(ms); clock += ms; return Promise.resolve(); } });
  return { dir, path, store, github, auth, delays, advance: (ms: number) => { clock += ms; }, now: () => clock };
}
const deviceCode = json({ device_code: "dev-1", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
const tokens = (n: number) => json({ access_token: `ghu_access${String(n)}`, expires_in: 28_800, refresh_token: `ghr_refresh${String(n)}`, refresh_token_expires_in: 15_897_600, scope: "", token_type: "bearer" });

async function logIn(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  f.github.on(DEVICE, deviceCode).on(TOKEN, tokens(1)).on(USER, json({ login: "simonwjackson" }));
  await f.auth.configure(app);
  await f.auth.startLogin();
  await vi.waitFor(() => { expect(f.auth.status().state).toBe("connected"); });
}

describe("GitHub device-flow login", () => {
  it("is not configured until an app is set, and stays disconnected until someone logs in", async () => {
    const f = await fixture();
    expect(f.auth.status()).toEqual({ state: "not-configured" });
    await expect(f.auth.startLogin()).rejects.toThrow("Set up the Forgerie GitHub App");
    expect(await f.auth.configure(app)).toEqual({ state: "disconnected", app });
    expect(await f.auth.accessToken()).toBeUndefined();
  });

  it("shows the code, obeys GitHub's interval and slow_down, and keeps tokens out of every status", async () => {
    const f = await fixture();
    await f.auth.configure(app);
    f.github.on(DEVICE, deviceCode)
      .on(TOKEN, json({ error: "authorization_pending" }), json({ error: "slow_down", interval: 10 }), tokens(1))
      .on(USER, json({ login: "simonwjackson" }));
    const pending = await f.auth.startLogin();
    expect(pending).toMatchObject({ state: "pending", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device" });
    expect(f.github.requests[0]?.form.get("client_id")).toBe(app.clientId);
    await vi.waitFor(() => { expect(f.auth.status()).toMatchObject({ state: "connected", login: "simonwjackson" }); });
    expect(f.delays).toEqual([5000, 5000, 10_000]);
    const poll = f.github.requests.find((request) => request.url.endsWith("/access_token"));
    expect(poll?.form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(poll?.form.has("client_secret")).toBe(false);
    expect(JSON.stringify(f.auth.status())).not.toMatch(/ghu_|ghr_/u);
    expect(f.github.requests.find((request) => request.url.endsWith("/user"))?.headers["authorization"]).toBe("Bearer ghu_access1");
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(f.path, "utf8"))).toMatchObject({ app, login: { login: "simonwjackson", accessToken: "ghu_access1", refreshToken: "ghr_refresh1" } });
    expect(await f.auth.accessToken()).toBe("ghu_access1");
  });

  it("explains a refused login and keeps no token", async () => {
    const f = await fixture();
    await f.auth.configure(app);
    f.github.on(DEVICE, deviceCode).on(TOKEN, json({ error: "access_denied" }));
    await f.auth.startLogin();
    await vi.waitFor(() => { expect(f.auth.status()).toEqual({ state: "disconnected", app, reason: "The GitHub login was cancelled on github.com." }); });
    f.github.on(DEVICE, json({ error: "device_flow_disabled" }));
    await expect(f.auth.startLogin()).rejects.toThrow("Enable Device Flow");
  });

  it("refreshes once for overlapping callers and stores the new pair before using it", async () => {
    const f = await fixture();
    await logIn(f);
    f.advance(8 * 3600_000);
    f.github.on(TOKEN, tokens(2));
    const [a, b] = await Promise.all([f.auth.accessToken(), f.auth.accessToken()]);
    expect([a, b]).toEqual(["ghu_access2", "ghu_access2"]);
    const refreshes = f.github.requests.filter((request) => request.form.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.form.get("refresh_token")).toBe("ghr_refresh1");
    expect(refreshes[0]?.form.has("client_secret")).toBe(false);
    expect(JSON.parse(await readFile(f.path, "utf8"))).toMatchObject({ login: { accessToken: "ghu_access2", refreshToken: "ghr_refresh2" } });
  });

  it("drops a login GitHub will not renew, and one whose refresh token has expired, with a reason", async () => {
    const f = await fixture();
    await logIn(f);
    f.advance(8 * 3600_000);
    f.github.on(TOKEN, json({ error: "bad_refresh_token" }));
    expect(await f.auth.accessToken()).toBeUndefined();
    expect(f.auth.status()).toMatchObject({ state: "disconnected", reason: "GitHub refused to renew Forgerie's login. Log in again." });

    const g = await fixture();
    await logIn(g);
    g.advance(184 * 24 * 3600_000);
    const before = g.github.requests.length;
    expect(await g.auth.accessToken()).toBeUndefined();
    expect(g.github.requests).toHaveLength(before);
    expect(g.auth.status()).toMatchObject({ state: "disconnected", reason: "Forgerie's GitHub login expired." });
  });

  it("keeps a login when the refresh cannot reach GitHub, so a network blip does not log the user out", async () => {
    const f = await fixture();
    await logIn(f);
    f.advance(8 * 3600_000);
    f.github.on(TOKEN, () => { throw new TypeError("fetch failed"); });
    await expect(f.auth.accessToken()).rejects.toThrow("fetch failed");
    expect(f.auth.status().state).toBe("connected");
  });

  it("drops a rejected token, keeps the login for the same app, and drops it for another app", async () => {
    const f = await fixture();
    await logIn(f);
    await f.auth.rejectToken("ghu_someone_else");
    expect(f.auth.status().state).toBe("connected");
    await f.auth.configure({ ...app, slug: "renamed" });
    expect(f.auth.status().state).toBe("connected");
    await f.auth.configure({ clientId: "Iv23liAnotherApp" });
    expect(f.auth.status()).toEqual({ state: "disconnected", app: { clientId: "Iv23liAnotherApp" } });

    const g = await fixture();
    await logIn(g);
    await g.auth.rejectToken("ghu_access1");
    const status = g.auth.status();
    expect(status.state === "disconnected" && status.reason).toContain("revoked");
    expect(JSON.parse(await readFile(g.path, "utf8"))).toEqual({ version: 1, app });
  });

  it("forgets the login on disconnect and survives a restart while connected", async () => {
    const f = await fixture();
    await logIn(f);
    const restarted = new GitHubAuth({ store: await reload(f.path), fetch: f.github.fetch, now: f.now });
    expect(restarted.status()).toMatchObject({ state: "connected", login: "simonwjackson" });
    expect(await f.auth.disconnect()).toEqual({ state: "disconnected", app });
    expect(await f.auth.accessToken()).toBeUndefined();
  });
});

describe("GitHub login file", () => {
  it("tightens a loosened file and fails closed on a malformed one", async () => {
    const f = await fixture();
    await logIn(f);
    await chmod(f.path, 0o644);
    await reload(f.path);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    await writeFile(f.path, '{"version":1,"login":{"login":"x"}}');
    await expect(reload(f.path)).rejects.toThrow("Invalid GitHub login file");
    expect(await readFile(f.path, "utf8")).toBe('{"version":1,"login":{"login":"x"}}');
  });
});

async function reload(path: string): Promise<GitHubAuthStore> {
  const store = new GitHubAuthStore(path); await store.initialize(); return store;
}
