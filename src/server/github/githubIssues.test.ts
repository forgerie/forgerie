import { describe, expect, it } from "vitest";
import { FakeGitHub, issue, json } from "./fakeGitHub.testSupport.js";
import { GitHubIssueClient } from "./githubIssues.js";

const LIST = "GET https://api.github.com/repos/korri-os/korri/issues";
function fixture(options: { token?: string | undefined; slug?: string } = {}) {
  const github = new FakeGitHub();
  let clock = Date.parse("2026-10-07T12:00:00Z");
  const rejected: string[] = [];
  const token = "token" in options ? options.token : "ghu_token";
  const client = new GitHubIssueClient({
    fetch: github.fetch, now: () => clock, appSlug: () => options.slug,
    auth: { accessToken: () => Promise.resolve(token), loginName: () => "simonwjackson", rejectToken: (value) => { rejected.push(value); return Promise.resolve(); } },
  });
  return { github, client, rejected, advance: (ms: number) => { clock += ms; } };
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
    expect(f.github.requests[0]?.headers).toMatchObject({ authorization: "Bearer ghu_token", "x-github-api-version": "2026-03-10" });
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

  it("asks for a login when there is no token, and drops a token GitHub rejects", async () => {
    expect(await fixture({ token: undefined }).client.openIssues("korri-os/korri")).toEqual({ ok: false, kind: "auth", message: "Connect GitHub to list issues for korri-os/korri." });
    const f = fixture();
    f.github.on(LIST, json({ message: "Bad credentials" }, { status: 401 }));
    expect(await f.client.openIssues("korri-os/korri")).toMatchObject({ ok: false, kind: "auth" });
    expect(f.rejected).toEqual(["ghu_token"]);
  });

  it("names the install link when Forgerie cannot read the repo", async () => {
    const f = fixture({ slug: "forgerie-zao" });
    f.github.on(LIST, json({ message: "Not Found" }, { status: 404 }));
    const result = await f.client.openIssues("korri-os/korri");
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
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

  it("does not follow a next link off GitHub's API", async () => {
    const f = fixture();
    f.github.on(LIST, json([issue(1)], { headers: { link: '<https://evil.example/steal>; rel="next"' } }));
    expect(await f.client.openIssues("korri-os/korri")).toMatchObject({ ok: true });
    expect(f.github.requests).toHaveLength(1);
  });
});
