// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSession } from "./NewSession";
import type { NewSessionApi, Project, Workspace, AgentChoice } from "./newSession";
import type { Session, SessionModel } from "./contracts";
import { createDraftStore } from "./draftStore";

let root: Root;
const opus: SessionModel = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, scoped: true };
const haiku: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true };
const projects: Project[] = [{ id: "p1", name: "forgerie", path: "/code/forgerie" }, { id: "p2", name: "korri", path: "/code/korri" }];
const workspaces: Record<string, Workspace[]> = {
  p1: [{ id: "w1", path: "/code/forgerie", label: "main", branch: "main", isMain: true },
    { id: "w2", path: "/code/forgerie/.worktree/ui", label: "ui", branch: "feat/ui", isMain: false }],
  p2: [{ id: "w3", path: "/code/korri", label: "main", branch: "main", isMain: true }],
};
type StartResult = Awaited<ReturnType<NewSessionApi["start"]>>;

/** A configurable new-session API: real promises, scripted outcomes. */
function scriptedApi(outcome: (cwd: string, text: string, choice: AgentChoice) => StartResult = (cwd) => ({ type: "started", session: { id: "s-new", cwd } })) {
  const starts: { cwd: string; text: string; choice: AgentChoice }[] = [];
  const modelReads: string[] = [];
  const api: NewSessionApi = {
    projects: async () => projects,
    workspaces: async (projectId) => workspaces[projectId] ?? [],
    models: async (cwd) => { modelReads.push(cwd); return { models: cwd === "/code/korri" ? [haiku] : [opus, haiku], model: cwd === "/code/korri" ? haiku : opus, thinkingLevel: "high" }; },
    start: async (cwd, text, choice) => { starts.push({ cwd, text, choice }); return outcome(cwd, text, choice); },
  };
  return { api, starts, modelReads };
}
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };
const settle = () => act(async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(api: NewSessionApi, onStarted: (session: Session, unsent?: { draft: string; error: string }) => void = () => {}, drafts = createDraftStore(storage())) {
  await act(async () => root.render(<NewSession cwd="/code/forgerie" api={api} drafts={drafts} onStarted={onStarted} />));
  await settle();
}
const textarea = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim().startsWith(name) || node.getAttribute("aria-label")?.startsWith(name));
const click = async (node: HTMLElement | undefined) => { await act(async () => node!.click()); await settle(); };
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), text);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const send = async () => { await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" })); }); await settle(); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("starting a new session", () => {
  it("names where it starts and Pi's default model, and has no attach button", async () => {
    await render(scriptedApi().api);
    expect(document.querySelector(".session-title")!.textContent).toBe("New session");
    expect(document.querySelector(".destination-value")!.textContent).toBe("forgerie");
    expect(document.querySelector(".model-trigger")!.textContent).toContain("Claude Opus 5.5");
    expect(document.querySelector(".model-trigger")!.textContent).toContain("High");
    expect(button("Add attachment")).toBeUndefined();
  });

  it("creates the session with the first message, then hands it over", async () => {
    const script = scriptedApi();
    const onStarted = vi.fn();
    await render(script.api, onStarted);
    await type("Fix the build");
    await send();
    // The model and level the bar shows are the ones the session starts with.
    expect(script.starts).toEqual([{ cwd: "/code/forgerie", text: "Fix the build", choice: { model: opus, thinkingLevel: "high" } }]);
    expect(onStarted).toHaveBeenCalledWith({ id: "s-new", cwd: "/code/forgerie" });
  });

  it("starts with the model and thinking level the author picked", async () => {
    const script = scriptedApi();
    await render(script.api);
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    await click(button("Claude Haiku 4.5", document.querySelector(".model-panel")!));
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    await click(button("Low", document.querySelector(".model-levels")!));
    await type("hi");
    await send();
    expect(script.starts[0]!.choice).toEqual({ model: haiku, thinkingLevel: "low" });
  });

  it("moves to another workspace, and reads that folder's models", async () => {
    const script = scriptedApi();
    await render(script.api);
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    const panel = () => document.querySelector<HTMLElement>(".destination-panel")!;
    expect(document.activeElement).toBe(panel());
    await click(button("forgerie", panel()));
    await click(button("feat/ui", panel()));
    expect(document.querySelector(".destination-panel")).toBeNull();
    expect(document.querySelector(".destination-value")!.textContent).toBe("forgerie · feat/ui");
    expect(script.modelReads.at(-1)).toBe("/code/forgerie/.worktree/ui");
    await type("hi");
    await send();
    expect(script.starts[0]!.cwd).toBe("/code/forgerie/.worktree/ui");
  });

  it("chooses a project with one checkout in one step, and drops a model that folder lacks", async () => {
    const script = scriptedApi();
    await render(script.api);
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    await click(button("Claude Opus 5.5", document.querySelector(".model-panel")!));
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    await click(button("korri", document.querySelector(".destination-panel")!));
    expect(document.querySelector(".destination-value")!.textContent).toBe("korri");
    expect(document.querySelector(".model-trigger")!.textContent).toContain("Claude Haiku 4.5");
  });

  it("keeps the message and says why when the session did not start", async () => {
    const script = scriptedApi(() => ({ type: "failed", failure: { stage: "start", message: "No such folder", maybeStarted: false } }));
    const onStarted = vi.fn();
    await render(script.api, onStarted);
    await type("Fix the build");
    await send();
    expect(onStarted).not.toHaveBeenCalled();
    expect(textarea().value).toBe("Fix the build");
    expect(document.querySelector(".notice")!.textContent).toBe("The session did not start: No such folder");
  });

  it("warns that a session may exist when the reply was lost, and never starts again by itself", async () => {
    const script = scriptedApi(() => ({ type: "failed", failure: { stage: "start", message: "Network error.", maybeStarted: true } }));
    await render(script.api);
    await type("hi");
    await send();
    expect(document.querySelector(".notice")!.textContent).toMatch(/may have started anyway/);
    expect(script.starts).toHaveLength(1);
  });

  it("opens the session it made when only the first message failed, with the message back in the draft", async () => {
    const script = scriptedApi((cwd) => ({ type: "failed", failure: { stage: "prompt", session: { id: "s-new", cwd }, message: "Network error." } }));
    const onStarted = vi.fn();
    await render(script.api, onStarted);
    await type("Fix the build");
    await send();
    expect(onStarted).toHaveBeenCalledWith({ id: "s-new", cwd: "/code/forgerie" },
      expect.objectContaining({ draft: "Fix the build", error: expect.stringMatching(/may not have reached Pi/) }));
  });

  it("refuses a shell command before any session exists", async () => {
    const script = scriptedApi();
    await render(script.api);
    await type("!ls");
    await send();
    expect(script.starts).toEqual([]);
    expect(textarea().value).toBe("!ls");
    expect(document.querySelector(".notice")!.textContent).toMatch(/Shell commands need a running session/);
  });

  it("keeps the unsent first message across a reload", async () => {
    const drafts = createDraftStore(storage());
    await render(scriptedApi().api, () => {}, drafts);
    await type("half a thought");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await render(scriptedApi().api, () => {}, drafts);
    expect(textarea().value).toBe("half a thought");
  });
});
