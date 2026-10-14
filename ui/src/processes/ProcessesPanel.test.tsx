// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManagedProcessInfo } from "@shared/apiTypes";
import { ProcessesPanel } from "./ProcessesPanel";
import type { ProcessesState } from "./processesStore";

let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const process: ManagedProcessInfo = { id: "reader", name: "Reader", command: "cat", cwd: "/project", pid: 0, startTime: 1, endTime: null,
  status: "running", exitCode: null, success: null, endReason: null, signal: null, errorMessage: null,
  supervision: "attached", notice: "Attached process: ends when Forgerie restarts." };
const actions = () => ({ onSelect: vi.fn(), onStop: vi.fn(), onWrite: vi.fn(async () => ({ ok: true as const, bytesWritten: 6 })), onRefresh: vi.fn(), onClose: vi.fn() });
const ready = (items = [process]): ProcessesState => ({ view: { kind: "ready", snapshot: { available: true, writeSupported: true, processes: items } } });
const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label)!;
it("shows attached labels and lost reasons in the list, and opens the chosen process", async () => {
  const a = actions();
  await act(async () => root.render(<ProcessesPanel state={ready([process, { ...process, id: "lost", name: "Lost reader", status: "exited", endReason: "lost", errorMessage: "supervisor lost" }])} {...a} />));
  expect(document.body.textContent).toContain("ends when Forgerie restarts");
  expect(document.body.textContent).toContain("supervisor lost");
  await act(async () => button("Open Reader").click());
  expect(a.onSelect).toHaveBeenCalledWith("reader");
});
it("keeps Stop, stdin and EOF available and shows merged output", async () => {
  const a = actions();
  await act(async () => root.render(<ProcessesPanel state={{ ...ready(), selected: "reader", output: "hello" }} {...a} />));
  expect(document.querySelector('[aria-label="Output of Reader"]')?.textContent).toContain("hello");
  expect(document.body.textContent).toContain("stdout and stderr share one ordered log");
  await act(async () => button("Stop").click()); expect(a.onStop).toHaveBeenCalledWith("reader");
  const field = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "hello\n"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  // A DOM change event matches the controlled input in happy-dom.
  await act(async () => field.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => button("Write stdin").click());
  expect(a.onWrite).toHaveBeenCalledWith("reader", "hello\n", false);
  await act(async () => button("Close stdin").click());
  expect(a.onWrite).toHaveBeenCalledWith("reader", "", true);
});
it("does not offer writes or Stop for a lost process", async () => {
  const a = actions();
  await act(async () => root.render(<ProcessesPanel state={{ ...ready([{ ...process, status: "exited", endReason: "lost", errorMessage: "supervisor lost" }]), selected: "reader" }} {...a} />));
  expect(document.querySelector("textarea")).toBeNull();
  expect(button("Stop")).toBeUndefined();
  expect(document.body.textContent).toContain("supervisor lost");
});
it("reports read failures with a retry action", async () => {
  const a = actions();
  await act(async () => root.render(<ProcessesPanel state={{ view: { kind: "failed", error: "Offline" } }} {...a} />));
  expect(document.body.textContent).toContain("Offline");
  await act(async () => button("Refresh").click()); expect(a.onRefresh).toHaveBeenCalledOnce();
});

it.each([{ input: "hello", bytesWritten: 2, remaining: "llo" }, { input: "😀", bytesWritten: 1, remaining: "" }])("does not resend written bytes after partial stdin: $input", async ({ input, bytesWritten, remaining }) => {
  const a = { ...actions(), onWrite: vi.fn(async () => ({ ok: false as const, reason: "stdin_full" as const, bytesWritten })) };
  await act(async () => root.render(<ProcessesPanel state={{ ...ready(), selected: "reader" }} {...a} />));
  const field = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, input); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Write stdin").click());
  expect(field.value).toBe(remaining);
  expect(a.onWrite).toHaveBeenCalledOnce();
  if (remaining === "") expect(document.body.textContent).toContain("partial write split a UTF-8 character");
});

it.each([
  { status: "running", label: "Running" },
  { status: "terminating", label: "Terminating" },
  { status: "terminate_timeout", label: "Termination timed out" },
  { status: "exited", label: "Exited" },
  { status: "killed", label: "Killed" },
  { status: "exited", endReason: "lost", label: "Lost" },
] as const)("uses the same sentence-case $label label in the list and detail", async (example) => {
  const item: ManagedProcessInfo = { ...process, status: example.status, endReason: "endReason" in example ? example.endReason ?? null : null };
  await act(async () => root.render(<ProcessesPanel state={ready([item])} {...actions()} />));
  expect(document.querySelector(".status-row-status")?.textContent).toBe(example.label);
  await act(async () => root.render(<ProcessesPanel state={{ ...ready([item]), selected: item.id }} {...actions()} />));
  expect(document.querySelector(".sheet-dialog-subtitle")?.textContent).toBe(example.label);
  expect(document.querySelector(".event-line-phrase")?.textContent).toBe(example.label);
});
