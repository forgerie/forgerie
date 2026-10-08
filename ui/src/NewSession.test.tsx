// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSession, type LaunchDraft, type LaunchMode } from "./NewSession";
import { createDeferredFiles, type AgentChoice, type FirstPrompt, type NewSessionApi, type Project, type PromptResource, type Workspace } from "./newSession";
import type { Session, SessionModel } from "./contracts";
import { createDraftStore, type DraftStore } from "./draftStore";
import { createLaunchStore } from "./launches";

let root: Root;
const opus: SessionModel = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, scoped: true };
const haiku: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true };
const projects: Project[] = [{ id: "p1", name: "forgerie", path: "/code/forgerie" }, { id: "p2", name: "korri", path: "/code/korri" }];
const workspaces: Record<string, Workspace[]> = {
  p1: [{ id: "w1", path: "/code/forgerie", label: "main", branch: "main", isMain: true },
    { id: "w2", path: "/code/forgerie/.worktree/ui", label: "ui", branch: "feat/ui", isMain: false }],
  p2: [{ id: "w3", path: "/code/korri", label: "main", branch: "main", isMain: true }],
};
const testing: PromptResource = { name: "skill:testing", source: "skill", identity: { source: "skill", name: "skill:testing", fingerprint: "f1" }, description: "Write tests" };
type StartResult = Awaited<ReturnType<NewSessionApi["start"]>>;

/** A configurable new-session API: real promises, scripted outcomes. */
function scriptedApi(outcome: (cwd: string, text: string, choice: AgentChoice) => StartResult | Promise<StartResult> = (cwd) => ({ type: "started", session: { id: "s-new", cwd } })) {
  const starts: { cwd: string; text: string; choice: AgentChoice; prompt: FirstPrompt }[] = [];
  const modelReads: string[] = [];
  const api: NewSessionApi = {
    projects: async () => projects,
    workspaces: async (projectId) => workspaces[projectId] ?? [],
    models: async (cwd) => { modelReads.push(cwd); return { models: cwd === "/code/korri" ? [haiku] : [opus, haiku], model: cwd === "/code/korri" ? haiku : opus, thinkingLevel: "high" }; },
    promptResources: async () => [testing],
    start: async (cwd, first, choice) => {
      const prompt = typeof first === "string" ? { text: first } : first;
      starts.push({ cwd, text: prompt.text, choice, prompt });
      return outcome(cwd, prompt.text, choice);
    },
  };
  return { api, starts, modelReads };
}
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; };
const settle = () => act(async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); });
interface Options { onStarted?: (session: Session, unsent?: { draft: string; error: string }) => void; drafts?: DraftStore; onClose?: () => void;
  onDestination?: (cwd: string) => void; mode?: LaunchMode }
async function render(api: NewSessionApi, options: Options = {}) {
  const launches = createLaunchStore<LaunchDraft>(api);
  await act(async () => root.render(<NewSession cwd="/code/forgerie" api={api} launches={launches} deferred={createDeferredFiles()} drafts={options.drafts ?? createDraftStore(storage())}
    onStarted={options.onStarted ?? (() => {})} onClose={options.onClose ?? (() => {})} onDestination={options.onDestination} initialMode={options.mode} />));
  await settle();
  return launches;
}
const dialog = () => document.querySelector<HTMLDialogElement>("dialog.ns-dialog");
const textarea = () => document.querySelector<HTMLTextAreaElement>(".ns-dialog .composer textarea")!;
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim().startsWith(name) || node.getAttribute("aria-label")?.startsWith(name));
const click = async (node: HTMLElement | undefined) => { await act(async () => node!.click()); await settle(); };
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), text);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const send = async () => { await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ctrlKey: true })); }); await settle(); };
const error = () => document.querySelector(".ns-error")?.textContent;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("the new-session dialog", () => {
  it("opens as a titled window: where and with what, a writing area, what it carries, and the decision", async () => {
    await render(scriptedApi().api);
    expect(dialog()?.open).toBe(true);
    expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)?.textContent).toBe("New session");
    expect(document.querySelector(".ns-context .destination-value")!.textContent).toBe("forgerie");
    expect(document.querySelector(".ns-context .model-trigger")!.textContent).toContain("Claude Opus 5.5");
    expect(document.querySelector(".ns-context .model-trigger")!.textContent).toContain("High");
    expect(button("Attach", document.querySelector(".ns-chips")!)).toBeDefined();
    expect(button("Rapidfire")?.getAttribute("aria-pressed")).toBe("false");
    expect(button("Discard draft", document.querySelector(".ns-foot")!)).toBeDefined();
    expect(button("Start session", document.querySelector(".ns-foot")!)).toBeDefined();
    expect(textarea().placeholder).toBe("Describe what the agent should do first…");
  });

  it("shares focus and Android modifier handling without changing Ctrl+Enter to start", async () => {
    const script = scriptedApi(); await render(script.api); await type("first message");
    const original = window.matchMedia.bind(window);
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = original(query);
      if (query === "(pointer: coarse)") Object.defineProperty(result, "matches", { value: true });
      return result;
    });
    try {
      const key = (key: string, init: KeyboardEventInit = {}) => act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
      const discard = button("Discard draft")!; discard.focus();
      await act(async () => {
        const event = new KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
        // happy-dom treats left Alt as AltGraph; browsers distinguish them.
        Object.defineProperty(event, "getModifierState", { value: (modifier: string) => modifier === "Control" || modifier === "Alt" });
        discard.dispatchEvent(event);
      });
      expect(document.activeElement).toBe(textarea());
      const nested = document.createElement("dialog"); nested.setAttribute("open", ""); dialog()!.append(nested);
      const nestedButton = document.createElement("button"); nested.append(nestedButton); nestedButton.focus();
      await act(async () => {
        const event = new KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
        Object.defineProperty(event, "getModifierState", { value: () => false });
        nestedButton.dispatchEvent(event);
      });
      expect(document.activeElement).toBe(nestedButton); nested.remove(); textarea().focus();
      textarea().setSelectionRange(13, 13); await key("Shift"); await key("Enter", { ctrlKey: true });
      expect(textarea().value).toBe("first message\n"); expect(script.starts).toEqual([]);
      await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true })); });
      await send(); expect(script.starts).toHaveLength(1);
    } finally { media.mockRestore(); }
  });

  it("keeps a plain Enter as a new line; only Ctrl or Cmd+Enter starts", async () => {
    const script = scriptedApi();
    await render(script.api);
    await type("line one");
    await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" })); });
    await settle();
    expect(script.starts).toEqual([]);
  });

  it("discards the draft and its saved copy", async () => {
    const drafts = createDraftStore(storage());
    await render(scriptedApi().api, { drafts });
    await type("not this one");
    await click(button("Discard draft"));
    expect(textarea().value).toBe("");
    expect(drafts.session("new-session").chat()).toBe("");
  });

  it("stays open when something nested inside it closes, such as the image viewer", async () => {
    const onClose = vi.fn();
    await render(scriptedApi().api, { onClose });
    await act(async () => {
      textarea().dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
      textarea().dispatchEvent(new Event("close", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()?.open).toBe(true);
  });

  it("mounts its pickers inside itself, so they are not inert behind the modal", async () => {
    await render(scriptedApi().api);
    await click(document.querySelector<HTMLButtonElement>(".model-trigger")!);
    expect(document.querySelector(".model-panel")?.parentElement).toBe(dialog());
    await act(async () => { document.querySelector(".model-panel")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })); });
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    expect(document.querySelector(".destination-panel")?.parentElement).toBe(dialog());
  });

  it("closes from Escape and Close, and keeps the draft for next time", async () => {
    const onClose = vi.fn();
    const drafts = createDraftStore(storage());
    await render(scriptedApi().api, { onClose, drafts });
    await type("half a thought");
    await act(async () => { dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    await click(button("Close new session"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(drafts.session("new-session").chat()).toBe("half a thought");
  });
});

describe("starting a new session", () => {
  it("creates the session with the first message, then hands it over", async () => {
    const script = scriptedApi();
    const onStarted = vi.fn();
    await render(script.api, { onStarted });
    await type("Fix the build");
    await send();
    // The model and level the bar shows are the ones the session starts with.
    expect(script.starts.map(({ cwd, text, choice }) => ({ cwd, text, choice }))).toEqual([{ cwd: "/code/forgerie", text: "Fix the build", choice: { model: opus, thinkingLevel: "high" } }]);
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
    const onDestination = vi.fn();
    await render(script.api, { onDestination });
    await click(document.querySelector<HTMLButtonElement>(".destination-trigger")!);
    const panel = () => document.querySelector<HTMLElement>(".destination-panel")!;
    await click(button("forgerie", panel()));
    await click(button("feat/ui", panel()));
    expect(document.querySelector(".destination-panel")).toBeNull();
    expect(document.querySelector(".destination-value")!.textContent).toBe("forgerie · feat/ui");
    expect(script.modelReads.at(-1)).toBe("/code/forgerie/.worktree/ui");
    expect(onDestination).toHaveBeenCalledWith("/code/forgerie/.worktree/ui");
    await type("hi");
    await send();
    expect(script.starts[0]!.cwd).toBe("/code/forgerie/.worktree/ui");
  });

  it("keeps the message and says why when the session did not start", async () => {
    const script = scriptedApi(() => ({ type: "failed", failure: { stage: "start", message: "No such folder", maybeStarted: false } }));
    const onStarted = vi.fn();
    await render(script.api, { onStarted });
    await type("Fix the build");
    await send();
    expect(onStarted).not.toHaveBeenCalled();
    expect(textarea().value).toBe("Fix the build");
    expect(error()).toBe("The session did not start: No such folder");
  });

  it("warns that a session may exist when the reply was lost, and never starts again by itself", async () => {
    const script = scriptedApi(() => ({ type: "failed", failure: { stage: "start", message: "Network error.", maybeStarted: true } }));
    await render(script.api);
    await type("hi");
    await send();
    expect(error()).toMatch(/may have started anyway/u);
    expect(script.starts).toHaveLength(1);
    expect(textarea().value).toBe("hi");
  });

  it("opens the session it made when only the first message failed, with the message back in the draft", async () => {
    const script = scriptedApi((cwd) => ({ type: "failed", failure: { stage: "prompt", session: { id: "s-new", cwd }, message: "Network error." } }));
    const onStarted = vi.fn();
    await render(script.api, { onStarted });
    await type("Fix the build");
    await send();
    expect(onStarted).toHaveBeenCalledWith({ id: "s-new", cwd: "/code/forgerie" },
      expect.objectContaining({ draft: "Fix the build", error: expect.stringMatching(/may not have reached Pi/u) }));
  });

  it("refuses a shell command before any session exists", async () => {
    const script = scriptedApi();
    await render(script.api);
    await type("!ls");
    await send();
    expect(script.starts).toEqual([]);
    expect(textarea().value).toBe("!ls");
    expect(error()).toMatch(/Shell commands need a running session/u);
  });

  it("shows that it is starting, and cannot be closed until the start ends", async () => {
    let finish!: (result: StartResult) => void;
    const onClose = vi.fn();
    await render(scriptedApi(() => new Promise((resolve) => { finish = resolve; })).api, { onClose });
    await type("Fix the build");
    await send();
    expect(document.querySelector(".ns-status")?.textContent).toBe("Starting session…");
    await act(async () => { dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(button("Close new session")?.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish({ type: "started", session: { id: "s", cwd: "/code/forgerie" } }); });
  });

  it("does not pull back a reader who left during the start, and keeps a failed start listed with its draft", async () => {
    let finish!: (result: StartResult) => void;
    const script = scriptedApi(() => new Promise((resolve) => { finish = resolve; }));
    const onStarted = vi.fn();
    const launches = await render(script.api, { onStarted });
    await type("Fix the build");
    await send();
    await act(async () => root.unmount());
    await act(async () => { finish({ type: "failed", failure: { stage: "start", message: "Network error.", maybeStarted: true } }); });
    expect(onStarted).not.toHaveBeenCalled();
    // The app's notice reads this list; "Put back" takes the draft, with its files, from it.
    expect(launches.getSnapshot()).toMatchObject([{ state: { type: "failed" }, draft: { text: "Fix the build" } }]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });

  it("holds Send until this folder's models are known, so the shown model is the one sent", async () => {
    let release!: () => void;
    const script = scriptedApi();
    const models = script.api.models;
    script.api.models = (cwd, signal) => new Promise((resolve) => { release = () => resolve(models(cwd, signal)); });
    await render(script.api);
    await type("hi");
    await send();
    expect(script.starts).toEqual([]);
    await act(async () => { release(); });
    await settle();
    await send();
    expect(script.starts[0]!.choice.model).toEqual(opus);
  });

  it("keeps the unsent first message across a reload", async () => {
    const drafts = createDraftStore(storage());
    await render(scriptedApi().api, { drafts });
    await type("half a thought");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await render(scriptedApi().api, { drafts });
    expect(textarea().value).toBe("half a thought");
  });
});

describe("a skill or prompt template as the first message", () => {
  it("starts it with the identity this folder listed", async () => {
    const script = scriptedApi();
    await render(script.api);
    await type("/skill:testing add cases");
    await send();
    expect(script.starts[0]!.prompt).toMatchObject({ text: "/skill:testing add cases", command: testing.identity });
  });

  it("asks to wait while the folder's list loads, instead of calling a real skill unknown", async () => {
    const script = scriptedApi();
    script.api.promptResources = () => new Promise(() => {});
    await render(script.api);
    await type("/skill:testing add cases");
    await send();
    expect(script.starts).toEqual([]);
    expect(error()).toMatch(/still loading/u);
  });

  it("refuses a command this folder does not list, and keeps it in the bar", async () => {
    const script = scriptedApi();
    await render(script.api);
    await type("/review the diff");
    await send();
    expect(script.starts).toEqual([]);
    expect(error()).toMatch(/not a skill or prompt template in this folder/u);
    expect(textarea().value).toBe("/review the diff");
  });
});

describe("Rapidfire", () => {
  it("starts each session in the background, clears the bar, and lists how each one went", async () => {
    const replies: ((result: StartResult) => void)[] = [];
    const script = scriptedApi(() => new Promise((resolve) => { replies.push(resolve); }));
    const onStarted = vi.fn();
    await render(script.api, { onStarted });
    await click(button("Rapidfire"));
    expect(button("Rapidfire")?.getAttribute("aria-pressed")).toBe("true");
    await type("First task");
    await send();
    await type("Second task");
    await send();
    expect(textarea().value).toBe("");
    expect(script.starts.map((start) => start.text)).toEqual(["First task", "Second task"]);
    const rows = () => [...document.querySelectorAll(".ns-launch")].map((row) => row.textContent);
    expect(rows()).toEqual(["Second taskStarting…", "First taskStarting…"]);
    await act(async () => { replies[0]!({ type: "started", session: { id: "s1", cwd: "/code/forgerie" } }); });
    await act(async () => { replies[1]!({ type: "failed", failure: { stage: "start", message: "Pi is down.", maybeStarted: false } }); });
    await settle();
    expect(onStarted).not.toHaveBeenCalled();
    expect(rows()[1]).toContain("Started");
    expect(rows()[0]).toContain("The session did not start: Pi is down.");
    await click(button("Put back"));
    expect(textarea().value).toBe("Second task");
    await click(button("Open"));
    expect(onStarted).toHaveBeenCalledWith({ id: "s1", cwd: "/code/forgerie" }, undefined);
  });

  it("can open straight into Rapidfire", async () => {
    await render(scriptedApi().api, { mode: "rapidfire" });
    expect(button("Rapidfire")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Start in background")).toBeDefined();
  });
});
