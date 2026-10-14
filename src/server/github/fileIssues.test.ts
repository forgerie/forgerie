import { describe, expect, it } from "vitest";
import { GitHubAgent } from "./githubAgent.js";
import { json, issue } from "./fakeGitHub.testSupport.js";
import { closeIssueTitle, FileIssueInputSchema, FileIssueResultSchema } from "../../shared/fileIssues.js";
import { Type } from "typebox";
import { Check } from "typebox/value";

const repo = "https://api.github.com/repos/o/r";
const input = { title: "Portal reconnect loses messages", body: "Steps to reproduce", duplicates: ["portal reconnect state:all"] };
const stored = (number: number, title: string, state: "open" | "closed" = "open") => issue(number, { title, state, updated_at: "2026-10-13T00:00:00Z", comments: 0 });
function fixture(config: { issues?: Record<string, unknown>[]; labels?: string[]; refuseLabel?: boolean; raceLabel?: boolean; omitIssueLabel?: boolean; incomplete?: boolean; total?: number } = {}) {
  const requests: { method: string; url: string; body: Record<string, unknown> }[] = [];
  const labels = new Set(config.labels ?? []);
  let next = 40;
  const agent = new GitHubAgent({
    resolveRepo: () => Promise.resolve({ slug: "o/r", everyone: true }),
    app: { tokenFor: () => Promise.resolve({ ok: true, token: "test" }), dropToken: () => undefined, status: () => ({ state: "not-configured" }) },
    trust: { judge: () => Promise.resolve(() => true) },
    fetch: async (url, init) => {
      await Promise.resolve();
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (!Check(Type.Record(Type.String(), Type.Unknown()), body)) throw new Error("Invalid request body");
      requests.push({ method, url, body });
      if (url.startsWith("https://api.github.com/search/issues")) return json({ items: config.issues ?? [], total_count: config.total ?? config.issues?.length ?? 0, incomplete_results: config.incomplete ?? false });
      if (url.startsWith(`${repo}/labels`) && method === "GET") return json([...labels].slice((Number(new URL(url).searchParams.get("page") ?? "1") - 1) * 100, Number(new URL(url).searchParams.get("page") ?? "1") * 100).map(name => ({ name, description: null })));
      if (url === `${repo}/labels` && method === "POST") {
        if (config.raceLabel === true) { labels.add("agent-filed"); return json({ message: "Label already exists" }, { status: 422 }); }
        if (config.refuseLabel === true) return json({ message: "Permission refused" }, { status: 403 });
        labels.add("agent-filed"); return json({ name: "agent-filed", description: null }, { status: 201 });
      }
      if (url === `${repo}/issues` && method === "POST") return json({ ...stored(next++, String(body["title"])), labels: config.omitIssueLabel === true ? [] : body["labels"] }, { status: 201 });
      throw new Error(`Unexpected request ${method} ${url}`);
    },
  });
  return { agent, requests };
}
describe("file_issue duplicate search", () => {
  it.each(["open", "closed"] as const)("refuses exact and close %s titles, returns all matches, and writes nothing", async state => {
    const f = fixture({ issues: [stored(2, input.title.toUpperCase() + "!", state), stored(3, "Portal reconnect loses queued messages", state), stored(4, "Unrelated issue", state)] });
    const result = await f.agent.fileIssue("/repo", "s1", input);
    expect(result).toMatchObject({ state: "duplicate", matches: [{ number: 2, state, title: input.title.toUpperCase() + "!" }, { number: 3, state, title: "Portal reconnect loses queued messages" }] });
    expect(Check(FileIssueResultSchema, result)).toBe(true);
    expect(f.requests.every(request => request.method === "GET")).toBe(true);
    for (const request of f.requests) {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      expect(q).toContain("repo:o/r is:issue in:title");
      expect(q).not.toMatch(/state:|is:open|is:closed/u);
    }
  });
  it("requires all close matches to be explicitly overridden", async () => {
    const f = fixture({ issues: [stored(2, input.title), stored(3, "Portal reconnect loses queued messages", "closed")] });
    expect((await f.agent.fileIssue("/repo", "s1", { ...input, notDuplicateOf: [2] })).state).toBe("duplicate");
    expect((await f.agent.fileIssue("/repo", "s1", { ...input, notDuplicateOf: [2, 3] })).state).toBe("created");
    expect(f.requests.filter(request => request.url === `${repo}/issues` && request.method === "POST")).toHaveLength(1);
  });
  it("uses a documented threshold, ignores punctuation/case, and avoids short-token coincidences", () => {
    expect(closeIssueTitle("Fix portal!", "FIX: portal")).toBe(true);
    expect(closeIssueTitle(input.title, "Portal reconnect loses queued messages")).toBe(true);
    expect(closeIssueTitle("a b c d e", "a b c d f")).toBe(true); // Dice = 0.8.
    expect(closeIssueTitle("a b c d e", "a b c f g")).toBe(false);
    expect(closeIssueTitle("Fix the portal", "Fix the proxy")).toBe(false);
    expect(closeIssueTitle("!!!", "???")).toBe(false);
  });
  it.each([{ incomplete: true }, { total: 1001 }])("fails closed on incomplete searches: %j", async config => {
    const f = fixture(config);
    await expect(f.agent.fileIssue("/repo", "s1", input)).rejects.toThrow("Duplicate search is incomplete");
    expect(f.requests).toHaveLength(1);
  });
  it.each([
    { ...input, duplicates: [] }, { ...input, duplicates: [" "] }, { ...input, title: " " }, { ...input, notDuplicateOf: [0] },
  ])("rejects invalid input before network access: %j", async value => {
    const f = fixture();
    expect(Check(FileIssueInputSchema, value)).toBe(false);
    await expect(f.agent.fileIssue("/repo", "s1", value)).rejects.toThrow("Invalid file_issue");
    expect(f.requests).toEqual([]);
  });
});
describe("file_issue labels", () => {
  it("creates agent-filed once across concurrent calls and signs every issue", async () => {
    const f = fixture({ labels: ["bug"] });
    const results = await Promise.all([f.agent.fileIssue("/repo", "s1", { ...input, labels: ["bug", "agent-filed"] }), f.agent.fileIssue("/repo", "s1", input)]);
    expect(results.every(result => result.state === "created" && result.agentFiled)).toBe(true);
    await f.agent.fileIssue("/repo", "s1", input);
    expect(f.requests.filter(request => request.url === `${repo}/labels` && request.method === "POST")).toHaveLength(1);
    const writes = f.requests.filter(request => request.url === `${repo}/issues` && request.method === "POST");
    expect(writes).toHaveLength(3);
    expect(writes.map(request => request.body["labels"])).toEqual(expect.arrayContaining([["bug", "agent-filed"], ["agent-filed"]]));
    expect(writes[0]?.body["body"]).toBe("Steps to reproduce\n\n<!-- forgerie-session: s1 -->");
  });
  it("uses an existing agent-filed label without creating one", async () => {
    const f = fixture({ labels: ["agent-filed"] });
    await f.agent.fileIssue("/repo", "s1", input);
    expect(f.requests.filter(request => request.method === "POST").map(request => request.url)).toEqual([`${repo}/issues`]);
  });
  it("files without the label when creation is refused and reports why", async () => {
    const f = fixture({ labels: ["bug"], refuseLabel: true });
    const result = await f.agent.fileIssue("/repo", "s1", { ...input, labels: ["bug", "agent-filed"] });
    expect(result).toMatchObject({ state: "created", agentFiled: false });
    expect(result).toHaveProperty("labelWarning", expect.stringContaining("without agent-filed"));
    expect(result).toHaveProperty("labelWarning", expect.stringContaining("Permission refused"));
    expect(f.requests.at(-1)?.body["labels"]).toEqual(["bug"]);
  });
  it("finds agent-filed on a later label page without trying to create it", async () => {
    const f = fixture({ labels: [...Array.from({ length: 100 }, (_, i) => `label-${String(i)}`), "agent-filed"] });
    const result = await f.agent.fileIssue("/repo", "s1", input);
    expect(result).toHaveProperty("agentFiled", true);
    expect(f.requests.filter(request => request.method === "POST").map(request => request.url)).toEqual([`${repo}/issues`]);
    expect(f.requests.some(request => request.url.includes("labels?per_page=100&page=2"))).toBe(true);
  });
  it("accepts another process creating the same label before our POST", async () => {
    const f = fixture({ raceLabel: true });
    const result = await f.agent.fileIssue("/repo", "s1", input);
    expect(result).toHaveProperty("agentFiled", true);
    expect(result).not.toHaveProperty("labelWarning");
  });
  it("reports a missing label in the issue creation response instead of claiming it was attached", async () => {
    const f = fixture({ labels: ["agent-filed"], omitIssueLabel: true });
    const result = await f.agent.fileIssue("/repo", "s1", input);
    expect(result).toHaveProperty("agentFiled", false);
    expect(result).toHaveProperty("labelWarning", expect.stringContaining("did not attach"));
  });
  it("refuses unknown user labels before any write", async () => {
    const f = fixture();
    await expect(f.agent.fileIssue("/repo", "s1", { ...input, labels: ["unknown"] })).rejects.toThrow("These labels do not exist");
    expect(f.requests.every(request => request.method === "GET")).toBe(true);
  });
});
