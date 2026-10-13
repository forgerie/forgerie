// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatedActionCard } from "./GatedActionCard";
import type { GatedAction } from "./gatedActionsModel";
import { PUSH, PUSH_ENTRY, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, PUSH_UNKNOWN, REPLY, REPLY_ENTRY, RESET, RESET_ENTRY } from "./fixtures/gatedActions";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
const text = () => document.body.textContent ?? "";
const card = () => document.querySelector(".decision-card")!;
const closedLine = () => document.querySelector(".decision-card-closed");
const choices = () => [...document.querySelectorAll(".decision-card-foot button")].map((node) => node.textContent);
const render = (record: GatedAction | undefined, extra: Partial<Parameters<typeof GatedActionCard>[0]> = {}) => act(async () => root.render(
  <GatedActionCard entry={PUSH_ENTRY} record={record} read onApprove={() => {}} onRefuse={() => {}} {...extra} />));

describe("a gated action that waits on the reader", () => {
  it("says what the call does, shows the exact command, its category and who asked, and offers Refuse and Approve and run", async () => {
    const onApprove = vi.fn();
    const onRefuse = vi.fn();
    await render(PUSH, { onApprove, onRefuse });
    expect(card().getAttribute("aria-label")).toBe("Force-push feat/run-export to origin");
    expect(card().hasAttribute("data-open")).toBe(true);
    expect(card().hasAttribute("data-pin-choices")).toBe(true);
    expect(document.querySelector(".decision-card-meta")?.textContent).toBe("Force-push or push to the default branch, asked by build");
    const command = document.querySelector("[aria-label='Command'] .command-block-code")!;
    expect(command.textContent).toBe("git push --force-with-lease origin feat/run-export");
    expect(command.hasAttribute("data-shell")).toBe(true);
    expect(text()).toContain("commits that exist only there are lost. Approve runs it once, exactly as shown.");
    // Approve is the one filled choice, and the last one.
    expect(choices()).toEqual(["Refuse", "Approve and run"]);
    expect(button("Approve and run")?.dataset["tone"]).toBe("primary");
    expect(button("Refuse")?.dataset["tone"]).toBeUndefined();
    await act(async () => { button("Approve and run")?.click(); });
    expect(onApprove).toHaveBeenCalledOnce();
    await act(async () => { button("Refuse")?.click(); });
    expect(onRefuse).toHaveBeenCalledOnce();
    expect(closedLine()).toBeNull();
  });

  it("shows a long command whole, line for line", async () => {
    await act(async () => root.render(<GatedActionCard entry={RESET_ENTRY} record={RESET} read onApprove={() => {}} onRefuse={() => {}} />));
    expect(document.querySelector(".command-block-code")?.textContent).toBe(RESET.args["command"]);
    expect(document.querySelector(".decision-card-meta")?.textContent).toBe("Discard local work, asked by the parent");
  });

  it("shows another tool's short form, with every argument behind one press", async () => {
    await act(async () => root.render(<GatedActionCard entry={REPLY_ENTRY} record={REPLY} read onApprove={() => {}} onRefuse={() => {}} />));
    const call = document.querySelector("[aria-label='Call'] .command-block-code")!;
    expect(call.textContent).toBe(REPLY_ENTRY.command);
    expect(call.hasAttribute("data-shell")).toBe(false);
    expect(document.querySelector(".disclosure-summary")?.textContent).toBe("All arguments to ebay_seller_message_reply");
    expect(document.querySelector("[aria-label='Arguments']")?.textContent).toContain("and there is a small mark on the hinge, shown in photo 6.");
  });

  it("locks both choices while one is on its way, and says which", async () => {
    await render(PUSH, { deciding: "approve" });
    expect(text()).toContain("Approving…");
    expect(button("Approve and run")?.disabled).toBe(true);
    expect(button("Refuse")?.disabled).toBe(true);
    await render(PUSH, { deciding: "refuse" });
    expect(text()).toContain("Refusing…");
  });

  it("keeps the card open with the reason when a choice failed", async () => {
    await render(PUSH, { problem: "This action is not waiting." });
    expect(card().hasAttribute("data-open")).toBe(true);
    expect(document.querySelector("[role='alert']")?.textContent).toBe("This action is not waiting.");
    expect(button("Approve and run")?.disabled).toBe(false);
  });

  it("trusts its entry before the session's records are read", async () => {
    await act(async () => root.render(<GatedActionCard entry={PUSH_ENTRY} read={false} onApprove={() => {}} onRefuse={() => {}} />));
    expect(card().hasAttribute("data-open")).toBe(true);
    expect(document.querySelector(".command-block-code")?.textContent).toBe(PUSH_ENTRY.command);
  });
});

describe("a gated action once decided", () => {
  it("says it is running", async () => {
    await render(PUSH_RUNNING);
    expect(card().hasAttribute("data-open")).toBe(false);
    expect(closedLine()?.textContent).toBe("Approved — running…");
    expect(choices()).toEqual([]);
    expect(text()).not.toContain("Approve runs it once");
    // The command stays, as the record of what runs.
    expect(document.querySelector(".command-block-code")?.textContent).toBe("git push --force-with-lease origin feat/run-export");
  });

  it("says it ran, with what it printed under a way to read all of it", async () => {
    await render(PUSH_RAN);
    expect(closedLine()?.textContent).toBe("Approved — ran");
    expect(closedLine()?.hasAttribute("data-tone")).toBe(false);
    const result = document.querySelector(".decision-card-detail [aria-label='Result']")!;
    expect(result.textContent).toContain("feat/run-export -> feat/run-export (forced update)");
    expect(result.querySelector(".excerpt")).not.toBeNull();
  });

  it("says it ran and nothing more when it printed nothing", async () => {
    await render({ ...PUSH, state: { kind: "ran", result: { content: [{ type: "text", text: "\n" }], details: { exitCode: 0 }, diagnostics: [] }, at: 1 } });
    expect(closedLine()?.textContent).toBe("Approved — ran");
    // A result with no text still shows what it holds.
    await render({ ...PUSH, state: { kind: "ran", result: null, at: 1 } });
    expect(closedLine()?.textContent).toBe("Approved — ran");
    expect(document.querySelector(".decision-card-detail")).toBeNull();
  });

  it("says it failed in the failure ink, with the first line of the error, and the whole error under it", async () => {
    await render(PUSH_FAILED);
    expect(closedLine()?.textContent).toBe("Approved — failed: ! [rejected]        feat/run-export -> feat/run-export (stale info)");
    expect(closedLine()?.getAttribute("data-tone")).toBe("bad");
    expect(document.querySelector(".decision-card-detail [aria-label='Error']")?.textContent).toContain("hint: The remote branch moved");
  });

  it("says a one-line failure once", async () => {
    await render({ ...PUSH, state: { kind: "failed", error: "fatal: could not read from remote repository.", at: 1 } });
    expect(closedLine()?.textContent).toBe("Approved — failed: fatal: could not read from remote repository.");
    expect(document.querySelector(".decision-card-detail")).toBeNull();
  });

  it("says an interrupted run's outcome is unknown, with the server's advice under it in plain words", async () => {
    await render(PUSH_UNKNOWN);
    expect(closedLine()?.textContent).toBe("Approved — outcome unknown: the approved action was interrupted and may have run");
    expect(closedLine()?.getAttribute("data-tone")).toBe("bad");
    expect(document.querySelector(".decision-card-detail")?.textContent).toBe("It will not be run again. Check its effects before requesting another action.");
    expect(document.querySelector(".decision-card-detail .command-block")).toBeNull();
  });

  it("says it was refused", async () => {
    await render(PUSH_REFUSED);
    expect(closedLine()?.textContent).toBe("Refused");
    expect(choices()).toEqual([]);
  });

  it("says when the records no longer hold it", async () => {
    await render(undefined);
    expect(closedLine()?.textContent).toBe("This action is no longer in the session's records.");
  });
});

describe("a gated action in a read-only transcript", () => {
  it("offers no choice, and says what became of the call", async () => {
    await act(async () => root.render(<GatedActionCard entry={PUSH_ENTRY} record={PUSH} read />));
    expect(card().hasAttribute("data-open")).toBe(false);
    expect(closedLine()?.textContent).toBe("Waiting for a decision.");
    expect(button("Approve and run")).toBeUndefined();
    expect(button("Refuse")).toBeUndefined();
    await act(async () => root.render(<GatedActionCard entry={PUSH_ENTRY} record={PUSH_RAN} read />));
    expect(closedLine()?.textContent).toBe("Approved — ran");
  });
});
