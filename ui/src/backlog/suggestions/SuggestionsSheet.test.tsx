// @vitest-environment happy-dom
// The header's list of one chat's suggestions, and the Backlog view's group, on the production store with the
// suggestion routes in memory.
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestionsSheet, type SuggestionsSheetActions } from "./SuggestionsSheet";
import { SuggestedInChats } from "./SuggestedInChats";
import { SuggestionsOpener } from "./SuggestionsOpener";
import { createSuggestionsStore, type SuggestionsStore } from "./suggestionsStore";
import { isOpen, openerView } from "./suggestionsModel";
import { memoryServer } from "./fixtures/memoryApi";
import { CHAT_SUGGESTIONS, DUPLICATE, FAILED, LAUNCH_ERROR, MODELS, NOW, STARTED_NEEDS, look, suggestion } from "./fixtures/suggestions";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const text = () => document.body.textContent ?? "";
const button = (name: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const group = (label: string) => [...document.querySelectorAll<HTMLElement>(".record-group")].find((node) => node.querySelector(".record-group-label")?.textContent === label);
const row = (title: string) => [...document.querySelectorAll<HTMLElement>(".pending-row")].find((node) => node.querySelector(".pending-row-title")?.textContent === title)!;

function Sheet({ store, actions }: { store: SuggestionsStore; actions: Omit<SuggestionsSheetActions, "onFile" | "onFileAndAct" | "onRestore" | "onRetry"> }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <SuggestionsSheet suggestions={view.suggestions} readError={view.readError} pending={view.pending} problems={view.problems} drafts={view.drafts}
    look={look} knownModels={MODELS} now={NOW} actions={{ ...actions, onFile: (id) => { void store.file(id); }, onFileAndAct: (id) => { void store.fileAndAct(id); },
      onRestore: (id) => { void store.restore(id); }, onRetry: () => { void store.refresh(); } }} />;
}
async function mountSheet(records = CHAT_SUGGESTIONS) {
  const server = memoryServer(records);
  const store = createSuggestionsStore(server.api, () => ({ sessionId: "s-chat" }));
  const actions = { onShow: vi.fn(), onOpenSession: vi.fn(), onOpenBacklog: vi.fn(), onClose: vi.fn() };
  await act(async () => root.render(<Sheet store={store} actions={actions} />));
  await act(async () => { await store.refresh(); });
  await settle();
  return { server, store, actions };
}

describe("the chat's suggestions sheet", () => {
  it("groups Open, Filed and Dismissed, newest first, with counts", async () => {
    await mountSheet();
    expect(text()).toContain("2 open, 2 filed, 1 dismissed");
    expect(group("Open")?.querySelectorAll(".pending-row")).toHaveLength(2);
    expect(group("Filed")?.querySelectorAll(".pending-row")).toHaveLength(2);
    expect(group("Dismissed")?.querySelectorAll(".pending-row")).toHaveLength(1);
    expect(text()).toContain("Filed to .forgerie/backlog/2026-10-21-count-early-closes.md, just now");
  });

  it("files from an open row, and File and act from another, without moving the reader", async () => {
    const { server, actions } = await mountSheet();
    await act(async () => button("File", row("Add a shared fixture that drops the stream after the first tool call"))!.click());
    await settle();
    await act(async () => button("File and act", row("Show the provider's close reason under a cut-off reply"))!.click());
    await settle();
    expect(server.presses.map(({ id, kind }) => [id, kind])).toEqual([["sg-c", "file"], ["sg-b", "file-and-act"]]);
    expect(group("Open")).toBeUndefined();
    expect(text()).toContain("Nothing waits to be filed.");
    expect(actions.onOpenSession).not.toHaveBeenCalled();
    expect(actions.onShow).not.toHaveBeenCalled();
  });

  it("restores a dismissed row into Open", async () => {
    await mountSheet();
    await act(async () => button("Restore", row("Rename streamRelay to providerStream"))!.click());
    await settle();
    expect(group("Open")?.textContent).toContain("Rename streamRelay to providerStream");
    expect(group("Dismissed")).toBeUndefined();
  });

  it("shows a row in the chat, opens a background session, and opens the Backlog, each only when pressed", async () => {
    const { actions } = await mountSheet();
    await act(async () => button("Show in chat: Show the provider's close reason under a cut-off reply")!.click());
    expect(actions.onShow).toHaveBeenCalledWith("sg-b");
    await act(async () => button("Open the background session, Retry once when the provider stream drops")!.click());
    expect(actions.onOpenSession).toHaveBeenCalledWith("s-bg-working");
    await act(async () => button("Open the Backlog")!.click());
    expect(actions.onOpenBacklog).toHaveBeenCalled();
  });

  it("says why a row cannot be filed from here, and offers Start session after a launch failed", async () => {
    const { server } = await mountSheet([FAILED, DUPLICATE, LAUNCH_ERROR, STARTED_NEEDS]);
    expect(row(FAILED.title).textContent).toContain("GitHub did not answer (502 Bad Gateway). Nothing was filed.");
    expect(button("File", row(FAILED.title))).toBeDefined();
    expect(text()).toContain("GitHub has a close match, #198. Show it in the chat to decide.");
    expect(text()).toContain("The background session did not start");
    expect(text()).toContain("Needs you");
    const launchRow = [...document.querySelectorAll<HTMLElement>(".pending-row")].find((node) => node.textContent?.includes("#217"))!;
    await act(async () => button("Start session", launchRow)!.click());
    await settle();
    expect(server.presses).toEqual([{ id: LAUNCH_ERROR.id, kind: "file-and-act", request: {} }]);
  });

  it("before the first read, and after a failed one with Retry", async () => {
    const server = memoryServer(CHAT_SUGGESTIONS);
    const failing = { ...server.api, list: vi.fn().mockRejectedValueOnce(new Error("Forgerie answered 503.")).mockImplementation(server.api.list) };
    const store = createSuggestionsStore(failing, () => ({ sessionId: "s-chat" }));
    await act(async () => root.render(<Sheet store={store} actions={{ onShow: vi.fn(), onOpenSession: vi.fn(), onClose: vi.fn() }} />));
    expect(text()).toContain("Reading this chat's suggestions…");
    await act(async () => { await store.refresh(); });
    expect(text()).toContain("Could not read this chat's suggestions. Forgerie answered 503.");
    await act(async () => button("Retry")!.click());
    await settle();
    expect(text()).toContain("2 open, 2 filed, 1 dismissed");
  });
});

describe("the header's count", () => {
  it("counts open suggestions quietly, turns live when a background session needs the reader, and draws the working dot", async () => {
    const quiet = openerView(CHAT_SUGGESTIONS, look);
    expect(quiet).toEqual({ label: "Backlog suggestions, 2 open, 1 in background working", count: 2, quiet: true, active: true });
    await act(async () => root.render(<SuggestionsOpener {...quiet} onOpen={() => {}} />));
    const badge = document.querySelector<HTMLButtonElement>(".badge-button")!;
    expect(badge.getAttribute("aria-label")).toBe("Backlog suggestions, 2 open, 1 in background working");
    expect(badge.hasAttribute("data-waiting")).toBe(false);
    expect(badge.querySelector(".badge-button-dot")).not.toBeNull();
    const needs = openerView([...CHAT_SUGGESTIONS, STARTED_NEEDS], look);
    expect(needs).toMatchObject({ count: 1, quiet: false, label: "Backlog suggestions, 2 open, 1 in background needs you, 1 in background working" });
    await act(async () => root.render(<SuggestionsOpener {...needs} onOpen={() => {}} />));
    expect(document.querySelector(".badge-button")!.hasAttribute("data-waiting")).toBe(true);
  });
});

describe("the Backlog view's Suggested in chats", () => {
  it("lists open suggestions from every chat with File, File and act and Show in chat; a filed one leaves", async () => {
    const other = suggestion("sg-x", { title: "Keep the composer draft when a send fails twice", sessionId: "s-composer", sessionTitle: "Composer retries" });
    const server = memoryServer([...CHAT_SUGGESTIONS, other]);
    const store = createSuggestionsStore(server.api, () => ({}));
    const onShow = vi.fn();
    function Group() {
      const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
      return <SuggestedInChats suggestions={view.suggestions?.filter((record) => isOpen(record.state))} pending={view.pending} problems={view.problems} drafts={view.drafts}
        now={NOW} actions={{ onFile: (id) => { void store.file(id); }, onFileAndAct: (id) => { void store.fileAndAct(id); }, onShow, onRetry: () => { void store.refresh(); } }} />;
    }
    await act(async () => root.render(<Group />));
    await act(async () => { await store.refresh(); });
    expect(group("Suggested in chats")?.querySelectorAll(".pending-row")).toHaveLength(3);
    expect(row(other.title).textContent).toContain("Suggested in Composer retries");
    await act(async () => button("Show in chat", row(other.title))!.click());
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ id: "sg-x", sessionId: "s-composer" }));
    await act(async () => button("File and act", row(other.title))!.click());
    await settle();
    expect(server.presses).toEqual([{ id: "sg-x", kind: "file-and-act", request: {} }]);
    expect(group("Suggested in chats")?.querySelectorAll(".pending-row")).toHaveLength(2);
  });
});
