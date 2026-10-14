// @vitest-environment happy-dom
// The parent's file_issue call in the real thread: the ordinary tool line, and the issue it filed under it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHistory, reduceEvent, type ToolState, type TranscriptMessage, type TranscriptPart } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "../ui/Thread";
import { filedIssueOf } from "./filedIssue";
import { DRAFT_TITLE, FILED } from "./fixtures/issues";

const args = { title: DRAFT_TITLE, body: "Steps", duplicates: ["draft lost"] };
const line = { number: 143, title: DRAFT_TITLE, href: FILED.url };
const duplicate = { state: "duplicate", repo: "forgerie/forgerie", matches: [{ number: 142, title: DRAFT_TITLE, state: "closed", url: "https://github.com/forgerie/forgerie/issues/142" }] };

describe("the issue a file_issue call filed", () => {
  it("is read only from a successful file_issue result's details", () => {
    expect(filedIssueOf({ toolName: "file_issue", isError: false, details: FILED })).toEqual(line);
    expect(filedIssueOf({ toolName: "file_issue", isError: false, details: { ...FILED, labelWarning: "No permission to create labels." } })).toEqual(line);
    // An address that is not a web address keeps the issue, unlinked.
    expect(filedIssueOf({ toolName: "file_issue", isError: false, details: { ...FILED, url: "javascript:alert(1)" } })).toEqual({ number: 143, title: DRAFT_TITLE });
    expect(filedIssueOf({ toolName: "file_issue", isError: true, details: FILED })).toBeUndefined();
    expect(filedIssueOf({ toolName: "file_issue", isError: true, details: duplicate })).toBeUndefined();
    expect(filedIssueOf({ toolName: "github_write", isError: false, details: FILED })).toBeUndefined();
    for (const details of [undefined, null, "Filed", {}, { ...FILED, number: 0 }, { ...FILED, state: "duplicate" }, { ...FILED, url: undefined }]) {
      expect(filedIssueOf({ toolName: "file_issue", isError: false, details })).toBeUndefined();
    }
  });

  it("reaches the call from history and from a live tool.end", () => {
    const call = { role: "assistant" as const, content: [{ type: "toolCall", id: "f", name: "file_issue", arguments: args }] };
    const history = fromHistory([call, { role: "toolResult", toolCallId: "f", toolName: "file_issue", content: [{ type: "text", text: "Filed" }], details: FILED }]);
    const live = reduceEvent(fromHistory([call]), { type: "tool.end", toolCallId: "f", toolName: "file_issue", text: "Filed", isError: false, details: FILED });
    for (const transcript of [history, live]) expect(transcript.messages[0]?.parts[0]).toMatchObject({ state: { type: "done", filed: line } });
  });
});

let root: Root;
const tool = (state: ToolState): TranscriptPart => ({ type: "tool", id: "f", name: "file_issue", args, state });
const filed: ToolState = { type: "done", output: `Filed #143 ${FILED.url} with agent-filed.`, isError: false, filed: line };
const reply = (...parts: TranscriptPart[]): TranscriptMessage[] => [
  { id: "q", role: "user", parts: [{ type: "text", text: "File the retry bug" }] },
  { id: "a", role: "assistant", parts },
];
function Fixture({ messages }: { messages: TranscriptMessage[] }) {
  const threadMessages = useThreadMessages(messages, false);
  const runtime = useExternalStoreRuntime({ messages: threadMessages, onNew: async () => {}, isRunning: false });
  return <AssistantRuntimeProvider runtime={runtime}><Thread /></AssistantRuntimeProvider>;
}
const render = async (messages: TranscriptMessage[]) => { await act(async () => root.render(<Fixture messages={messages} />)); };
const issueLines = () => [...document.querySelectorAll(".message-assistant .event-sentence")];
const summaryOf = (details: Element | null | undefined) => details?.querySelector(":scope > summary .trace-text")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("a filed issue in the thread", () => {
  it("keeps the tool line and adds the issue under it, outside the collapsed activity", async () => {
    await render(reply({ type: "thinking", text: "Searched first; nothing matches." }, tool(filed)));
    const group = document.querySelector<HTMLDetailsElement>("details.chain-of-thought")!;
    expect(group.querySelector("details.tool-call")).toBeNull();
    const call = document.querySelector(".message-assistant details.tool-call");
    expect(summaryOf(call)).toMatch(/^ran file_issue/u);
    expect(call?.nextElementSibling?.matches(".event-sentence")).toBe(true);
    expect(issueLines().map((node) => node.textContent)).toEqual([`Filed #143 ${DRAFT_TITLE}`]);
    expect(issueLines()[0]?.querySelector("a")?.getAttribute("href")).toBe(FILED.url);
    expect(issueLines()[0]?.querySelector("a")?.textContent).toBe(`#143 ${DRAFT_TITLE}`);
    expect(issueLines()[0]?.getAttribute("data-tone")).toBe("positive");
  });

  it("names an issue whose address is not a web address without a link", async () => {
    const { href: _href, ...unlinked } = line;
    void _href;
    await render(reply(tool({ ...filed, filed: unlinked } as ToolState)));
    expect(issueLines().map((node) => node.textContent)).toEqual([`Filed #143 ${DRAFT_TITLE}`]);
    expect(issueLines()[0]?.querySelector("a")).toBeNull();
  });

  it("keeps the call's input and output one tap away", async () => {
    await render(reply(tool(filed)));
    const call = document.querySelector<HTMLDetailsElement>(".message-assistant details.tool-call")!;
    await act(async () => { call.open = true; call.dispatchEvent(new Event("toggle")); });
    expect([...call.querySelectorAll("pre")].map((node) => node.textContent)).toEqual([JSON.stringify(args, null, 2), filed.type === "done" ? filed.output : ""]);
  });

  it("adds nothing to a refused duplicate or a running call, which stay calls in their step", async () => {
    await render(reply({ type: "thinking", text: "File it." }, tool({ type: "done", output: "No issue filed: close title matches.", isError: true })));
    expect(issueLines()).toHaveLength(0);
    expect(document.querySelector(".message-assistant .tally .tally-line")?.textContent).toMatch(/^1 tool call, 1 failed: file_issue/u);
    await render(reply(tool({ type: "running", output: "" })));
    expect(issueLines()).toHaveLength(0);
  });

  it("puts the issue after its step instead of counting its call in it", async () => {
    const ran = (id: string): TranscriptPart => ({ type: "tool", id, name: "bash", args: { command: `echo ${id}` }, state: { type: "done", output: "", isError: false } });
    await render(reply(ran("before"), tool(filed), ran("after")));
    expect(document.querySelectorAll(".message-assistant .tally .tally-mark")).toHaveLength(2);
    const order = [...document.querySelectorAll(".message-assistant .rail-section-body > *")].map((node) =>
      node.matches(".tally") ? "step" : node.matches(".event-sentence") ? "issue" : node.matches("details.tool-call") ? "call" : node.className);
    expect(order).toEqual(["step", "call", "issue"]);
  });
});
