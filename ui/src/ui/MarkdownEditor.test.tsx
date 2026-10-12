// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { loadMarkdownKit } from "./markdownKit";

let root: Root;
beforeAll(async () => { await loadMarkdownKit(); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const SKILL = "---\nname: testing-guide\ndescription: How to test here.\n---\n\n# Testing guide\n\nRun the narrowest test first.\n";
const textbox = () => document.querySelector<HTMLElement>('[role="textbox"]')!;
const editor = () => (textbox() as HTMLElement & { editor: Editor }).editor;
async function render(props: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn<(text: string) => void>();
  const onSave = vi.fn<() => void>();
  await act(async () => root.render(<MarkdownEditor label="Edit SKILL.md" text={SKILL} onChange={onChange} onSave={onSave} {...props} />));
  return { onChange, onSave };
}

it("shows the body formatted and the front matter as it is written, above it", async () => {
  await render();
  expect(textbox().querySelector("h1")?.textContent).toBe("Testing guide");
  expect(document.querySelector("figure")?.textContent).toContain("name: testing-guide");
  expect(textbox().textContent).not.toContain("name: testing-guide");
});

it("never changes the file when it opens, takes focus, or moves the caret", async () => {
  const { onChange } = await render();
  await act(async () => { editor().commands.focus("end"); editor().commands.setTextSelection(3); });
  expect(onChange).not.toHaveBeenCalled();
});

it("gives back the whole file, front matter included, when the reader types", async () => {
  const { onChange } = await render();
  await act(async () => { editor().commands.focus("end"); editor().commands.insertContent(" Then the suite."); });
  expect(onChange).toHaveBeenLastCalledWith("---\nname: testing-guide\ndescription: How to test here.\n---\n\n# Testing guide\n\nRun the narrowest test first. Then the suite.\n");
});

it("gives back the file's own bytes once every edit is undone", async () => {
  const { onChange } = await render();
  await act(async () => { editor().commands.focus("end"); editor().commands.insertContent("!"); });
  await act(async () => { editor().commands.undo(); });
  expect(onChange).toHaveBeenLastCalledWith(SKILL);
});

it("saves with Control or Command and S", async () => {
  const { onSave } = await render();
  await act(async () => {
    textbox().dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  });
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("refuses edits when read-only and offers the notice's action", async () => {
  const onPress = vi.fn();
  await render({ readOnly: true, notice: { message: "Editing here would rewrite this file's Markdown in 2 places.", action: { label: "Edit source", onPress } } });
  expect(editor().isEditable).toBe(false);
  expect(textbox().getAttribute("aria-readonly")).toBe("true");
  expect(document.getElementById(textbox().getAttribute("aria-describedby")!)?.textContent).toContain("in 2 places");
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Edit source")?.click());
  expect(onPress).toHaveBeenCalledTimes(1);
});

it("never follows a link", async () => {
  await render({ text: "Read [the notes](https://example.com/notes).\n", readOnly: true });
  const link = textbox().querySelector("a")!;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
});

it("invites writing in an empty file", async () => {
  await render({ text: "" });
  expect(textbox().querySelector("[data-placeholder]")?.getAttribute("data-placeholder")).toBe("Empty file. Start writing.");
});
