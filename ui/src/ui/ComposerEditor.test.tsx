// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type AssistantRuntime, type AttachmentAdapter } from "@assistant-ui/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromHistory, type TranscriptMessage } from "../transcript";
import { useThreadMessages } from "../useThreadMessages";
import { Composer } from "./Composer";
import type { ComposerInputElement } from "./ComposerEditor";
import { loadMarkdownEditing } from "./composerCodeLanguage";
import type { AskBinding } from "./useAskMode";
import { ImageViewerProvider } from "./ImageViewer";
import { createAttachmentAdapter } from "../attachments";

const SQL_SOURCE = "```sql\nSELECT * FROM you\n```\n";
let root: Root;
let runtime: AssistantRuntime;
interface Props { messages?: readonly TranscriptMessage[]; onNew?: (message: AppendMessage) => Promise<void>; ask?: AskBinding; attachments?: AttachmentAdapter }
function Fixture({ messages = [], onNew = async () => {}, ask, attachments }: Props) {
  runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, false), onNew, ...(attachments ? { adapters: { attachments } } : {}) });
  return <AssistantRuntimeProvider runtime={runtime}><ImageViewerProvider><Composer ask={ask} /></ImageViewerProvider></AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<ComposerInputElement>("[data-composer-input]")!;
const view = () => EditorView.findFromDOM(input())!;
const text = () => runtime.thread.composer.getState().text;
const type = (value: string) => act(async () => { input().value = value; });
const cursor = (position: number) => act(async () => { view().dispatch({ selection: EditorSelection.cursor(position) }); });
async function press(key: string, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    input().dispatchEvent(event);
  });
  return event;
}
const shiftEnter = async () => { await press("Shift"); await press("Enter", { shiftKey: true }); };
const paste = (value: string) => act(async () => { view().dispatch({ ...view().state.replaceSelection(value), userEvent: "input.paste" }); });
const undo = () => press("z", { ctrlKey: true });
const headers = () => [...document.querySelectorAll<HTMLElement>(".cm-code-block-header")];
const codeLine = () => document.querySelector<HTMLElement>(".cm-code-block-body .cm-line")!;
const blocks = (count: number) => vi.waitFor(() => expect(headers()).toHaveLength(count));
const highlighted = (word: string) => vi.waitFor(() => {
  expect([...codeLine().querySelectorAll("span")].some((span) => span.textContent === word && /\btok-/u.test(span.className))).toBe(true);
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("rich code blocks in the composer", () => {
  it("converts a typed fence into one editable SQL block and undoes it atomically", async () => {
    await render(); await type("```sql"); const before = input().selectionStart;
    await shiftEnter();
    expect(text()).toBe("```sql\n\n```\n");
    await blocks(1);
    expect(input().selectionStart).toBe("```sql\n".length);
    expect(input().textContent).not.toContain("```");
    expect(headers()[0]!.textContent).toBe("sql");
    expect(headers()[0]!.getAttribute("aria-label")).toBe("sql code block");
    await undo();
    expect(text()).toBe("```sql"); expect(input().selectionStart).toBe(before);
  });
  it("highlights supported SQL code and keeps Shift+Enter inside the block", async () => {
    await render(); await type(SQL_SOURCE); await blocks(1); await highlighted("SELECT");
    await cursor(SQL_SOURCE.indexOf("\n```", SQL_SOURCE.indexOf("SELECT")));
    await shiftEnter();
    expect(text()).toBe("```sql\nSELECT * FROM you\n\n```\n");
    expect(headers()).toHaveLength(1);
  });
  it("uses the transcript's language aliases", async () => {
    await render(); await type("```ts\nconst answer: number = 1;\n```\n");
    await blocks(1); await highlighted("const");
    expect(headers()[0]!.textContent).toBe("ts");
    await type("```py\nimport os\n```\n"); await blocks(1); await highlighted("import");
    expect(headers()[0]!.textContent).toBe("py");
  });
  it("converts complete pasted fences and leaves incomplete fences as source", async () => {
    await render();
    const pasted = "Before\n\n```sql\nSELECT 1\n```\n\n```diagram\nnode\n```\n\n```python\nprint(1)";
    await paste(pasted); await blocks(2);
    expect(text()).toBe(pasted);
    expect(headers().map((header) => header.textContent)).toEqual(["sql", "diagram"]);
    expect(input().textContent).toContain("```python");
  });
  it("moves from the final code line into prose with Arrow Down", async () => {
    await render(); await type("```sql\nSELECT 1\n```"); await blocks(1);
    await cursor("```sql\nSELECT 1".length); await press("ArrowDown");
    expect(text()).toBe("```sql\nSELECT 1\n```\n");
    expect(input().selectionStart).toBe(text().length);
    await type("```sql\nSELECT 1\n```\nContinue here");
    await cursor("```sql\nSELECT 1".length); await press("ArrowDown");
    expect(view().state.doc.lineAt(input().selectionStart).text).toBe("Continue here");
  });
  it("moves into an adjacent code block without selecting its hidden opener", async () => {
    const source = "```sql\nSELECT 1\n```\n```python\nprint(1)\n```\n";
    await render(); await type(source); await blocks(2);
    await cursor(source.indexOf("\n```", source.indexOf("SELECT"))); await press("ArrowDown");
    expect(view().state.doc.lineAt(input().selectionStart).text).toBe("print(1)");
  });
  it("protects hidden fence markers from boundary deletion", async () => {
    await render(); await type(SQL_SOURCE); await blocks(1);
    await cursor(view().state.doc.line(2).from); await press("Backspace");
    expect(text()).toBe(SQL_SOURCE);
    await cursor(view().state.doc.line(2).to); await press("Delete");
    expect(text()).toBe(SQL_SOURCE);
  });
  it("keeps ordinary Shift+Enter as a prose newline", async () => {
    await render(); await type("first line"); await shiftEnter();
    expect(text()).toBe("first line\n"); expect(headers()).toEqual([]);
  });
  it("makes an empty pasted block editable from its visible body, by pointer or keyboard", async () => {
    await render(); await paste("```sql\n```\n"); await blocks(1);
    await act(async () => document.querySelector<HTMLElement>(".cm-code-block-empty")!.click());
    expect(text()).toBe("```sql\n\n```\n");
    expect(view().state.doc.lineAt(input().selectionStart).text).toBe("");
    await type("```sql\n```\n"); await blocks(1);
    await act(async () => document.querySelector<HTMLElement>(".cm-code-block-empty")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(text()).toBe("```sql\n\n```\n");
  });
  it("sends the draft as canonical fenced Markdown", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onNew }); await type(SQL_SOURCE); await blocks(1);
    await press("Enter");
    expect(onNew.mock.calls[0]?.[0].content).toEqual([{ type: "text", text: SQL_SOURCE }]);
  });
  it("keeps hidden fence source in the selection and in programmatic replacements", async () => {
    await render(); await type(SQL_SOURCE); await blocks(1);
    await act(async () => input().select());
    expect(input().selectionStart).toBe(0); expect(input().selectionEnd).toBe(SQL_SOURCE.length);
    // Dictation and suggestions change the composer's text; the block survives.
    await act(async () => runtime.thread.composer.setText(SQL_SOURCE.replace("you", "accounts")));
    expect(input().value).toBe("```sql\nSELECT * FROM accounts\n```\n"); expect(headers()).toHaveLength(1);
  });
  it("restores rich code blocks through prompt history", async () => {
    const source = SQL_SOURCE.trimEnd();
    await render({ messages: fromHistory([{ role: "user", content: source }]).messages });
    await press("ArrowUp"); await blocks(1);
    expect(text()).toBe(source);
  });
  it("renders unknown languages as labelled plain code without fuzzy matching", async () => {
    await render(); await type("```javascript-extra\nconst node = true;\n```\n"); await blocks(1);
    expect(headers()[0]!.textContent).toBe("javascript-extra");
    expect(codeLine().querySelector("span")).toBeNull();
    expect(text()).toBe("```javascript-extra\nconst node = true;\n```\n");
  });
});

describe("editor commands in the composer", () => {
  it("indents with Tab and outdents with Shift+Tab", async () => {
    await render(); await type("item"); await cursor(0);
    await press("Tab"); expect(text()).toBe("  item");
    await press("Tab", { shiftKey: true }); expect(text()).toBe("item");
  });
  it("continues Markdown lists and quotes on a new line", async () => {
    await render(); await act(async () => { await loadMarkdownEditing(); });
    await type("- first"); await shiftEnter();
    expect(text()).toBe("- first\n- ");
    await type("> quoted"); await shiftEnter(); expect(text()).toBe("> quoted\n> ");
  });
  it("undoes and redoes typing with the editor history", async () => {
    await render(); await type("draft"); await type("draft edited");
    await undo(); expect(text()).toBe("draft");
    await press("y", { ctrlKey: true }); expect(text()).toBe("draft edited");
  });
  it("stops typed text at an ask answer's limit, but keeps a longer answer from outside the editor", async () => {
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Why?", options: [] }] }, phase: { type: "answering" }, offline: false, onSubmit: () => {}, onDismiss: () => {}, onChat: async () => {} };
    await render({ ask });
    await type("x".repeat(4_000)); expect(text()).toHaveLength(4_000);
    await act(async () => { view().dispatch({ changes: { from: 4_000, insert: "y" }, userEvent: "input.type" }); });
    expect(text()).toHaveLength(4_000);
    await act(async () => runtime.thread.composer.setText("z".repeat(4_001)));
    expect(input().value).toHaveLength(4_001);
    await press("Backspace"); expect(text()).toHaveLength(4_000);
  });
  it("puts the caret after text the composer replaces, as a textarea would", async () => {
    await render(); await act(async () => runtime.thread.composer.setText("restored draft"));
    expect(input().value).toBe("restored draft"); expect(input().selectionStart).toBe("restored draft".length);
  });
  it("takes pasted files as attachments, not text", async () => {
    const adapter = createAttachmentAdapter(async () => ({ path: ".forgerie/attachments/a.txt", mimeType: "text/plain", size: 2 }));
    await render({ attachments: adapter });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [new File(["hi"], "a.txt", { type: "text/plain" })], getData: () => "hi", types: ["Files", "text/plain"] } });
    await act(async () => { input().dispatchEvent(event); });
    await vi.waitFor(() => expect(runtime.thread.composer.getState().attachments).toHaveLength(1));
    expect(event.defaultPrevented).toBe(true); expect(text()).toBe("");
    adapter.dispose();
  });
});

describe("lists and quotes in the composer", () => {
  const markers = () => [...document.querySelectorAll<HTMLElement>(".cm-md-marker")].map((node) => node.textContent);
  const lines = () => [...input().querySelectorAll<HTMLElement>(".cm-line")];
  it("draws bullets, numbers, and quote levels in place of their Markdown, which stays the draft", async () => {
    await render(); await type("Plan:\n- one\n  - two\n\n1. first\n> quoted\n> > deeper");
    expect(markers()).toEqual(["•", "◦", "1."]);
    expect(lines().map((line) => line.textContent)).toEqual(["Plan:", "•one", "◦two", "", "1.first", "quoted", "deeper"]);
    expect(lines()[2]!.style.getPropertyValue("--md-list").trim()).toBe("2");
    expect(lines()[6]!.classList.contains("cm-md-quote")).toBe(true);
    expect(lines()[6]!.style.getPropertyValue("--md-quote").trim()).toBe("2");
    expect(text()).toBe("Plan:\n- one\n  - two\n\n1. first\n> quoted\n> > deeper");
  });
  it("leaves a marker that is still being typed, list-shaped code, and a setext rule as text", async () => {
    await render(); await type("-");
    expect(markers()).toEqual([]);
    await type("```\n- not a list\n```\n"); expect(markers()).toEqual([]);
    await type("Title\n-"); expect(markers()).toEqual([]);
  });
  it("takes a bullet off with Backspace, and moves a nested item out one level first", async () => {
    await render(); await type("- one\n  - two"); await cursor("- one\n  - ".length);
    await press("Backspace"); expect(text()).toBe("- one\n- two");
    await press("Backspace"); expect(text()).toBe("- one\ntwo");
    await type("> quoted"); await cursor(2);
    await press("Backspace"); expect(text()).toBe("quoted");
  });
  it("sends Home to where an item's text starts, never before its hidden marker", async () => {
    await render(); await type("- hi"); await cursor(4);
    await press("Home"); expect(input().selectionStart).toBe(2);
    await press("Home"); expect(input().selectionStart).toBe(2);
  });
});

describe("Markdown niceties in the composer", () => {
  const box = () => document.querySelector<HTMLElement>(".cm-md-task");
  const classed = (name: string) => [...input().querySelectorAll<HTMLElement>(`.${name}`)].map((node) => node.textContent);
  it("draws a task item as a checkbox that a press or Ctrl+Shift+X checks, and Backspace turns back into a bullet", async () => {
    await render(); await type("- [ ] buy milk");
    expect(box()?.getAttribute("aria-checked")).toBe("false");
    expect(input().querySelector(".cm-line")!.textContent).toBe("buy milk");
    await act(async () => { box()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(text()).toBe("- [x] buy milk"); expect(box()?.getAttribute("aria-checked")).toBe("true");
    expect(input().querySelector(".cm-line")!.classList.contains("cm-md-done")).toBe(true);
    await cursor(text().length); await press("X", { ctrlKey: true, shiftKey: true, keyCode: 88 });
    expect(text()).toBe("- [ ] buy milk");
    await cursor("- [ ] ".length); await press("Backspace"); expect(text()).toBe("- buy milk");
  });
  it("continues a task list with an unchecked item on Enter", async () => {
    await render(); await act(async () => { await loadMarkdownEditing(); });
    await type("- [x] done"); await press("Enter"); expect(text()).toBe("- [x] done\n- [ ] ");
  });
  it("styles bold, italic, struck, code, and link text, and mutes their markers", async () => {
    await render(); await type("**bold** *it* ~~gone~~ `code` [site](https://example.com) # not a heading");
    expect(classed("cm-md-strong").join("")).toBe("**bold**");
    expect(classed("cm-md-em").join("")).toBe("*it*");
    expect(classed("cm-md-strike").join("")).toBe("~~gone~~");
    expect(classed("cm-md-code")).toEqual(["code"]);
    expect(classed("cm-md-link")).toContain("site");
    expect(classed("cm-md-url")).toEqual(["https://example.com"]);
    expect(classed("cm-md-mark")).toEqual(expect.arrayContaining(["**", "*", "~~", "`"]));
    await type("# Title"); expect(classed("cm-md-heading").join("")).toContain("Title");
  });
  it("draws a leading command as a chip, but not in an ask answer", async () => {
    await render(); await type("/review the branch");
    expect(classed("cm-leading-chip")).toEqual(["/review"]);
    await type("please /review"); expect(classed("cm-leading-chip")).toEqual([]);
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Why?", options: [] }] }, phase: { type: "answering" }, offline: false, onSubmit: () => {}, onDismiss: () => {}, onChat: async () => {} };
    await render({ ask }); await type("/review"); expect(classed("cm-leading-chip")).toEqual([]);
  });
  it("turns off correction and capitals while the caret is in a path, model, or command token", async () => {
    await render();
    const assisted = () => [input().getAttribute("spellcheck"), input().getAttribute("autocorrect"), input().getAttribute("autocapitalize"), input().getAttribute("writingsuggestions")];
    await type("fix it"); expect(assisted()).toEqual(["true", "on", "sentences", "true"]);
    for (const token of ["read @src/ui/the", "read @\"my folder/fi", "use #claude-op", "/revi"]) {
      await type(token); expect(assisted(), token).toEqual(["false", "off", "off", "false"]);
    }
    await type("read @src/ui/theme.css and"); expect(assisted()).toEqual(["true", "on", "sentences", "true"]);
    await type("mail me@example"); expect(assisted()[0]).toBe("true");
  });
  it("hangs a right-to-left item or quote from the right", async () => {
    await render(); await type("> שלום עולם\n- مرحبا\n- hello");
    const lines = [...input().querySelectorAll<HTMLElement>(".cm-line")];
    expect(lines.map((line) => line.getAttribute("dir"))).toEqual(["rtl", "rtl", null]);
  });
  it("makes selected text a link when a URL is pasted over it", async () => {
    await render(); await act(async () => { await loadMarkdownEditing(); });
    await type("see the docs"); await act(async () => { view().dispatch({ selection: EditorSelection.range(8, 12) }); });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => "https://example.com/docs", types: ["text/plain"] } });
    await act(async () => { input().dispatchEvent(event); });
    await vi.waitFor(() => expect(text()).toBe("see the [docs](https://example.com/docs)"));
  });
});
