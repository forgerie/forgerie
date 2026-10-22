// @vitest-environment happy-dom
// The transcript card on the production store, with the suggestion routes in memory. The card draws the server's
// record: every state, the presses, and a remount (a reload) that still shows the last outcome.
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestionCard } from "./SuggestionCard";
import { cardInputs, type CardLinks } from "./cardInputs";
import { createSuggestionsStore, type SuggestionsStore } from "./suggestionsStore";
import type { Suggestion } from "./suggestionsApi";
import { memoryServer, type MemoryServer } from "./fixtures/memoryApi";
import { AZURE, CHAT_MODEL, DISMISSED, DUPLICATE, FAILED, FAILED_ACT, FAILED_FINAL, FILED, FILED_GITHUB, FILING, LAUNCH_ERROR, LAUNCH_ERROR_LOGGED, LONG, MODELS, NO_DEFAULT,
  NOW, OPEN, OPEN_GITHUB, SHORT, STARTED, STARTED_DONE, STARTED_NEEDS, look } from "./fixtures/suggestions";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const card = () => document.body;
const text = () => card().textContent ?? "";
const button = (name: string) => [...card().querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const press = async (name: string) => {
  const target = button(name);
  if (!target) throw new Error(`No button ${name}. Buttons: ${[...card().querySelectorAll("button")].map((node) => node.textContent).join(", ")}`);
  await act(async () => target.click());
  await settle();
};

function Card({ store, id, links }: { store: SuggestionsStore; id: string; links: CardLinks }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <SuggestionCard {...cardInputs({ reference: { suggestionId: id }, view, store, links, chat: { model: CHAT_MODEL, thinkingLevel: "high" },
    knownModels: MODELS, listModels: async () => MODELS, now: NOW })} />;
}
/** Mounts one card on a fresh store, as a page load does, and reads the routes once. */
async function mount(server: MemoryServer, id: string, links: Partial<CardLinks> = {}) {
  const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
  const all: CardLinks = { look, openSession: vi.fn(), openLink: vi.fn(), copy: vi.fn(async () => true), ...links };
  await act(async () => root.render(<Card store={store} id={id} links={all} />));
  await act(async () => { await store.refresh(); });
  await settle();
  return { store, links: all };
}
const show = async (record: Suggestion) => mount(memoryServer([record]), record.id);

describe("the card shows the server's record in every state", () => {
  it("open: File, File and act and Dismiss under where it goes and the model File and act starts on", async () => {
    await show(OPEN);
    expect(text()).toContain("Retry once when the provider stream drops before message.end");
    expect(text()).toContain("Goes to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md");
    expect(text()).toContain("File and act starts a new session on Claude Haiku 4.5, the backlog's default.");
    expect(text()).toContain("Context for the next session (3 files, 3 decisions)");
    for (const name of ["File", "File and act", "Dismiss", "Edit"]) expect(button(name)?.disabled).toBe(false);
    // The open rule is full ink, not the live colour.
    expect(card().querySelector(".decision-card")?.getAttribute("data-edge")).toBe("ink");
  });

  it("open on GitHub names the repository and the label", async () => {
    await show(OPEN_GITHUB);
    expect(text()).toContain("Goes to simonwjackson/forgerie as an issue, labelled agent-filed");
  });

  it("with no default model, File and act names the chat's own model", async () => {
    await show(NO_DEFAULT);
    expect(text()).toContain("File and act starts a new session on Claude Opus 5.5, this chat's model.");
  });

  it("filing: progress, and every choice waits", async () => {
    await show(FILING);
    expect(button("Filing…")?.disabled).toBe(true);
    expect(button("File and act")?.disabled).toBe(true);
    expect(button("Dismiss")?.disabled).toBe(true);
    expect(button("Edit")).toBeUndefined();
  });

  it("filed: the item's path, and no choices", async () => {
    await show(FILED);
    expect(text()).toContain("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md");
    expect(text()).toContain("Filed 14m ago");
    expect(button("File")).toBeUndefined();
  });

  it("filed on GitHub: a link to the issue", async () => {
    await show(FILED_GITHUB);
    const link = card().querySelector<HTMLAnchorElement>("a.decision-card-link")!;
    expect(link.textContent).toBe("Filed as #214 on simonwjackson/forgerie");
    expect(link.href).toBe("https://github.com/simonwjackson/forgerie/issues/214");
    expect(link.target).toBe("_blank");
  });

  it("started: the item link and the background session's model and live status, from the session list", async () => {
    await show(STARTED);
    expect(text()).toContain("Filed as #214");
    expect(text()).toContain("Claude Haiku 4.5");
    expect(text()).toContain("Working");
    expect(button("Open the background session, Retry once when the provider stream drops")).toBeDefined();
  });

  it("started: a session that needs the reader, and one that is done", async () => {
    await show(STARTED_NEEDS);
    expect(text()).toContain("Needs you");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await show(STARTED_DONE);
    expect(text()).toContain("Done");
    expect(text()).toContain("Gemini 3.8 Flash");
  });

  it("filed, but the launch failed: the message and Start session, which only starts the session", async () => {
    const server = memoryServer([LAUNCH_ERROR]);
    const { links } = await mount(server, LAUNCH_ERROR.id);
    expect(text()).toContain("Filed, but the background session did not start: The worktree for the new session could not be created: the disk is full.");
    await press("Start session");
    expect(server.presses).toEqual([{ id: LAUNCH_ERROR.id, kind: "file-and-act", request: {} }]);
    expect(text()).toContain("Working");
    expect(text()).not.toContain("did not start");
    expect(links.openSession).not.toHaveBeenCalled();
  });

  it("filed with a launch error that cannot be retried, and a history warning: both as notes, with no retry", async () => {
    await show(LAUNCH_ERROR_LOGGED);
    expect(text()).toContain("Filed, but the background session did not start: The provider refused the key.");
    expect(text()).toContain("This chat is archived, so its history does not record that the item was filed.");
    expect(button("Start session")).toBeUndefined();
    expect(button("Retry")).toBeUndefined();
  });

  it("duplicate: the matches, File anyway past the numbers shown, Open #N in a new tab, and Dismiss", async () => {
    const server = memoryServer([DUPLICATE]);
    const { links } = await mount(server, DUPLICATE.id);
    expect(text()).toContain("GitHub has 2 close matches. Nothing is filed yet.");
    expect(text()).toContain("#198 Retry the reply after the provider drops the stream");
    expect(button("Add to #198")).toBeUndefined();
    await press("Open #198");
    expect(links.openLink).toHaveBeenCalledWith("https://github.com/simonwjackson/forgerie/issues/198");
    await press("File anyway");
    expect(server.presses).toEqual([{ id: DUPLICATE.id, kind: "file", request: { notDuplicateOf: [198, 143] } }]);
    expect(text()).toContain("Filed as #219");
  });

  it("failed and retryable: the message, Retry, and Copy as Markdown", async () => {
    const server = memoryServer([FAILED]);
    const { links } = await mount(server, FAILED.id);
    expect(text()).toContain("GitHub did not answer (502 Bad Gateway). Nothing was filed.");
    await press("Copy as Markdown");
    expect(links.copy).toHaveBeenCalledWith(expect.stringContaining("# Retry once when the provider stream drops before message.end"));
    expect(button("Copied")).toBeDefined();
    await press("Retry");
    expect(server.presses.map((entry) => entry.kind)).toEqual(["file"]);
    expect(text()).toContain("Filed as #219");
  });

  it("failed File and act: after a remount, Retry still files and starts the session, as the record says", async () => {
    const server = memoryServer([FAILED_ACT]);
    // A new store, as after a reload: nothing was pressed in this browser.
    const { links } = await mount(server, FAILED_ACT.id);
    expect(text()).toContain("Retry also starts a new session on Claude Haiku 4.5");
    await press("Retry");
    expect(server.presses).toEqual([{ id: FAILED_ACT.id, kind: "file-and-act", request: {} }]);
    expect(text()).toContain("Working");
    expect(links.openSession).not.toHaveBeenCalled();
  });

  it("a failed record that does not name its action: Retry repeats the last press here, and File after a reload", async () => {
    const server = memoryServer([OPEN]);
    const unnamed = { ...OPEN, revision: 2, state: { kind: "failed" as const, message: "GitHub did not answer.", retryable: true } };
    const api = { ...server.api, fileAndAct: vi.fn(async () => unnamed) };
    const store = createSuggestionsStore(api, () => ({ sessionId: "s-chat" }));
    const links: CardLinks = { look, openSession: vi.fn(), openLink: vi.fn(), copy: vi.fn(async () => true) };
    await act(async () => root.render(<Card store={store} id={OPEN.id} links={links} />));
    await act(async () => { await store.refresh(); });
    await press("File and act");
    expect(text()).toContain("GitHub did not answer.");
    await press("Retry");
    expect(api.fileAndAct).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const fresh = memoryServer([unnamed]);
    await mount(fresh, OPEN.id);
    await press("Retry");
    expect(fresh.presses.map((entry) => entry.kind)).toEqual(["file"]);
  });

  it("failed for good: no Retry, still Copy as Markdown", async () => {
    await show(FAILED_FINAL);
    expect(button("Retry")).toBeUndefined();
    expect(button("Copy as Markdown")).toBeDefined();
  });

  it("an Azure project: a quiet note that Azure boards are read-only, and the usual choices", async () => {
    await show(AZURE);
    expect(text()).toContain("Azure DevOps boards are read-only in Forgerie, so this item goes to the backlog folder instead.");
    expect(button("File")).toBeDefined();
  });

  it("dismissed: one line with Restore, which reopens it", async () => {
    const server = memoryServer([DISMISSED]);
    await mount(server, DISMISSED.id);
    expect(text()).toContain("Dismissed backlog suggestion: Rename streamRelay to providerStream");
    await press("Restore");
    expect(button("File")).toBeDefined();
  });

  it("before the record is read, and when the record is not there", async () => {
    const server = memoryServer([OPEN], 50);
    const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
    const links: CardLinks = { look, openSession: vi.fn(), openLink: vi.fn(), copy: vi.fn(async () => true) };
    await act(async () => root.render(<Card store={store} id="sg-gone" links={links} />));
    expect(text()).toContain("Reading the suggestion…");
    await act(async () => { await store.refresh(); });
    await act(async () => { store.want("sg-gone"); await new Promise((resolve) => setTimeout(resolve, 80)); });
    await settle();
    expect(text()).toContain("This suggestion is not in Forgerie's records.");
  });

  it("the longest words wrap, and a suggestion with no body and no context says so", async () => {
    await show(LONG);
    expect(text()).toContain("Context for the next session (12 files)");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await show(SHORT);
    expect(text()).toContain("No chat context: the item is its title and body alone.");
  });
});

describe("the card's presses", () => {
  it("File and act files and starts a background session without moving the reader", async () => {
    const before = window.location.href;
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const server = memoryServer([OPEN]);
    const { links } = await mount(server, OPEN.id);
    await press("File and act");
    expect(server.presses).toEqual([{ id: OPEN.id, kind: "file-and-act", request: {} }]);
    expect(text()).toContain("Working");
    expect(links.openSession).not.toHaveBeenCalled();
    expect(links.openLink).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    // Open is the one press that moves the reader.
    await act(async () => button("Open the background session, Retry once when the provider stream drops")!.click());
    expect(links.openSession).toHaveBeenCalledWith("s-bg-working");
  });

  it("files the reader's words and goes back to the agent's on request", async () => {
    const server = memoryServer([OPEN]);
    await mount(server, OPEN.id);
    await press("Edit");
    const title = card().querySelectorAll<HTMLTextAreaElement>("textarea")[0]!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(title, "Retry once when a stream closes early");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Use the agent's words")).toBeDefined();
    await press("Done");
    expect(text()).toContain("Edited");
    expect(text()).toContain("Retry once when a stream closes early");
    await press("File");
    expect(server.presses[0]).toEqual({ id: OPEN.id, kind: "file", request: { title: "Retry once when a stream closes early", body: OPEN.body } });
  });

  it("a refused press says why and keeps the choices", async () => {
    const server = memoryServer([OPEN]);
    server.refuse(OPEN.id, { status: 503, message: "The backlog is unavailable." });
    await mount(server, OPEN.id);
    await press("File");
    expect(card().querySelector("[role=alert]")?.textContent).toContain("The backlog is unavailable.");
    expect(button("File")?.disabled).toBe(false);
  });

  it("a remount, as after a reload, shows the server's last outcome, not the transcript's", async () => {
    const server = memoryServer([OPEN]);
    await mount(server, OPEN.id);
    await press("File");
    expect(text()).toContain("Filed to");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    // A new store, as a page load makes: it knows only what the routes say.
    await mount(server, OPEN.id);
    expect(text()).toContain("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md");
    expect(button("File")).toBeUndefined();
  });
});
