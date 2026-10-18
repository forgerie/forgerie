import { describe, expect, it } from "vitest";
import { createGatedActionsStore, type Request } from "./gatedActionsStore";
import { PUSH, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, REPLY, RESET } from "./fixtures/gatedActions";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SESSION = { id: "s 1", cwd: "/srv/app" };
const LIST = "/api/sessions/s%201/gated-actions?cwd=%2Fsrv%2Fapp";
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A stand-in for the routes: each call is recorded, and `answer` picks the response. */
function routes(answer: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request: Request = (path, init) => {
    calls.push({ path, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return Promise.resolve(answer(path, init));
  };
  return { calls, store: createGatedActionsStore(request, () => SESSION, 0) };
}
/** A response the test releases when it likes, to make reads answer out of order. */
function held() {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("reading a session's gated actions", () => {
  it("is unread until the first answer, then holds them newest first", async () => {
    const { calls, store } = routes(() => json(200, [REPLY, PUSH, RESET]));
    expect(store.getSnapshot().records).toBeUndefined();
    store.refresh();
    await settle();
    expect(calls).toEqual([{ path: LIST, method: "GET", body: undefined }]);
    expect(store.getSnapshot().records?.map((record) => record.id)).toEqual([PUSH.id, RESET.id, REPLY.id]);
  });

  it("reads an empty list, as a session without Durable children has", async () => {
    const { store } = routes(() => json(200, []));
    store.refresh();
    await settle();
    expect(store.getSnapshot()).toEqual({ records: [], readError: undefined });
  });

  it("costs one read for a burst of change events", async () => {
    const { calls, store } = routes(() => json(200, []));
    store.refresh(); store.refresh(); store.refresh();
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("keeps what it read when a later read fails, says why, and clears the reason on a read that answers", async () => {
    let fail = false;
    const { store } = routes(() => fail ? json(500, { error: "Durable storage is unavailable." }) : json(200, [PUSH]));
    await store.retry();
    fail = true;
    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ records: [PUSH], readError: "Durable storage is unavailable." });
    fail = false;
    await store.retry();
    expect(store.getSnapshot().readError).toBeUndefined();
  });

  it("says the status when the failure has no reason, and refuses a list it cannot read", async () => {
    let body: unknown = "not json";
    const { store } = routes(() => typeof body === "string" ? new Response(body, { status: 502 }) : json(200, body));
    await store.retry();
    expect(store.getSnapshot()).toEqual({ readError: "HTTP 502" });
    body = [{ ...PUSH, category: "deploy" }];
    await store.retry();
    expect(store.getSnapshot().records).toBeUndefined();
    expect(store.getSnapshot().readError).toBeDefined();
  });

  it("keeps the newest read's answer when an older read answers last", async () => {
    const first = held();
    const second = held();
    const queue = [first.promise, second.promise];
    const { store } = routes(() => queue.shift()!);
    const older = store.retry();
    const newer = store.retry();
    second.release(json(200, [PUSH_RAN]));
    await newer;
    first.release(json(200, [PUSH]));
    await older;
    expect(store.getSnapshot().records).toEqual([PUSH_RAN]);
  });

  it("ignores a read that started before a choice the server took", async () => {
    const stale = held();
    let reads = 0;
    const { store } = routes((_path, init) => {
      if (init.method === "POST") return json(200, PUSH_RUNNING);
      reads += 1;
      return reads === 1 ? json(200, [PUSH]) : stale.promise;
    });
    await store.retry();
    const before = store.retry();
    expect(await store.approve(PUSH.id)).toBe(true);
    stale.release(json(200, [PUSH]));
    await before;
    expect(store.getSnapshot().records).toEqual([PUSH_RUNNING]);
  });
});

describe("approving and refusing", () => {
  it("approves with the cwd, shows the choice in flight, and puts the server's record in the list", async () => {
    const reply = held();
    const { calls, store } = routes((_path, init) => init.method === "POST" ? reply.promise : json(200, [PUSH, RESET]));
    await store.retry();
    const sent = store.approve(PUSH.id);
    expect(store.getSnapshot().deciding).toEqual({ id: PUSH.id, choice: "approve" });
    reply.release(json(200, PUSH_RUNNING));
    expect(await sent).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toEqual([{ path: "/api/sessions/s%201/gated-actions/g%3A21%3A184/approve", method: "POST", body: { cwd: "/srv/app" } }]);
    expect(store.getSnapshot()).toMatchObject({ deciding: undefined, error: undefined, records: [PUSH_RUNNING, RESET] });
  });

  it("keeps an outcome a read brought while the approval's answer was on its way", async () => {
    // The order the server allows: the POST admits the run, the run finishes, a read brings `ran`, and only then does the
    // POST's own answer, `approved`, land. The last change event has already come, so no later read would fix it.
    const answer = held();
    let reads = 0;
    const { calls, store } = routes((_path, init) => {
      if (init.method === "POST") return answer.promise;
      reads += 1;
      return json(200, [reads === 1 ? PUSH : PUSH_RAN]);
    });
    await store.retry();
    const sent = store.approve(PUSH.id);
    await store.retry();
    expect(store.getSnapshot().records).toEqual([PUSH_RAN]);
    answer.release(json(200, PUSH_RUNNING));
    expect(await sent).toBe(true);
    expect(store.getSnapshot().records).toEqual([PUSH_RAN]);
    await settle();
    expect(store.getSnapshot().records).toEqual([PUSH_RAN]);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(3);
  });

  it("never lets an admission undo any outcome: failed or refused stays", async () => {
    for (const outcome of [PUSH_FAILED, PUSH_REFUSED]) {
      const answer = held();
      let reads = 0;
      const { store } = routes((_path, init) => {
        if (init.method === "POST") return answer.promise;
        reads += 1;
        return json(200, [reads === 1 ? PUSH : outcome]);
      });
      await store.retry();
      const sent = store.approve(PUSH.id);
      await store.retry();
      answer.release(json(200, PUSH_RUNNING));
      await sent;
      expect(store.getSnapshot().records).toEqual([outcome]);
      await settle();
      expect(store.getSnapshot().records).toEqual([outcome]);
    }
  });

  it("reads once more after a choice, so an outcome in a read the answer retired still arrives", async () => {
    // A read that started after the POST holds `ran`, but the POST's answer lands first and retires it.
    const answer = held();
    const inFlight = held();
    let reads = 0;
    const { calls, store } = routes((_path, init) => {
      if (init.method === "POST") return answer.promise;
      reads += 1;
      return reads === 1 ? json(200, [PUSH]) : reads === 2 ? inFlight.promise : json(200, [PUSH_RAN]);
    });
    await store.retry();
    const sent = store.approve(PUSH.id);
    const retired = store.retry();
    answer.release(json(200, PUSH_RUNNING));
    expect(await sent).toBe(true);
    inFlight.release(json(200, [PUSH_RAN]));
    await retired;
    await settle();
    expect(store.getSnapshot().records).toEqual([PUSH_RAN]);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET", "GET"]);
  });

  it("refuses with the cwd", async () => {
    const { calls, store } = routes((_path, init) => init.method === "POST" ? json(200, PUSH_REFUSED) : json(200, [PUSH]));
    await store.retry();
    expect(await store.refuse(PUSH.id)).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toEqual([{ path: "/api/sessions/s%201/gated-actions/g%3A21%3A184/refuse", method: "POST", body: { cwd: "/srv/app" } }]);
    expect(store.getSnapshot().records).toEqual([PUSH_REFUSED]);
  });

  it("adds a record it had not read yet", async () => {
    const { store } = routes((_path, init) => init.method === "POST" ? json(200, PUSH_RUNNING) : json(200, [RESET]));
    await store.retry();
    await store.approve(PUSH.id);
    expect(store.getSnapshot().records?.map((record) => record.id)).toEqual([PUSH.id, RESET.id]);
  });

  it("keeps the server's refusal on the action it was made on, reads again, and lets the reader dismiss it", async () => {
    let afterRefusal = false;
    const { calls, store } = routes((_path, init) => {
      if (init.method === "POST") { afterRefusal = true; return json(409, { error: "Gated action is not waiting" }); }
      return json(200, [afterRefusal ? PUSH_REFUSED : PUSH]);
    });
    await store.retry();
    expect(await store.approve(PUSH.id)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ deciding: undefined, error: { id: PUSH.id, message: "Gated action is not waiting" } });
    await settle();
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(store.getSnapshot().records).toEqual([PUSH_REFUSED]);
    store.dismissError();
    expect(store.getSnapshot().error).toBeUndefined();
  });

  it("says the status of a refusal with no reason, such as a missing action", async () => {
    const { store } = routes((_path, init) => init.method === "POST" ? new Response("gone", { status: 404 }) : json(200, [PUSH]));
    await store.retry();
    expect(await store.refuse("g-9")).toBe(false);
    expect(store.getSnapshot().error).toEqual({ id: "g-9", message: "HTTP 404" });
  });

  it("sends one choice at a time, and clears the last refusal when it sends the next", async () => {
    const reply = held();
    let posts = 0;
    const { calls, store } = routes((_path, init) => {
      if (init.method !== "POST") return json(200, [PUSH, RESET]);
      posts += 1;
      return posts === 1 ? json(500, { error: "Durable storage is unavailable." }) : reply.promise;
    });
    await store.retry();
    expect(await store.approve(PUSH.id)).toBe(false);
    const second = store.approve(PUSH.id);
    expect(store.getSnapshot().error).toBeUndefined();
    expect(await store.refuse(RESET.id)).toBe(false);
    reply.release(json(200, PUSH_RUNNING));
    expect(await second).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });

  it("approves several calls one after another, each as its own choice, and goes on past a failure", async () => {
    const { calls, store } = routes((path, init) => {
      if (init.method !== "POST") return json(200, [PUSH, RESET]);
      return path.includes(encodeURIComponent(RESET.id)) ? json(409, { error: "Gated action is not waiting" }) : json(200, PUSH_RUNNING);
    });
    await store.retry();
    expect(await store.approveAll([RESET.id, PUSH.id])).toBe(1);
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
      `/api/sessions/s%201/gated-actions/${encodeURIComponent(RESET.id)}/approve`, `/api/sessions/s%201/gated-actions/${encodeURIComponent(PUSH.id)}/approve`]);
    expect(store.getSnapshot()).toMatchObject({ deciding: undefined, error: { id: RESET.id, message: "Gated action is not waiting" } });
  });

  it("tells no one after it is disposed", async () => {
    const reply = held();
    const { store } = routes(() => reply.promise);
    let heard = 0;
    store.subscribe(() => { heard += 1; });
    const read = store.retry();
    store.dispose();
    reply.release(json(200, [PUSH]));
    await read;
    expect(heard).toBe(0);
  });
});
