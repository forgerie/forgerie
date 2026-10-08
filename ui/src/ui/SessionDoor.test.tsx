// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffDoor } from "../handoffDoor";
import type { ToolState, TranscriptMessage, TranscriptPart } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";
import { SessionDoorsProvider } from "./SessionDoor";

let root: Root;
const here = "/work/forgerie";
const door: HandoffDoor = { sessionId: "destination", cwd: here };
const tool = (id: string, name: string, args: unknown, state: ToolState): TranscriptPart => ({ type: "tool", id, name, args, state });
const handoff = (state: ToolState) => tool("h", "handoff_session", { focus: "Next slice" }, state);
const handedOff = (to: HandoffDoor = door): ToolState => ({ type: "done", output: "Started detached handoff h1.", isError: false, door: to });
const reply = (...parts: TranscriptPart[]): TranscriptMessage[] => [
  { id: "q", role: "user", parts: [{ type: "text", text: "Hand this off" }] },
  { id: "a", role: "assistant", parts },
];

function Fixture({ messages, open }: { messages: TranscriptMessage[]; open: (door: HandoffDoor) => void }) {
  const threadMessages = useThreadMessages(messages, false);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew: async () => {}, isRunning: false });
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionDoorsProvider cwd={here} open={open}><Thread /></SessionDoorsProvider>
  </AssistantRuntimeProvider>;
}
async function render(messages: TranscriptMessage[], open: (door: HandoffDoor) => void = () => {}) {
  await act(async () => root.render(<Fixture messages={messages} open={open} />));
}
const doorButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".message-assistant .session-door-open")];
const summaryOf = (details: Element | null | undefined) => details?.querySelector(":scope > summary .trace-text")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Handoff doors", () => {
  it("stands outside the collapsed activity and opens the session the handoff created", async () => {
    const open = vi.fn();
    await render(reply({ type: "thinking", text: "Hand it off." }, handoff(handedOff())), open);
    const group = document.querySelector<HTMLDetailsElement>("details.chain-of-thought")!;
    expect(group.open).toBe(false);
    // The door's call is not activity to report twice: the group keeps only the reasoning.
    expect(summaryOf(group)).toBe("reasoning");
    expect(group.querySelector("details.tool-call")).toBeNull();
    const call = document.querySelector(".message-assistant .session-door > details.tool-call");
    expect(summaryOf(call)).toBe("ran handoff_session focus: Next slice");
    expect(doorButtons().map((button) => button.textContent)).toEqual(["Open session"]);
    await act(async () => doorButtons()[0]!.click());
    expect(open).toHaveBeenCalledWith(door);
  });

  it("names the destination workspace only when it is not the one being read", async () => {
    await render(reply(tool("s", "spawn_session", { prompt: "Audit" }, handedOff({ sessionId: "spawned", cwd: "/work/other" }))));
    const [button] = doorButtons();
    expect(button?.textContent).toBe("Open in other");
    expect(button?.title).toBe("Open the created session in /work/other");
    await render(reply(handoff(handedOff())));
    expect(doorButtons()[0]?.title).toBe("Open the created session");
  });

  it("keeps the call's input and output one tap away", async () => {
    await render(reply(handoff(handedOff())));
    const call = document.querySelector<HTMLDetailsElement>(".session-door > details.tool-call")!;
    await act(async () => { call.open = true; call.dispatchEvent(new Event("toggle")); });
    expect([...call.querySelectorAll("pre")].map((node) => node.textContent))
      .toEqual([JSON.stringify({ focus: "Next slice" }, null, 2), "Started detached handoff h1."]);
  });

  it("opens no door on a failed or running handoff, which stays counted in the activity", async () => {
    await render(reply({ type: "thinking", text: "Hand it off." }, handoff({ type: "done", output: "No model.", isError: true })));
    expect(doorButtons()).toHaveLength(0);
    expect(summaryOf(document.querySelector("details.chain-of-thought"))).toBe("reasoning, 1 failed 1 tool: handoff_session");
    await render(reply(handoff({ type: "running", output: "" })));
    expect(doorButtons()).toHaveLength(0);
    expect(document.querySelector(".session-door")).toBeNull();
  });

  it("splits the activity around a door instead of counting the door's call in either part", async () => {
    const ran = (id: string): TranscriptPart => tool(id, "bash", { command: `echo ${id}` }, { type: "done", output: "", isError: false });
    await render(reply(ran("before"), tool("s", "spawn_session", { prompt: "Audit" }, handedOff()), ran("after")));
    const groups = [...document.querySelectorAll("details.chain-of-thought")];
    expect(groups.map(summaryOf)).toEqual(["tool activity 1 tool: bash", "tool activity 1 tool: bash"]);
    const order = [...document.querySelectorAll(".message-assistant .message-text > *")].map((node) =>
      node.matches("details.chain-of-thought") ? "group" : node.matches(".session-door") ? "door" : node.className);
    expect(order).toEqual(["group", "door", "group"]);
  });
});
