// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptMessage } from "../transcript";
import type { ShellRun } from "../shellRun";
import type { ShellAvailability } from "../shellDraft";
import type { AskBinding } from "./useAskMode";
import { useThreadMessages } from "../useThreadMessages";
import { Thread } from "./Thread";

let root: Root;
const row = (run: ShellRun, id = "shell-1"): TranscriptMessage => ({ id, role: "shell", parts: [{ type: "shell", run }] });
interface Props {
  messages?: TranscriptMessage[]; running?: boolean; availability?: ShellAvailability;
  onRun?: (text: string) => Promise<void>; onCancel?: () => Promise<void>; ask?: AskBinding;
}
function Fixture({ messages = [], running = false, availability = { type: "ready" }, onRun = async () => {}, onCancel = async () => {}, ask }: Props) {
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, running), onNew: async () => {}, onCancel, isRunning: running });
  return <AssistantRuntimeProvider runtime={runtime}><Thread ask={ask} shell={{ availability, onRun }} /></AssistantRuntimeProvider>;
}
const render = (props: Props = {}) => act(async () => root.render(<Fixture {...props} />));
const input = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent === name || node.getAttribute("aria-label") === name);
const shellRow = () => document.querySelector<HTMLElement>(".shell-run")!;
function type(text: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string, shiftKey = false) => act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, shiftKey })); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("shell rows in the thread", () => {
  it("shows the command above its output with the exit status, context exclusion, and saved-output notes", async () => {
    await render({ messages: [row({ command: "npm test", excludeFromContext: true, result: {
      type: "done", output: "1 failed\n", exitCode: 1, cancelled: false, truncated: true, fullOutputPath: "/tmp/pi-bash.log" } })] });
    expect(shellRow().querySelector(".shell-command")?.textContent).toBe("$ npm test");
    expect(shellRow().querySelector(".shell-output")?.textContent).toBe("1 failed\n");
    expect(shellRow().querySelector(".shell-status")?.textContent).toBe("exit 1");
    expect(shellRow().querySelector(".shell-status")?.getAttribute("data-tone")).toBe("error");
    expect(shellRow().querySelector(".shell-context")?.textContent).toBe("excluded from context");
    expect(shellRow().textContent).toContain("Output truncated. Full output: /tmp/pi-bash.log");
    expect(button("Copy output")).toBeDefined();
    expect(document.querySelectorAll(".message-system .system-label")).toHaveLength(0);
  });
  it("marks a running command live and follows new output", async () => {
    const running = (output: string) => row({ command: "sleep 5", excludeFromContext: false, result: { type: "running", output } });
    await render({ messages: [running("")] });
    expect(shellRow().querySelector(".shell-status")?.textContent).toBe("running");
    expect(shellRow().querySelector(".shell-status")?.hasAttribute("data-live")).toBe(true);
    expect(shellRow().textContent).toContain("Waiting for output.");
    await render({ messages: [running("tick\n")] });
    expect(shellRow().querySelector(".shell-output")?.textContent).toBe("tick\n");
    expect(shellRow().querySelector(".shell-context")).toBeNull();
  });
  it("names empty, failed, stopped, and unknown-command results instead of showing blank output", async () => {
    await render({ messages: [
      row({ command: "true", excludeFromContext: false, result: { type: "done", output: "", exitCode: 0, cancelled: false, truncated: false } }, "a"),
      row({ command: "make", excludeFromContext: false, result: { type: "failed", output: "", error: "spawn ENOENT" } }, "b"),
      row({ result: { type: "interrupted", output: "partial" } }, "c"),
      row({ command: "yes", excludeFromContext: false, result: { type: "done", output: "y\n", cancelled: true, truncated: false } }, "d"),
    ] });
    const rows = [...document.querySelectorAll<HTMLElement>(".shell-run")];
    expect(rows.map((node) => node.querySelector(".shell-status")?.textContent)).toEqual(["exit 0", "failed", "no result", "cancelled"]);
    expect(rows[0]!.textContent).toContain("No output.");
    expect(rows[1]!.querySelector("[role=alert]")?.textContent).toBe("spawn ENOENT");
    expect(rows[2]!.querySelector(".shell-command")?.textContent).toBe("$ Started before this page connected.");
    expect(rows[2]!.textContent).toContain("The result did not arrive. Reload to see the saved result.");
  });
});

describe("shell mode in the one composer", () => {
  it("names the mode, runs on Enter, and clears the draft", async () => {
    const onRun = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    await render({ onRun });
    await type("!ls -la");
    expect(document.querySelector(".composer-hint")?.textContent).toBe("Shell command. The agent sees its output.");
    expect(button("Send message")).toBeUndefined();
    await press("Enter", true); expect(onRun).not.toHaveBeenCalled();
    await press("Enter");
    expect(onRun).toHaveBeenCalledExactlyOnceWith("!ls -la");
    expect(input().value).toBe("");
    await type("!!git status");
    expect(document.querySelector(".composer-hint")?.textContent).toBe("Shell command. Its output stays out of the agent's context.");
  });
  it("stays available beside Stop during an agent run", async () => {
    const onRun = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    await render({ running: true, onRun });
    await type("!date");
    expect(button("Stop generating")).toBeDefined();
    await act(async () => button("Run command")!.click());
    expect(onRun).toHaveBeenCalledWith("!date");
  });
  it("explains why a command cannot run and keeps the draft", async () => {
    const onRun = vi.fn<(text: string) => Promise<void>>();
    await render({ onRun, availability: { type: "blocked", reason: "Wait for the running shell command to finish." } });
    await type("!pwd");
    expect(document.querySelector(".composer-hint")?.textContent).toBe("Wait for the running shell command to finish.");
    expect(button("Run command")?.disabled).toBe(true);
    await press("Enter");
    expect(onRun).not.toHaveBeenCalled();
    expect(input().value).toBe("!pwd");
    await render({ onRun }); await type("!");
    expect(document.querySelector(".composer-hint")?.textContent).toBe("Type a command after !.");
    expect(button("Run command")?.disabled).toBe(true);
  });
  it("puts a rejected command back only when no newer draft replaced it", async () => {
    let reject!: (error: Error) => void;
    const onRun = () => new Promise<void>((_, failed) => { reject = failed; });
    await render({ onRun }); await type("!ls");
    await press("Enter");
    await act(async () => reject(new Error("busy")));
    expect(input().value).toBe("!ls");
    await press("Enter"); await type("newer thought");
    await act(async () => reject(new Error("busy")));
    expect(input().value).toBe("newer thought");
  });
  it("leaves !@ file mentions and ordinary text in chat mode", async () => {
    await render();
    for (const text of ["!@src/app.ts", "explain !ls"]) {
      await type(text);
      expect(document.querySelector(".composer-hint")).toBeNull();
      expect(button("Send message")).toBeDefined();
    }
  });
  it("runs a shell command from ask mode without answering or closing the questions", async () => {
    const onChat = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const onSubmit = vi.fn();
    const ask: AskBinding = { ask: { askId: "a", askedAt: "now", questions: [{ id: "q", question: "Which file?", options: [] }] },
      phase: { type: "answering" }, offline: false, onChat, onDismiss: () => {}, onSubmit };
    await render({ ask }); await type("!ls src");
    await act(async () => button("Run command")!.click());
    expect(onChat).toHaveBeenCalledWith("!ls src");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector(".ask")).not.toBeNull();
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });
});
