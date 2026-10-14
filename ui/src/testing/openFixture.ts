import { historySchema, sessionOpenSchema, snapshotSchema, statusSchema, type SessionOpen } from "../contracts";

/** Fixture data only. Production consistency is tested through the server acquisition contract. */
export function openFixture(options: { session?: SessionOpen["session"]; page?: unknown; snapshot?: unknown; status?: unknown;
  epoch?: string; historyId?: string; receipt?: SessionOpen["receipt"]; readPath?: "classic" | "native";
  tools?: SessionOpen["snapshot"]["tools"]; transientEvents?: SessionOpen["snapshot"]["transientEvents"] } = {}): SessionOpen {
  const page = historySchema.parse(options.page ?? { messages: [], start: 0, total: 0 });
  const snapshot = snapshotSchema.parse(options.snapshot ?? { seq: 0, partial: null });
  return sessionOpenSchema.parse({ session: options.session ?? { id: "known", cwd: "/workspace" }, readPath: options.readPath ?? "classic",
    epoch: options.epoch ?? "test-daemon", historyId: options.historyId ?? "test-history", seq: snapshot.seq, page,
    snapshot: { ...snapshot, tools: options.tools ?? [], transientEvents: options.transientEvents ?? [] },
    status: statusSchema.parse(options.status ?? { isStreaming: false, isCompacting: false, isBashRunning: false }), receipt: options.receipt ?? null });
}

/** Adapt existing in-memory route fixtures. No fetch, socket, or production reader is replaced. */
export function withOpenFixture(respond: (path: string, init: RequestInit) => Promise<Response>): (path: string, init: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const url = new URL(path, "http://fixture");
    if (!url.pathname.endsWith("/open")) return respond(path, init);
    const session = { id: decodeURIComponent(url.pathname.split("/").at(-2) ?? "known"), cwd: url.searchParams.get("cwd") ?? "/workspace" };
    const source = (endpoint: string) => respond(path.replace("/open?", `/${endpoint}?`), init);
    const history = await source("messages"); if (!history.ok) return history;
    const snapshot = await source("stream-snapshot"); if (!snapshot.ok) return snapshot;
    const status = await source("status"); if (!status.ok) return status;
    return Response.json(openFixture({ session, page: await history.json(), snapshot: await snapshot.json(), status: await status.json() }));
  };
}
