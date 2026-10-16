import { describe, expect, it } from "vitest";
import { createActionRunApi, parseActionRunEvent, runKey, sameRunLink } from "./actionRunApi";
import { derived, failedRun, link } from "./fixtures/actionRuns";

const ref = { id: "s1", cwd: "/home/dev/forgerie" };
const query = "?cwd=%2Fhome%2Fdev%2Fforgerie";

function fake(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request = async (path: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ path, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ kind: "action_run_error", error: "Unexpected" }), { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  };
  return { calls, api: createActionRunApi(request) };
}

describe("Actions run API", () => {
  const watched = link(failedRun.runId, { kind: "watching", since: "2026-10-15T11:36:00.000Z", wakes: 2 }, "pull");

  it("lists linked runs, keeping one whose read failed, and the runs of each linked pull request", async () => {
    const broken = { link: link(18234499999), run: null, error: "GitHub answered 404: Not Found." };
    const body = { items: [{ link: watched, run: failedRun }, broken], derived };
    const { calls, api } = fake({ [`GET /api/sessions/s1/action-runs${query}`]: { body } });
    await expect(api.list(ref)).resolves.toEqual(body);
    expect(calls).toEqual([{ path: `/api/sessions/s1/action-runs${query}`, method: "GET", body: undefined }]);
  });

  it("reads one run with its jobs", async () => {
    const { api } = fake({ [`GET /api/sessions/s1/action-runs/${String(failedRun.runId)}${query}`]: { body: { link: watched, run: failedRun } } });
    await expect(api.read(ref, failedRun.runId)).resolves.toEqual({ link: watched, run: failedRun });
  });

  it("links by ID or URL with PUT { cwd, run }", async () => {
    const { calls, api } = fake({ "PUT /api/sessions/s1/action-runs": { body: { link: watched, run: failedRun } } });
    await api.link(ref, failedRun.runId);
    await api.link(ref, failedRun.url);
    expect(calls.map((call) => call.body)).toEqual([{ cwd: ref.cwd, run: failedRun.runId }, { cwd: ref.cwd, run: failedRun.url }]);
  });

  it("unlinks, watches, and stops on the run's routes, each answering with the link", async () => {
    const id = String(failedRun.runId);
    const { calls, api } = fake({
      [`DELETE /api/sessions/s1/action-runs/${id}${query}`]: { body: watched },
      [`POST /api/sessions/s1/action-runs/${id}/watch`]: { body: watched },
      [`DELETE /api/sessions/s1/action-runs/${id}/watch${query}`]: { body: { ...watched, watch: { kind: "stopped", reason: "Stopped by you", at: "2026-10-15T12:00:00.000Z" } } },
    });
    await expect(api.unlink(ref, failedRun.runId)).resolves.toEqual(watched);
    await expect(api.watch(ref, failedRun.runId)).resolves.toEqual(watched);
    await expect(api.stopWatch(ref, failedRun.runId)).resolves.toMatchObject({ watch: { kind: "stopped" } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `DELETE /api/sessions/s1/action-runs/${id}${query}`, `POST /api/sessions/s1/action-runs/${id}/watch`, `DELETE /api/sessions/s1/action-runs/${id}/watch${query}`]);
    expect(calls[1]?.body).toEqual({ cwd: ref.cwd });
  });

  it("throws the server's own words on a refusal", async () => {
    const error = 'Forgerie\'s GitHub App may not do this on forgerie/forgerie: it needs "Actions: read".';
    const { api } = fake({ "PUT /api/sessions/s1/action-runs": { status: 403, body: { kind: "action_run_error", error } } });
    await expect(api.link(ref, 1)).rejects.toThrow(error);
  });

  it("refuses a body that breaks the contract", async () => {
    const { api } = fake({ [`GET /api/sessions/s1/action-runs${query}`]: { body: { items: [{ link: watched, run: { ...failedRun, status: "done" } }], derived: [] } } });
    await expect(api.list(ref)).rejects.toThrow();
    const withoutNumber: Partial<typeof failedRun> = { ...failedRun };
    delete withoutNumber.runNumber;
    const missing = fake({ [`GET /api/sessions/s1/action-runs/${String(failedRun.runId)}${query}`]: { body: { link: watched, run: withoutNumber } } });
    await expect(missing.api.read(ref, failedRun.runId)).rejects.toThrow();
  });
});

describe("Actions run events", () => {
  it("reads a link change and an unlink, and ignores other events", () => {
    const changed = link(1);
    expect(parseActionRunEvent({ type: "session.action-run", link: changed })).toEqual({ link: changed, removed: false });
    expect(parseActionRunEvent({ type: "session.action-run.unlinked", link: changed })).toEqual({ link: changed, removed: true });
    expect(parseActionRunEvent({ type: "session.pull-request", link: changed })).toBeUndefined();
  });

  it("keys a link by session, repository without case, and run", () => {
    expect(sameRunLink(link(1), { ...link(1), repo: "Forgerie/Forgerie" })).toBe(true);
    expect(sameRunLink(link(1), { ...link(1), session: { id: "s2", cwd: "/x" } })).toBe(false);
    expect(sameRunLink(link(1), link(2))).toBe(false);
    expect(runKey({ repo: "O/R", runId: 7 })).toBe("o/r#7");
  });
});
