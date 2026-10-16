import { describe, expect, it } from "vitest";
import { createDecisionsStore, type Request } from "./decisionsStore";
import type { Decision } from "./decisionsModel";
import { ANSWER, GUESS, LOG_NOW, OVERTURNED, RUN_DECISIONS, SESSION_ANSWER } from "./fixtures/decisions";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SESSION = { id: "s 1", cwd: "/srv/app" };
const LIST = "/api/sessions/s%201/decisions?cwd=%2Fsrv%2Fapp";
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const overturned = (decision: Decision, note: string): Decision => ({ ...decision, state: { kind: "overturned", note, at: LOG_NOW } });

/** A stand-in for the routes: each call is recorded, and `answer` picks the response. */
function routes(answer: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request: Request = (path, init) => {
    calls.push({ path, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return Promise.resolve(answer(path, init));
  };
  return { calls, store: createDecisionsStore(request, () => SESSION, 0) };
}
/** A response the test releases when it likes, to make reads answer out of order. */
function held() {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("reading a session's decisions", () => {
  it("is unread until the first answer, then holds the list newest first", async () => {
    const { calls, store } = routes(() => json(200, [SESSION_ANSWER, GUESS, ANSWER]));
    expect(store.getSnapshot().decisions).toBeUndefined();
    store.refresh();
    await settle();
    expect(calls).toEqual([{ path: LIST, method: "GET", body: undefined }]);
    expect(store.getSnapshot().decisions?.map((decision) => decision.id)).toEqual(["d-1", "d-2", "d-4"]);
  });

  it("reads an empty log, as a session without Durable children has", async () => {
    const { store } = routes(() => json(200, []));
    store.refresh();
    await settle();
    expect(store.getSnapshot()).toEqual({ decisions: [], readError: undefined });
  });

  it("costs one read for a burst of change events", async () => {
    const { calls, store } = routes(() => json(200, []));
    store.refresh(); store.refresh(); store.refresh();
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("keeps what it read when a later read fails, says why, and clears the reason on a retry that answers", async () => {
    let fail = false;
    const { store } = routes(() => fail ? json(500, { error: "Durable storage is unavailable." }) : json(200, RUN_DECISIONS));
    store.refresh();
    await settle();
    fail = true;
    store.refresh();
    await settle();
    expect(store.getSnapshot()).toMatchObject({ decisions: RUN_DECISIONS, readError: "Durable storage is unavailable." });
    fail = false;
    await store.retry();
    expect(store.getSnapshot().readError).toBeUndefined();
  });

  it("says the status when the failure has no reason, and refuses a list it cannot read", async () => {
    let body: unknown = "not json";
    const { store } = routes(() => typeof body === "string" ? new Response(body, { status: 502 }) : json(200, body));
    await store.retry();
    expect(store.getSnapshot()).toEqual({ readError: "HTTP 502" });
    body = [{ ...ANSWER, kind: "hunch" }];
    await store.retry();
    expect(store.getSnapshot().decisions).toBeUndefined();
    expect(store.getSnapshot().readError).toBeDefined();
  });

  it("keeps the newest read's answer when an older read answers last", async () => {
    const first = held();
    const second = held();
    const queue = [first.promise, second.promise];
    const { store } = routes(() => queue.shift()!);
    const older = store.retry();
    const newer = store.retry();
    second.release(json(200, [GUESS]));
    await newer;
    first.release(json(200, [ANSWER]));
    await older;
    expect(store.getSnapshot().decisions).toEqual([GUESS]);
  });

  it("ignores a read that started before an overturn the server took", async () => {
    const stale = held();
    let reads = 0;
    const { store } = routes((_path, init) => {
      if (init.method === "POST") return json(200, overturned(GUESS, "Group by stage."));
      reads += 1;
      return reads === 1 ? json(200, RUN_DECISIONS) : stale.promise;
    });
    await store.retry();
    const before = store.retry();
    expect(await store.overturn(GUESS.id, "Group by stage.")).toBe(true);
    stale.release(json(200, RUN_DECISIONS));
    await before;
    expect(store.getSnapshot().decisions?.find((decision) => decision.id === GUESS.id)?.state).toEqual({ kind: "overturned", note: "Group by stage.", at: LOG_NOW });
  });
});

describe("overturning a decision", () => {
  it("sends the note with the cwd, shows it in flight, and puts the server's record in the list", async () => {
    const { calls, store } = routes((_path, init) => init.method === "POST" ? json(200, overturned(GUESS, "Group by stage.")) : json(200, RUN_DECISIONS));
    await store.retry();
    const sent = store.overturn(GUESS.id, "Group by stage.");
    expect(store.getSnapshot().overturning).toBe(GUESS.id);
    expect(await sent).toBe(true);
    expect(calls.at(-1)).toEqual({ path: "/api/sessions/s%201/decisions/d-2/overturn", method: "POST", body: { cwd: "/srv/app", note: "Group by stage." } });
    const state = store.getSnapshot();
    expect(state.overturning).toBeUndefined();
    expect(state.error).toBeUndefined();
    expect(state.decisions?.map((decision) => [decision.id, decision.state.kind])).toEqual([["d-1", "standing"], ["d-2", "overturned"], ["d-3", "overturned"]]);
  });

  it("says why the server refused, reads the log again, and lets the reader dismiss the reason", async () => {
    let afterRefusal = false;
    const { calls, store } = routes((_path, init) => {
      if (init.method === "POST") { afterRefusal = true; return json(409, { error: "This decision is already overturned." }); }
      return json(200, afterRefusal ? [ANSWER, overturned(GUESS, "From another tab."), OVERTURNED] : RUN_DECISIONS);
    });
    await store.retry();
    expect(await store.overturn(GUESS.id, "Group by stage.")).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ overturning: undefined, error: "This decision is already overturned." });
    await settle();
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(store.getSnapshot().decisions?.find((decision) => decision.id === GUESS.id)?.state.kind).toBe("overturned");
    store.dismissError();
    expect(store.getSnapshot().error).toBeUndefined();
  });

  it("sends the note trimmed, and refuses one longer than the server takes, keeping it to shorten", async () => {
    const { calls, store } = routes((_path, init) => init.method === "POST" ? json(200, overturned(GUESS, "Group by stage.")) : json(200, RUN_DECISIONS));
    await store.retry();
    expect(await store.overturn(GUESS.id, `  ${"x".repeat(8001)}  `)).toBe(false);
    expect(store.getSnapshot().error).toBe("Shorten the note to 8,000 characters or fewer. It has 8,001.");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(await store.overturn(GUESS.id, "\n  Group by stage.  \n")).toBe(true);
    expect(calls.at(-1)?.body).toEqual({ cwd: "/srv/app", note: "Group by stage." });
    expect(store.getSnapshot().error).toBeUndefined();
  });

  it("sends nothing for a blank note or while another overturn is on its way", async () => {
    const reply = held();
    const { calls, store } = routes((_path, init) => init.method === "POST" ? reply.promise : json(200, RUN_DECISIONS));
    await store.retry();
    expect(await store.overturn(GUESS.id, "   ")).toBe(false);
    const first = store.overturn(GUESS.id, "Group by stage.");
    expect(await store.overturn(ANSWER.id, "Include them.")).toBe(false);
    reply.release(json(200, overturned(GUESS, "Group by stage.")));
    expect(await first).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("tells no one after it is disposed", async () => {
    const reply = held();
    const { store } = routes(() => reply.promise);
    let heard = 0;
    store.subscribe(() => { heard += 1; });
    const read = store.retry();
    store.dispose();
    reply.release(json(200, RUN_DECISIONS));
    await read;
    expect(heard).toBe(0);
    expect(store.getSnapshot().decisions).toBeUndefined();
  });
});

describe("confirming a flagged guess", () => {
  const confirmed: Decision = { ...GUESS, state: { kind: "confirmed", at: LOG_NOW } };
  it("posts only cwd, clears the flag from the returned record, and survives a read", async () => {
    let records = RUN_DECISIONS;
    const { calls, store } = routes((_path, init) => {
      if (init.method === "POST") { records = records.map((decision) => decision.id === GUESS.id ? confirmed : decision); return json(200, confirmed); }
      return json(200, records);
    });
    await store.retry();
    const sent = store.confirm(GUESS.id);
    expect(store.getSnapshot().confirming).toBe(GUESS.id);
    expect(await sent).toBe(true);
    expect(calls.at(-1)).toEqual({ path: "/api/sessions/s%201/decisions/d-2/confirm", method: "POST", body: { cwd: SESSION.cwd } });
    expect(store.getSnapshot().confirming).toBeUndefined();
    expect(store.getSnapshot().decisions?.find((decision) => decision.id === GUESS.id)).toEqual(confirmed);
    await store.retry();
    expect(store.getSnapshot().decisions?.find((decision) => decision.id === GUESS.id)).toEqual(confirmed);
    store.dispose();
  });

  it("retires stale reads and serializes confirmations with overturns", async () => {
    const stale = held(); const response = held(); let reads = 0;
    const { calls, store } = routes((_path, init) => init.method === "POST" ? response.promise : ++reads === 1 ? json(200, RUN_DECISIONS) : stale.promise);
    await store.retry();
    const before = store.retry();
    const sent = store.confirm(GUESS.id);
    expect(await store.confirm(GUESS.id)).toBe(false);
    expect(await store.overturn(GUESS.id, "Group by stage.")).toBe(false);
    response.release(json(200, confirmed));
    expect(await sent).toBe(true);
    stale.release(json(200, RUN_DECISIONS)); await before;
    expect(store.getSnapshot().decisions?.find((decision) => decision.id === GUESS.id)).toEqual(confirmed);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    store.dispose();
  });

  it("cannot confirm while an overturn is in flight", async () => {
    const response = held();
    const { calls, store } = routes(() => response.promise);
    const sent = store.overturn(GUESS.id, "Group by stage.");
    expect(await store.confirm(GUESS.id)).toBe(false);
    response.release(json(200, overturned(GUESS, "Group by stage.")));
    expect(await sent).toBe(true);
    expect(calls).toHaveLength(1); store.dispose();
  });

  it("shows a refusal without a runtime-opening read, and permits retry", async () => {
    let refuse = true;
    const { calls, store } = routes((_path, init) => init.method === "POST"
      ? refuse ? json(409, { error: "Decision already overturned" }) : json(200, confirmed) : json(200, RUN_DECISIONS));
    await store.retry();
    expect(await store.confirm(GUESS.id)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ confirming: undefined, error: "Decision already overturned" });
    await settle();
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
    refuse = false;
    expect(await store.confirm(GUESS.id)).toBe(true);
    expect(store.getSnapshot().error).toBeUndefined(); store.dispose();
  });
});
