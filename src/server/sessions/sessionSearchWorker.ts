import { parentPort, workerData } from "node:worker_threads";
import { searchRecord } from "./sessionSearchText.js";
import { SessionSearchIndex } from "./sessionSearchIndex.js";
import type { SearchWorkerOptions, SearchWorkerReply, SearchWorkerRequest, SearchWorkerResult } from "./sessionSearchProtocol.js";

const port = parentPort;
if (port === null) throw new Error("Session search requires a worker thread");
const send = (reply: SearchWorkerReply) => { port.postMessage(reply); };
const rawOptions = searchRecord(workerData);
if (typeof rawOptions?.["filePath"] !== "string" || typeof rawOptions["sessionsDir"] !== "string") throw new Error("Invalid session search worker options");
const options: SearchWorkerOptions = { filePath: rawOptions["filePath"], sessionsDir: rawOptions["sessionsDir"] };
const index = SessionSearchIndex.open({ ...options,
  log: (message) => { send({ kind: "log", message }); },
  onProgress: (status) => { send({ kind: "progress", index: status }); },
});
// Attach a rejection handler immediately; requests still receive the open error.
void index.catch((error: unknown) => { send({ kind: "log", message: `Session search index unavailable: ${String(error)}` }); });
let writes: Promise<unknown> = Promise.resolve();

async function run(request: SearchWorkerRequest): Promise<SearchWorkerResult> {
  if (request.kind === "close") {
    // A failed open owns no connection, but shutdown must still be possible.
    const store = await index.catch(() => undefined);
    store?.close();
    return undefined;
  }
  const store = await index;
  switch (request.kind) {
    case "search": await store.waitForDiscovery(); return store.search(request.query);
    case "matches": await store.waitForDiscovery(); return store.matches(request.sessionId, request.query);
    case "scan": await store.scan(); return undefined;
    case "refresh": await store.refreshFile(request.path); return undefined;
  }
}

port.on("message", (request: SearchWorkerRequest) => {
  // Reads can run between streaming chunks of a build. Writes remain serial.
  const read = request.kind === "search" || request.kind === "matches";
  const result = read ? run(request) : writes.then(() => run(request));
  if (!read) writes = result.catch(() => undefined);
  void result.then((value) => { send({ kind: "result", id: request.id, result: value }); }, (error: unknown) => {
    send({ kind: "error", id: request.id, error: String(error) });
  });
});
