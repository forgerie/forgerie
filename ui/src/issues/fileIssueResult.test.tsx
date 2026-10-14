// @vitest-environment happy-dom
// The parent's file_issue call in the real thread: the ordinary tool line, and under it what the call did with an issue.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHistory, reduceEvent, type ToolState, type TranscriptMessage, type TranscriptPart } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "../ui/Thread";
import { issueOutcomeOf, type IssueOutcome } from "./fileIssueResult";
import { DRAFT_TITLE, DUPLICATE, FILED, LABEL_WARNING } from "./fixtures/issues";

const args = { title: DRAFT_TITLE, body: "Steps", duplicates: ["draft lost"] };
const created: IssueOutcome = { state: "created", issue: { number: 143, title: DRAFT_TITLE, href: FILED.url } };
const refused: IssueOutcome = { state: "duplicate", matches: [
  { number: 142, title: DRAFT_TITLE, href: "https://github.com/forgerie/forgerie/issues/142" },
  { number: 98, title: "Composer draft lost after a failed retry", href: "https://github.com/forgerie/forgerie/issues/98" },
] };
const of = (details: unknown, isError = false, toolName = "file_issue") => issueOutcomeOf({ toolName, isError, details });

describe("what a file_issue result did with an issue", () => {
  it("reads a created issue only from a successful result", () => {
    expect(of(FILED)).toEqual(created);
    expect(of({ ...FILED, agentFiled: false, labelWarning: LABEL_WARNING })).toEqual({ ...created, labelWarning: LABEL_WARNING });
    expect(of(FILED, true)).toBeUndefined();
    expect(of(FILED, false, "github_write")).toBeUndefined();
  });

  it("reads a refused duplicate from its error result, with every match", () => {
    expect(of(DUPLICATE, true)).toEqual(refused);
    expect(of({ ...DUPLICATE, matches: [] }, true)).toBeUndefined();
  });

  it("keeps an issue whose address is not a web address, unlinked", () => {
    expect(of({ ...FILED, url: "javascript:alert(1)" })).toEqual({ state: "created", issue: { number: 143, title: DRAFT_TITLE } });
    expect(of({ ...DUPLICATE, matches: [{ ...DUPLICATE.matches[0]!, url: "file:///etc/passwd" }] }, true))
      .toEqual({ state: "duplicate", matches: [{ number: 142, title: DRAFT_TITLE }] });
  });

  it("reads nothing from unreadable details", () => {
    for (const details of [undefined, null, "Filed", {}, { ...FILED, number: 0 }, { ...FILED, url: undefined }, { ...FILED, state: "merged" },
      { ...DUPLICATE, matches: [{ number: 142 }] }]) {
      expect(of(details)).toBeUndefined();
      expect(of(details, true)).toBeUndefined();
    }
  });

  it("reaches the call from history and from a live tool.end", () => {
    const call = { role: "assistant" as const, content: [{ type: "toolCall", id: "f", name: "file_issue", arguments: args }] };
    const history = fromHistory([call, { role: "toolResult", toolCallId: "f", toolName: "file_issue", content: [{ type: "text", text: "Filed" }], details: FILED }]);
    const live = reduceEvent(fromHistory([call]), { type: "tool.end", toolCallId: "f", toolName: "file_issue", text: "Filed", isError: false, details: FILED });
    for (const transcript of [history, live]) expect(transcript.messages[0]?.parts[0]).toMatchObject({ state: { type: "done", issue: created } });
  });
});

let root: Root;
const tool = (state: ToolState): TranscriptPart => ({ type: "tool", id: "f", name: "file_issue", args, state });
const filed = (issue: IssueOutcome = created): ToolState => ({ type: "done", output: `Filed #143 ${FILED.url} with agent-filed.`, isError: issue.state === "duplicate", issue });
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
const sentences = () => [...document.querySelectorAll(".message-assistant .event-sentence")];
const linksOf = (node: Element | undefined) => [...node?.querySelectorAll("a") ?? []].map((link) => [link.textContent, link.getAttribute("href")]);
const summaryOf = (details: Element | null | undefined) => details?.querySelector(":scope > summary .trace-text")?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("a file_issue call in the thread", () => {
  it("keeps the tool line and adds the filed issue under it, outside the collapsed activity", async () => {
    await render(reply({ type: "thinking", text: "Searched first; nothing matches." }, tool(filed())));
    const group = document.querySelector<HTMLDetailsElement>("details.chain-of-thought")!;
    expect(group.querySelector("details.tool-call")).toBeNull();
    const call = document.querySelector(".message-assistant details.tool-call");
    expect(summaryOf(call)).toMatch(/^ran file_issue/u);
    expect(call?.nextElementSibling?.matches(".event-sentence")).toBe(true);
    expect(sentences().map((node) => node.textContent)).toEqual([`Filed #143 ${DRAFT_TITLE}`]);
    expect(linksOf(sentences()[0])).toEqual([[`#143 ${DRAFT_TITLE}`, FILED.url]]);
    expect(sentences()[0]?.getAttribute("data-tone")).toBe("positive");
  });

  it("says why a filed issue lacks the agent-filed label", async () => {
    await render(reply(tool(filed({ ...created, labelWarning: LABEL_WARNING }))));
    expect(sentences().map((node) => node.textContent)).toEqual([`Filed #143 ${DRAFT_TITLE}${LABEL_WARNING}`]);
    expect(sentences()[0]?.querySelector("br")).not.toBeNull();
  });

  it("names a filed issue whose address is not a web address without a link", async () => {
    await render(reply(tool(filed({ state: "created", issue: { number: 143, title: DRAFT_TITLE } }))));
    expect(sentences().map((node) => node.textContent)).toEqual([`Filed #143 ${DRAFT_TITLE}`]);
    expect(linksOf(sentences()[0])).toEqual([]);
  });

  it("names every issue a refused duplicate matched, each linked, after the failed call", async () => {
    await render(reply({ type: "thinking", text: "File it." }, tool(filed(refused))));
    expect(summaryOf(document.querySelector(".message-assistant details.tool-call"))).toMatch(/^failed file_issue/u);
    expect(sentences().map((node) => node.textContent))
      .toEqual([`Refused: duplicate of #142 ${DRAFT_TITLE}, #98 Composer draft lost after a failed retry`]);
    expect(linksOf(sentences()[0]).map(([, href]) => href)).toEqual(refused.state === "duplicate" ? refused.matches.map((match) => match.href) : []);
    expect(sentences()[0]?.getAttribute("data-tone")).toBe("neutral");
  });

  it("names a match by its number alone when the server hides its outside contributor's title", async () => {
    const hidden = (title: string) => ({ ...DUPLICATE, matches: [{ ...DUPLICATE.matches[0]!, title }, DUPLICATE.matches[1]!] });
    for (const title of ["(title hidden: outside contributor @drive-by)", "(title hidden: outside contributor a deleted user)"]) {
      const outcome = of(hidden(title), true)!;
      expect(outcome).toEqual({ state: "duplicate", matches: [{ number: 142, title: "", href: DUPLICATE.matches[0]!.url },
        { number: 98, title: DUPLICATE.matches[1]!.title, href: DUPLICATE.matches[1]!.url }] });
      await render(reply(tool(filed(outcome))));
      expect(sentences().map((node) => node.textContent)).toEqual(["Refused: duplicate of #142, #98 Composer draft lost after a failed retry"]);
      expect(linksOf(sentences()[0])[0]).toEqual(["#142", DUPLICATE.matches[0]!.url]);
    }
    // Only the exact masked form is hidden: a real title that mentions it stays.
    const quoted = "Explain (title hidden: outside contributor @x) in the docs";
    expect(of(hidden(quoted), true)).toMatchObject({ matches: [{ title: quoted }, {}] });
  });

  it("keeps the call's input and output one tap away", async () => {
    await render(reply(tool(filed())));
    const call = document.querySelector<HTMLDetailsElement>(".message-assistant details.tool-call")!;
    await act(async () => { call.open = true; call.dispatchEvent(new Event("toggle")); });
    expect([...call.querySelectorAll("pre")].map((node) => node.textContent)).toEqual([JSON.stringify(args, null, 2), `Filed #143 ${FILED.url} with agent-filed.`]);
  });

  it("adds nothing to an unreadable failure or a running call, which stay calls in their step", async () => {
    await render(reply({ type: "thinking", text: "File it." }, tool({ type: "done", output: "Issue filing is unavailable.", isError: true })));
    expect(sentences()).toHaveLength(0);
    expect(document.querySelector(".message-assistant .tally .tally-line")?.textContent).toMatch(/^1 tool call, 1 failed: file_issue/u);
    await render(reply(tool({ type: "running", output: "" })));
    expect(sentences()).toHaveLength(0);
  });

  it("puts the outcome after its step instead of counting its call in it", async () => {
    const ran = (id: string): TranscriptPart => ({ type: "tool", id, name: "bash", args: { command: `echo ${id}` }, state: { type: "done", output: "", isError: false } });
    await render(reply(ran("before"), tool(filed()), ran("after")));
    expect(document.querySelectorAll(".message-assistant .tally .tally-mark")).toHaveLength(2);
    const order = [...document.querySelectorAll(".message-assistant .rail-section-body > *")].map((node) =>
      node.matches(".tally") ? "step" : node.matches(".event-sentence") ? "issue" : node.matches("details.tool-call") ? "call" : node.className);
    expect(order).toEqual(["step", "call", "issue"]);
  });
});
