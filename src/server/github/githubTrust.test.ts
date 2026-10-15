import { describe, expect, it } from "vitest";
import { appBotLogin } from "./githubApp.js";
import { GitHubAuthorTrust } from "./githubTrust.js";

const SLUG = "korri-os/korri";

function trust(ownLogin: () => string | undefined) {
  const urls: string[] = [];
  const fetch = (url: string) => { urls.push(url); return Promise.resolve(Response.json({ permission: "read" })); };
  return { trust: new GitHubAuthorTrust({ fetch, ownLogin }), urls };
}

describe("GitHub author trust", () => {
  it("trusts Forgerie's own app without asking GitHub, in any letter case", async () => {
    const f = trust(() => "forgerie-zao[bot]");
    const judge = await f.trust.judge(SLUG, "token", [{ login: "Forgerie-Zao[bot]", association: "NONE" }]);
    expect(judge({ login: "Forgerie-Zao[bot]", association: "NONE" })).toBe(true);
    expect(f.urls).toEqual([]);
  });

  it("keeps other bots and look-alike logins untrusted", async () => {
    const f = trust(() => "forgerie-zao[bot]");
    const authors = [{ login: "dependabot[bot]", association: "NONE" }, { login: "forgerie-zao", association: "NONE" }];
    const judge = await f.trust.judge(SLUG, "token", authors);
    expect(authors.map(judge)).toEqual([false, false]);
  });

  it("trusts only listed bot logins case-insensitively, scoped to the current policy", async () => {
    const f = trust(() => undefined);
    const authors = [{ login: "CodeRabbitAI[bot]", association: "NONE" }, { login: "other[bot]", association: "NONE" }];
    const allowed = await f.trust.judge(SLUG, "token", authors, ["coderabbitai[bot]"]);
    expect(authors.map(allowed)).toEqual([true, false]);
    expect(f.urls.some(url => url.includes("CodeRabbitAI"))).toBe(false);
    expect((await f.trust.judge("other/repo", "token", authors))({ login: "CodeRabbitAI[bot]", association: "NONE" })).toBe(false);
    expect((await f.trust.judge(SLUG, "token", authors))({ login: "CodeRabbitAI[bot]", association: "NONE" })).toBe(false);
  });

  it("trusts no app when none is configured", async () => {
    const f = trust(() => undefined);
    const judge = await f.trust.judge(SLUG, "token", [{ login: "forgerie-zao[bot]", association: "NONE" }]);
    expect(judge({ login: "forgerie-zao[bot]", association: "NONE" })).toBe(false);
  });

  it("follows a new app without a restart", async () => {
    let login = "old-app[bot]";
    const f = trust(() => login);
    login = "new-app[bot]";
    const judge = await f.trust.judge(SLUG, "token", [{ login: "new-app[bot]", association: "NONE" }]);
    expect(judge({ login: "new-app[bot]", association: "NONE" })).toBe(true);
    expect(judge({ login: "old-app[bot]", association: "NONE" })).toBe(false);
  });
});

describe("appBotLogin", () => {
  it("names the configured app's bot account", () => {
    expect(appBotLogin({ state: "configured", app: { slug: "forgerie-zao", owner: "simonwjackson", url: "https://github.com/apps/forgerie-zao" }, installUrl: "https://github.com/apps/forgerie-zao/installations/new" })).toBe("forgerie-zao[bot]");
    expect(appBotLogin({ state: "not-configured" })).toBeUndefined();
  });
});
