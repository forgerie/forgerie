import { describe, expect, it } from "vitest";
import { FakeGitHub, issue, json } from "./fakeGitHub.testSupport.js";
import type { TokenResult } from "./githubApp.js";
import { GitHubIssueClient } from "./githubIssues.js";

const LIST = "GET https://api.github.com/repos/korri-os/korri/issues";
function fixture(options: { granted?: TokenResult } = {}) {
  const github = new FakeGitHub();
  let clock = Date.parse("2026-10-07T12:00:00Z");
  const dropped: string[] = [];
  const granted: TokenResult = options.granted ?? { ok: true, token: "ghs_token" };
  const client = new GitHubIssueClient({
    fetch: github.fetch, now: () => clock,
    app: { tokenFor: () => Promise.resolve(granted), dropToken: (repo) => { dropped.push(repo); }, installUrl: () => "https://github.com/apps/forgerie-zao/installations/new" },
  });
  return { github, client, dropped, advance: (ms: number) => { clock += ms; } };
}

describe("GitHub issue client", () => {
  it("lists open issues across pages, leaves out pull requests, and asks only for open issues", async () => {
    const f = fixture();
    f.github.on(LIST,
      json([issue(3), issue(2, { pull_request: { url: "x" } })], { headers: { link: '<https://api.github.com/repositories/9/issues?state=open&per_page=100&page=2>; rel="next", <https://api.github.com/repositories/9/issues?page=2>; rel="last"' } }));
    f.github.on("GET https://api.github.com/repositories/9/issues", json([issue(1, { labels: ["plain"] })]));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result).toMatchObject({ ok: true, truncated: false });
    expect(result.ok && result.issues.map((value) => [value.number, value.labels])).toEqual([[3, ["bug"]], [1, ["plain"]]]);
    expect(f.github.requests[0]?.url).toBe("https://api.github.com/repos/korri-os/korri/issues?state=open&per_page=100");
    expect(f.github.requests[0]?.headers).toMatchObject({ authorization: "Bearer ghs_token", "x-github-api-version": "2026-03-10" });
  });

  it("reuses a list for a minute, then revalidates with its ETag and reuses it on 304", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1)], { headers: { etag: '"v1"' } }), new Response(null, { status: 304 }));
    await f.client.openIssues("korri-os/korri");
    await f.client.openIssues("korri-os/korri");
    expect(f.github.count(LIST)).toBe(1);
    f.advance(61_000);
    const again = await f.client.openIssues("korri-os/korri");
    expect(f.github.count(LIST)).toBe(2);
    expect(f.github.requests[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(again.ok && again.issues.map((value) => value.number)).toEqual([1]);
  });

  it("sends one request at a time", async () => {
    const f = fixture();
    f.github.always(LIST, () => json([issue(1)]));
    f.github.always("GET https://api.github.com/repos/korri-os/other/issues", () => json([]));
    await Promise.all([f.client.openIssues("korri-os/korri"), f.client.openIssues("korri-os/other"), f.client.openIssues("korri-os/korri")]);
    expect(f.github.maxInFlight).toBe(1);
  });

  it("passes on why the app may not read the repo, without asking GitHub for issues", async () => {
    const missing: TokenResult = { ok: false, kind: "install", message: "Forgerie's GitHub App is not installed on korri-os/korri." };
    const f = fixture({ granted: missing });
    expect(await f.client.openIssues("korri-os/korri")).toEqual(missing);
    expect(f.github.requests).toHaveLength(0);
  });

  it("drops a refused token so the next read mints a new one", async () => {
    const f = fixture();
    f.github.on(LIST, json({ message: "Bad credentials" }, { status: 401 }));
    expect(await f.client.openIssues("korri-os/korri")).toMatchObject({ ok: false, kind: "unavailable" });
    expect(f.dropped).toEqual(["korri-os/korri"]);
  });

  it("names the install page when the app is installed but left this repo out", async () => {
    const f = fixture();
    f.github.on(LIST, json({ message: "Not Found" }, { status: 404 }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result).toMatchObject({ ok: false, kind: "install" });
    expect(!result.ok && result.message).toContain("https://github.com/apps/forgerie-zao/installations/new");
  });

  it("stops asking while rate limited and keeps showing the last good list with its age", async () => {
    const f = fixture();
    const reset = Math.floor(Date.parse("2026-10-07T12:30:00Z") / 1000);
    f.github.on(LIST, json([issue(1)]), json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }));
    await f.client.openIssues("korri-os/korri");
    f.advance(61_000);
    const limited = await f.client.openIssues("korri-os/korri");
    expect(limited).toMatchObject({ ok: true, staleSince: "2026-10-07T12:00:00.000Z" });
    expect(limited.ok && limited.staleReason).toContain("12:30 UTC");
    f.advance(61_000);
    await f.client.openIssues("korri-os/korri");
    expect(f.github.count(LIST)).toBe(2);
  });

  it("serves the last good list when GitHub is unreachable, and says so when there is none", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1)]), () => { throw new TypeError("fetch failed"); });
    await f.client.openIssues("korri-os/korri");
    f.advance(61_000);
    expect(await f.client.openIssues("korri-os/korri")).toMatchObject({ ok: true, staleReason: "GitHub is unreachable: fetch failed" });
    const g = fixture();
    g.github.on(LIST, () => { throw new TypeError("fetch failed"); });
    expect(await g.client.openIssues("korri-os/korri")).toEqual({ ok: false, kind: "unavailable", message: "GitHub is unreachable: fetch failed" });
  });

  it("stops after five pages and says the list is cut short", async () => {
    const f = fixture();
    f.github.always(LIST, json([issue(1)], { headers: { link: '<https://api.github.com/repos/korri-os/korri/issues?state=open&per_page=100&page=2>; rel="next"' } }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(f.github.count(LIST)).toBe(5);
  });

  it("trusts a CONTRIBUTOR who has write access, because GitHub hides private org membership from an app", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "CONTRIBUTOR", user: { login: "simonwjackson" } }),
      issue(2, { author_association: "CONTRIBUTOR", user: { login: "stranger" } }), issue(3, { author_association: "CONTRIBUTOR", user: { login: "simonwjackson" } }),
      issue(4, { author_association: "MEMBER", user: { login: "teammate" } }), issue(5, { author_association: "NONE", user: { login: "drive-by" } })]));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/simonwjackson/permission", json({ permission: "admin" }));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/stranger/permission", json({ permission: "read" }));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/drive-by/permission", json({ permission: "read" }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues.map((value) => [value.number, value.trusted])).toEqual([[1, true], [2, false], [3, true], [4, true], [5, false]]);
    // One lookup per unknown author, none for MEMBER, and the answer is reused for an hour.
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(3);
    f.advance(61_000);
    f.github.on(LIST, new Response(null, { status: 304 }));
    await f.client.openIssues("korri-os/korri");
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(3);
  });

  it.each(["admin", "maintain", "write"])("trusts a NONE author only after GitHub confirms %s access", async (permission) => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "NONE", user: { login: "private-member" } })]));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/private-member/permission", json({ permission }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues[0]?.trusted).toBe(true);
  });

  it.each(["read", "triage", "none"])("keeps a NONE author with %s access untrusted", async (permission) => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "NONE", user: { login: "outsider" } })]));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/outsider/permission", json({ permission }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues[0]?.trusted).toBe(false);
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(1);
  });

  it.each([401, 403, 404, 500])("keeps a NONE author untrusted when permission lookup returns HTTP %s", async (status) => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "NONE", user: { login: "unknown" } })]));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/unknown/permission", json({ permission: "admin" }, { status }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues[0]?.trusted).toBe(false);
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(1);
  });

  it("deduplicates and caches permission checks for NONE authors without checking anonymous authors", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "NONE", user: { login: "private-member" } }),
      issue(2, { author_association: "NONE", user: { login: "private-member" } }), issue(3, { author_association: "NONE", user: null })], { headers: { etag: '"v1"' } }));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/private-member/permission", json({ permission: "admin" }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues.map((value) => value.trusted)).toEqual([true, true, false]);
    f.advance(61_000);
    f.github.on(LIST, new Response(null, { status: 304 }));
    await f.client.openIssues("korri-os/korri");
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(1);
  });

  it("bounds permission checks for NONE authors on a busy public repo", async () => {
    const f = fixture();
    const authors = Array.from({ length: 21 }, (_, index) => `author-${String(index)}`);
    f.github.on(LIST, json(authors.map((login, index) => issue(index + 1, { author_association: "NONE", user: { login } }))));
    for (const login of authors) f.github.on(`GET https://api.github.com/repos/korri-os/korri/collaborators/${login}/permission`, json({ permission: "admin" }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues.filter((value) => value.trusted)).toHaveLength(20);
    expect(result.ok && result.issues[20]?.trusted).toBe(false);
    expect(f.github.requests.filter((request) => request.url.includes("/permission"))).toHaveLength(20);
  });

  it("leaves a contributor untrusted when GitHub cannot say", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1, { author_association: "CONTRIBUTOR", user: { login: "someone" } })]));
    f.github.on("GET https://api.github.com/repos/korri-os/korri/collaborators/someone/permission", () => { throw new TypeError("fetch failed"); });
    const result = await f.client.openIssues("korri-os/korri");
    expect(result.ok && result.issues[0]?.trusted).toBe(false);
  });

  it("does not follow a next link off GitHub's API", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1)], { headers: { link: '<https://evil.example/steal>; rel="next"' } }));
    expect(await f.client.openIssues("korri-os/korri")).toMatchObject({ ok: true });
    expect(f.github.requests).toHaveLength(1);
  });
});
