// @vitest-environment happy-dom
import { act } from "react";
import type { Window as HappyWindow } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { PendingSession } from "./app/PendingSession.binding";
import { browserTransport } from "./sessionStore";
import { createNewSessionApi } from "./newSession";
import { createWorktreeApi } from "./worktrees/worktreeApi";
import { createOpenServer, openFixture } from "./testing/openFixture";
import type { ComposerInputElement } from "./ui/ComposerEditor";

let root: Root;
let server: Awaited<ReturnType<typeof createOpenServer>>;
function responseGate() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
let creation: ReturnType<typeof responseGate>;
let prompt: ReturnType<typeof responseGate>;
const model = { provider: "p", id: "opus", name: "Opus", reasoning: true };
const session = { id: "real-session", cwd: "/workspace", name: "New work" };
const dialog = () => document.querySelector<HTMLDialogElement>(".ns-dialog");
const input = () => document.querySelector<ComposerInputElement>(".ns-dialog [data-composer-input]")!;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text)!;
const until = async (check: () => boolean) => { await act(async () => { await expect.poll(check, { timeout: 3000 }).toBe(true); }); };
const params = () => new URLSearchParams(window.location.search);
const visibleShell = () => [...document.querySelectorAll(".session-shell")].find(node => !node.closest('[style*="display: none"]'));

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.localStorage.clear();
  creation = responseGate(); prompt = responseGate();
  server = await createOpenServer(url => {
    if (url.pathname === "/api/sessions/all") return { sessions: [{ id: "old", cwd: "/workspace", name: "Old session", modified: new Date().toISOString() }], statuses: [], activities: [] };
    if (url.pathname === "/api/sessions/asks") return { sessions: [] };
    if (url.pathname === "/api/sessions/unread") return { catalogId: "test", sessions: [] };
    if (url.pathname === "/api/machines/local/projects") return [];
    if (url.pathname === "/api/github/pulls" || url.pathname === "/api/github/action-runs") return { links: [] };
    if (url.pathname === "/api/projects") return [{ id: "p1", name: "Workspace", path: "/workspace" }];
    if (url.pathname === "/api/projects/p1/workspaces") return [{ id: "main", projectId: "p1", label: "main", path: "/workspace", isMain: true }];
    if (url.pathname.endsWith("/prompt-resource-catalog")) return { available: true, commands: [] };
    if (url.pathname === "/api/models") return { models: [model], model, thinkingLevel: "high" };
    if (url.pathname === "/api/sessions/worktree-options") return { kind: "git", repo: "/workspace", defaultBranch: "main", defaultCwd: "/workspace", defaultDestination: "existing-workspace" };
    if (url.pathname === "/api/sessions/worktrees") return { worktrees: [] };
    if (url.pathname === "/api/sessions") return creation.promise;
    if (url.pathname === "/api/sessions/real-session/prompt") return prompt.promise;
    if (url.pathname.endsWith("/open")) return openFixture({ session: url.pathname.includes("/old/") ? { id: "old", cwd: "/workspace", name: "Old session" } : session });
    if (url.pathname.endsWith("/commands")) return [];
    return Response.json({ error: "Panel unavailable in fixture" }, { status: 404 });
  });
  (window as unknown as HappyWindow).happyDOM.setURL(`${server.origin}/?session=old`);
  window.history.replaceState({}, "", "/?session=old");
  window.history.pushState({}, "", "/?session=old&new=/workspace&place=existing");
  vi.spyOn(browserTransport, "request").mockImplementation(server.transport.request);
  vi.spyOn(browserTransport, "connect").mockImplementation(server.transport.connect);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  const request = (path: string, init?: RequestInit) => server.transport.request(path, init ?? {});
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root.render(<App pendingSession={(launch, recovery) => <PendingSession launch={launch} recovery={recovery} />} newSessions={{ api: createNewSessionApi(request), worktrees: createWorktreeApi(request) }} />));
  await until(() => dialog()?.open === true && document.querySelector(".model-trigger")?.textContent?.includes("Opus") === true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  creation.resolve(Response.json({ error: "Test ended" }, { status: 400 }));
  prompt.resolve(Response.json({ accepted: true }));
  await server.close();
  document.body.replaceChildren(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function type(text: string) {
  await act(async () => { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function send(text = "Fix the build") {
  await type(text);
  await act(async () => button("Start session").click());
}
async function succeed() {
  await act(async () => { creation.resolve(Response.json(session)); prompt.resolve(Response.json({ accepted: true })); });
  await until(() => params().get("session") === session.id);
}

it("closes the modal and renders the prompt before the create API answers, then replaces the same history entry", async () => {
  const original = dialog(); const historyLength = window.history.length;
  await send();
  expect(original).not.toBeNull(); expect(dialog()).toBeNull();
  expect(document.querySelector("dialog[open]")).toBeNull();
  const token = params().get("launch"); expect(token).toMatch(/^start-/u);
  expect(params().has("session")).toBe(false);
  expect(visibleShell()?.querySelector(".message-text")?.textContent).toBe("Fix the build");
  expect(visibleShell()?.textContent).toContain("Starting…");
  await until(() => server.sockets.clients.size > 0 && document.getElementById("picker-row-old") !== null);
  await act(async () => server.emit({ type: "session.startup", startupToken: token, activity: { sessionId: "", phase: "active", label: "Creating session", detail: "Refreshing provider models" } }));
  await until(() => visibleShell()?.textContent?.includes("Refreshing provider models") === true);
  expect(server.requests.some(url => url.pathname.includes(token!))).toBe(false);
  await succeed();
  expect(window.history.length).toBe(historyLength);
  expect(params().has("launch")).toBe(false); expect(params().has("new")).toBe(false);
  expect(dialog()).toBeNull();
  await until(() => server.requests.some(url => url.pathname === "/api/sessions/real-session/open"));
  await act(async () => window.history.back());
  await until(() => params().get("session") === "old");
  expect(params().has("new")).toBe(false);
});

it("keeps the pending transcript and closed dialog when its own launch row is selected", async () => {
  const original = dialog();
  await send();
  const token = params().get("launch")!;
  await until(() => document.getElementById(`picker-row-${token}`) !== null);
  await act(async () => document.getElementById(`picker-row-${token}`)!.click());
  expect(params().get("launch")).toBe(token);
  expect(params().has("new")).toBe(false);
  expect(original).not.toBeNull(); expect(dialog()).toBeNull();
  expect(visibleShell()?.querySelector(".message-text")?.textContent).toBe("Fix the build");
  await succeed();
});

it("keeps Close sessions and Escape available while the pending transcript is open", async () => {
  await send();
  await act(async () => visibleShell()!.querySelector<HTMLButtonElement>('[aria-label="Sessions"]')!.click());
  expect(document.querySelector(".app-shell")?.getAttribute("data-sheet")).toBe("open");
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close sessions"]');
  expect(close).not.toBeNull();
  await act(async () => close!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector(".app-shell")?.getAttribute("data-sheet")).toBe("closed");
  expect(params().has("launch")).toBe(true);
  await succeed();
});

it("shows the failure instead of startup when Forward returns to a failed background launch", async () => {
  await send();
  const token = params().get("launch");
  await act(async () => window.history.back());
  await until(() => params().get("session") === "old" && !params().has("new"));
  await act(async () => creation.resolve(Response.json({ error: "Unknown model from fixture" }, { status: 400 })));
  await until(() => document.querySelector(".toast")?.textContent?.includes("did not start") === true);
  await act(async () => window.history.forward());
  await until(() => params().get("launch") === token);
  expect(visibleShell()?.textContent).toContain("Start failed");
  expect(visibleShell()?.querySelector('[role="alert"]')?.textContent).toContain("Unknown model from fixture");
  expect(visibleShell()?.textContent).not.toContain("Opening…");
  expect(dialog()).toBeNull();
});

it("keeps a failed pending page and restores exact text and model only when requested", async () => {
  const destination = document.querySelector(".destination-value")?.textContent;
  const modelLabel = document.querySelector(".model-trigger")?.textContent;
  const text = "  Fix the build\n\nKeep this whitespace.  \n";
  await send(text);
  const token = params().get("launch");
  await act(async () => creation.resolve(Response.json({ error: "Unknown model from fixture" }, { status: 400 })));
  await until(() => visibleShell()?.textContent?.includes("Unknown model from fixture") === true);
  expect(dialog()).toBeNull(); expect(params().get("launch")).toBe(token);
  expect(document.getElementById(`picker-row-${token}`)?.getAttribute("data-state")).toBe("errored");
  await act(async () => button("Restore draft").click());
  await until(() => dialog()?.open === true && input().value === text);
  expect(document.querySelector(".destination-value")?.textContent).toBe(destination);
  expect(document.querySelector(".model-trigger")?.textContent).toBe(modelLabel);
  expect(document.querySelector(".ns-tray")).toBeNull();
  expect(params().get("place")).toBe("existing");
  expect(server.requests.filter(url => url.pathname === "/api/sessions")).toHaveLength(1);
});

it("keeps the maybe-started warning outside the dialog and never automatically retries", async () => {
  await send();
  await act(async () => creation.resolve(Response.json({ error: "Reply lost" }, { status: 503 })));
  await until(() => visibleShell()?.textContent?.includes("may have started anyway") === true);
  expect(dialog()).toBeNull();
  expect(server.requests.filter(url => url.pathname === "/api/sessions")).toHaveLength(1);
});

it("does not navigate on create alone; an unsent first message opens the real session with its warning and draft", async () => {
  await send();
  await act(async () => creation.resolve(Response.json(session)));
  await until(() => server.requests.some(url => url.pathname === "/api/sessions/real-session/prompt"));
  expect(params().has("launch")).toBe(true); expect(params().has("session")).toBe(false);
  await act(async () => prompt.resolve(Response.json({ error: "Prompt refused" }, { status: 400 })));
  await until(() => params().get("session") === session.id);
  await until(() => document.querySelector(".composer-input")?.textContent?.includes("Fix the build") === true || document.querySelector<ComposerInputElement>(".composer [data-composer-input]")?.value === "Fix the build");
  expect(document.body.textContent).toContain("first message may not have reached Pi");
});

it.each(["success", "failure"])("does not hijack Back when a delayed %s arrives", async outcome => {
  await send();
  await act(async () => window.history.back());
  await until(() => params().get("session") === "old" && !params().has("new"));
  await act(async () => {
    creation.resolve(outcome === "success" ? Response.json(session) : Response.json({ error: "Start failed" }, { status: 503 }));
    prompt.resolve(Response.json({ accepted: true }));
  });
  await until(() => outcome === "success" ? server.requests.some(url => url.pathname.endsWith("/real-session/prompt")) : document.querySelector(".toast")?.textContent?.includes("did not start") === true);
  expect(params().get("session")).toBe("old"); expect(dialog()).toBeNull();
  if (outcome === "success") {
    await act(async () => window.history.forward());
    await until(() => params().get("session") === session.id);
    expect(params().has("launch")).toBe(false);
  }
});

it("does not hijack a deliberate session selection when the launch completes", async () => {
  await send();
  await until(() => document.getElementById("picker-row-old") !== null);
  await act(async () => document.getElementById("picker-row-old")!.click());
  await act(async () => { creation.resolve(Response.json(session)); prompt.resolve(Response.json({ accepted: true })); });
  await until(() => server.requests.some(url => url.pathname.endsWith("/real-session/prompt")));
  expect(params().get("session")).toBe("old"); expect(dialog()).toBeNull();
});

it.each(["success", "failure"])("does not hijack Settings when a delayed %s arrives", async outcome => {
  await send();
  const settings = [...document.querySelectorAll<HTMLButtonElement>(".picker-footer button")]
    .find(node => node.textContent?.trim() === "Settings" || node.getAttribute("aria-label") === "Settings")!;
  await act(async () => settings.click());
  expect(params().get("settings")).toBe("root"); expect(params().has("launch")).toBe(false);
  await act(async () => {
    creation.resolve(outcome === "success" ? Response.json(session) : Response.json({ error: "Start failed" }, { status: 503 }));
    prompt.resolve(Response.json({ accepted: true }));
  });
  await until(() => outcome === "success" ? server.requests.some(url => url.pathname.endsWith("/real-session/prompt")) : document.querySelector(".toast")?.textContent?.includes("did not start") === true);
  expect(params().get("settings")).toBe("root"); expect(dialog()).toBeNull();
});

it("keeps validation refusals in the modal without opening a pending page", async () => {
  await send("!ls");
  expect(dialog()?.open).toBe(true); expect(params().has("launch")).toBe(false);
  expect(document.querySelector(".ns-error")?.textContent).toContain("Shell commands need a running session");
  expect(input().value).toBe("!ls");
  expect(server.requests.some(url => url.pathname === "/api/sessions")).toBe(false);
});

it("closes Rapidfire at once and shows the pending prompt before the API answers", async () => {
  await act(async () => button("Rapidfire").click()); await type("Background work");
  await act(async () => button("Start in background").click());
  expect(dialog()).toBeNull(); expect(params().has("launch")).toBe(true);
  expect(visibleShell()?.textContent).toContain("Background work");
  await succeed();
});

it("does not carry an old explicit branch placement into a fresh dialog", async () => {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close new session"]')!.click());
  await until(() => dialog() === null);
  window.history.replaceState({}, "", "/?session=old&place=existing");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ctrlKey: true })));
  await until(() => dialog()?.open === true);
  expect(params().has("place")).toBe(false);
});
