import { describe, expect, it } from "vitest";
import { createReadTracker } from "./readReceipt";

const session = { id: "session/1", cwd: "/workspace" };
const signal = new AbortController().signal;
const catalog = (order = 7) => ({ catalogId: "epoch-1", sessions: [{ sessionId: session.id, cwd: session.cwd, completionOrder: order }] });
describe("guarded read receipts", () => {
  it("waits for the visible history to paint and rechecks cancellation before writing", async () => {
    const controller = new AbortController();
    let painted = () => {};
    const paint = new Promise<void>((resolve) => { painted = resolve; });
    const paths: string[] = [];
    const reads = createReadTracker({ request: async (path) => { paths.push(path); return Response.json(catalog()); } }, { isVisible: () => true, afterRender: () => paint });
    const receipt = await reads.capture(session, controller.signal);
    if (!receipt) throw new Error("Missing receipt");
    const acknowledging = reads.acknowledge(receipt, controller.signal);
    expect(paths).toEqual(["/api/sessions/unread"]);
    controller.abort(); painted(); await acknowledging;
    expect(paths).toEqual(["/api/sessions/unread"]);
  });
  it("acknowledges only the completion captured before loading the conversation", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const reads = createReadTracker({ request: async (path, init) => {
      calls.push({ path, init });
      return Response.json(path.endsWith("acknowledge") ? catalog(8) : catalog(7));
    } }, { isVisible: () => true });
    const receipt = await reads.capture(session, signal);
    if (!receipt) throw new Error("Missing receipt");
    await reads.acknowledge(receipt, signal);
    expect(calls[1]?.path).toBe("/api/sessions/session%2F1/unread/acknowledge");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ cwd: "/workspace", catalogId: "epoch-1", throughCompletionOrder: 7 });
  });
  it("does not mark another cwd's session as read", async () => {
    const reads = createReadTracker({ request: async () => Response.json(catalog()) }, { isVisible: () => true });
    expect(await reads.capture({ ...session, cwd: "/another-workspace" }, signal)).toBeUndefined();
  });
  it("does not acknowledge when the reader switches away or hides the page", async () => {
    let visible = true;
    const paths: string[] = [];
    const reads = createReadTracker({ request: async (path) => { paths.push(path); return Response.json(catalog()); } }, { isVisible: () => visible });
    const receipt = await reads.capture(session, signal);
    if (!receipt) throw new Error("Missing receipt");
    visible = false;
    await reads.acknowledge(receipt, signal);
    expect(paths).toEqual(["/api/sessions/unread"]);
  });
  it("reports a failed acknowledgement rather than pretending unread state changed", async () => {
    const reads = createReadTracker({ request: async (path) => path.endsWith("acknowledge") ? new Response(null, { status: 503 }) : Response.json(catalog()) }, { isVisible: () => true });
    const receipt = await reads.capture(session, signal);
    if (!receipt) throw new Error("Missing receipt");
    await expect(reads.acknowledge(receipt, signal)).rejects.toThrow("503");
  });
});
