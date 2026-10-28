// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODEL_CHAIN_SWITCH_KIND } from "@shared/apiTypes";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { PiMessage, SessionStatus } from "./contracts";
import { ModelPrefsContext } from "./models/modelPrefsApi";
import { ChainWait } from "./models/ChainWait.binding";
import type { ChainWaitRenderer } from "./models/chainWait";
import { chainPrefsSource } from "./models/fixtures/chainPrefs";
import { MODELS } from "./models/fixtures/chains";

let root: Root;
let server: WebSocketServer;
let status: SessionStatus;
let history: PiMessage[];
let request: { mock: { calls: [string, RequestInit][] } };
const gpt5 = MODELS[2]!;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const until = async (condition: () => boolean) => { await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); }); };
const trigger = () => document.querySelector<HTMLButtonElement>(".composer .model-trigger");
const calls = (suffix: string) => request.mock.calls.filter(([path]) => new URL(path, "http://x").pathname.endsWith(suffix));
const chainWait: ChainWaitRenderer = (view) => <ChainWait {...view} />;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  status = { ...idle, model: gpt5, modelChain: "worker", thinkingLevel: "medium" };
  history = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  request = vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    const { pathname } = new URL(path, "http://x");
    if (pathname === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (pathname.endsWith("/messages")) return Response.json({ messages: history, start: 0, total: history.length });
    if (pathname.endsWith("/stream-snapshot")) return Response.json({ partial: null, seq: 0 });
    if (pathname.endsWith("/status")) return Response.json(status);
    if (pathname.endsWith("/commands")) return Response.json([]);
    if (pathname.endsWith("/models")) return Response.json({ models: MODELS });
    if (pathname.endsWith("/thinking-levels")) return Response.json({ levels: ["off", "medium", "high"] });
    if (pathname.endsWith("/model") && init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { modelChain?: string; provider?: string; modelId?: string };
      status = body.modelChain !== undefined ? { ...status, modelChain: body.modelChain, model: MODELS[1] }
        : { ...status, modelChain: undefined, model: MODELS.find((model) => model.provider === body.provider && model.id === body.modelId) };
      return Response.json(status);
    }
    if (pathname.endsWith("/abort")) { status = { ...status, chainWait: undefined }; return Response.json({ aborted: true, restoredMessages: [] }); }
    throw new Error(`Unexpected request ${path}`);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function render(renderer?: ChainWaitRenderer) {
  await act(async () => root.render(<ModelPrefsContext.Provider value={chainPrefsSource()}>
    <ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} chainWait={renderer} />
  </ModelPrefsContext.Provider>));
}

it("shows the session's chain and active entry, and moves it to another chain from the composer's picker", async () => {
  await render();
  await until(() => trigger()?.disabled === false && trigger()?.textContent?.includes("worker") === true);
  expect(trigger()!.querySelector(".model-trigger-name")?.textContent).toBe("GPT-5");
  await act(async () => trigger()!.click());
  await until(() => document.querySelector(".option-list-heading")?.textContent === "Model chains");
  const fast = [...document.querySelectorAll<HTMLElement>(".option-row")].find((row) => row.textContent?.startsWith("fast"))!;
  await act(async () => fast.click());
  await until(() => calls("/model").length === 1);
  expect(JSON.parse(String(calls("/model")[0]![1]?.body))).toEqual({ cwd: "/work", modelChain: "fast" });
  await until(() => trigger()?.querySelector(".model-trigger-choice")?.textContent === "fast");
  expect(trigger()!.querySelector(".model-trigger-name")?.textContent).toBe("Claude Haiku 4.5");
});

it("counts down a chain's wait above the input, names the next model, and Stop ends it", async () => {
  status = { ...status, model: MODELS[0], chainWait: { from: "anthropic/claude-opus-5-5:high", error: "429 Too Many Requests", until: Date.now() + 42_000 } };
  await render(chainWait);
  await until(() => document.querySelector(".readout-line")?.textContent?.includes("then GPT-5") === true);
  const line = document.querySelector(".readout-line")!;
  expect(line.textContent).toMatch(/^Waiting 0:4[12] for Claude Opus 5\.5 \(High\), then GPT-5Stop$/u);
  expect(line.querySelector("[title]")?.getAttribute("title")).toBe("429 Too Many Requests");
  await act(async () => [...line.querySelectorAll("button")].find((button) => button.textContent === "Stop")!.click());
  await until(() => calls("/abort").length === 1);
});

it("leaves Stop to the input bar while the run runs, and names no next model without the app's chains", async () => {
  status = { ...status, isStreaming: true, chainWait: { from: "openai/gpt-5", error: "", until: Date.now() + 30_000 } };
  await render();
  await until(() => document.querySelector(".readout-line")?.textContent?.startsWith("Waiting") === true);
  expect(document.querySelector(".readout-line")!.textContent).toMatch(/^Waiting 0:(29|30) for GPT-5$/u);
  expect(document.querySelector(".readout-line button")).toBeNull();
  expect(document.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
});

it("draws a chain switch in the thread as a quiet line with the models' names", async () => {
  status = { ...idle, model: gpt5 };
  history = [{ role: "user", content: "Fix the build", timestamp: 1 },
    { role: "custom", customType: MODEL_CHAIN_SWITCH_KIND, timestamp: 2, content: "",
      details: { from: "anthropic/claude-opus-5-5:high", to: "openai/gpt-5", error: "429 Too Many Requests" } }];
  await render();
  await until(() => document.querySelector(".event-line-subject")?.textContent === "GPT-5");
  const line = document.querySelector(".event-line")!;
  expect(line.querySelector(".event-line-phrase")?.textContent).toBe("took over from Claude Opus 5.5 (High)");
  expect(line.querySelector(".event-line-code")?.textContent).toBe("429 Too Many Requests");
  expect(document.querySelector(".message-system")).toBeNull();
});
