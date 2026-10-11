// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueProposalCard } from "./IssueProposalCard";
import { CREATED, DISMISSED, GITHUB_FAILED, LONG, SHORT } from "./fixtures/proposals";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const buttons = () => [...document.querySelectorAll("button")].filter((button) => !button.hasAttribute("aria-expanded"));
const button = (name: string) => buttons().find((candidate) => candidate.textContent === name);
const text = () => document.body.textContent ?? "";
const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };

describe("an issue proposal in the thread", () => {
  it("shows what will be filed and offers Create issue and Dismiss", async () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();
    await render(<IssueProposalCard proposal={SHORT} onCreate={onCreate} onDismiss={onDismiss} />);
    expect(text()).toContain(SHORT.title);
    expect(text()).toContain("forgerie/forgerie");
    expect([...document.querySelectorAll("[aria-label='Labels'] li")].map((item) => item.textContent)).toEqual(["bug", "priority: high"]);
    expect(text()).toContain("Rotating the unfolded device clears the draft");
    expect(buttons().map((candidate) => candidate.textContent)).toEqual(["Dismiss", "Create issue"]);
    expect(document.querySelector(".decision-card")?.hasAttribute("data-open")).toBe(true);
    await act(async () => { button("Create issue")?.click(); });
    expect(onCreate).toHaveBeenCalledOnce();
    await act(async () => { button("Dismiss")?.click(); });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("reads Creating… with both choices disabled while the issue is made, and stays open", async () => {
    await render(<IssueProposalCard proposal={SHORT} pending="create" onCreate={vi.fn()} onDismiss={vi.fn()} />);
    expect(button("Creating…")?.disabled).toBe(true);
    expect(button("Dismiss")?.disabled).toBe(true);
    expect(text()).toContain("Rotating the unfolded device");
  });

  it("keeps a failure open with the server's words, Retry and Dismiss", async () => {
    const onCreate = vi.fn();
    await render(<IssueProposalCard proposal={SHORT} failure={{ decision: "create", message: GITHUB_FAILED }} onCreate={onCreate} onDismiss={vi.fn()} />);
    expect(document.querySelector("[role='alert']")?.textContent).toBe(GITHUB_FAILED);
    expect(buttons().map((candidate) => candidate.textContent)).toEqual(["Dismiss", "Retry"]);
    await act(async () => { button("Retry")?.click(); });
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("hides the old failure while the retry is on its way", async () => {
    await render(<IssueProposalCard proposal={SHORT} pending="create" failure={{ decision: "create", message: GITHUB_FAILED }} onCreate={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(button("Creating…")?.disabled).toBe(true);
  });

  it("closes to one line that links to the new issue in a new tab", async () => {
    await render(<IssueProposalCard proposal={SHORT} outcome={CREATED} onCreate={vi.fn()} onDismiss={vi.fn()} />);
    const links = document.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe(`Created #38: ${SHORT.title}`);
    expect(links[0]?.getAttribute("href")).toBe("https://github.com/forgerie/forgerie/issues/38");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noreferrer");
    expect(buttons()).toEqual([]);
    expect(text()).not.toContain("Rotating the unfolded device");
    expect(document.querySelector("[aria-label='Labels']")).toBeNull();
  });

  it("closes to Dismissed", async () => {
    await render(<IssueProposalCard proposal={SHORT} outcome={DISMISSED} onCreate={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.querySelector(".decision-card-closed")?.textContent).toBe("Dismissed");
    expect(buttons()).toEqual([]);
    expect(document.querySelector("a")).toBeNull();
    expect(text()).not.toContain("Rotating the unfolded device");
  });

  it("offers no choices in a read-only transcript and says the proposal waits", async () => {
    await render(<IssueProposalCard proposal={LONG} />);
    expect(buttons()).toEqual([]);
    expect(text()).toContain("Waiting for a decision.");
    expect(text()).toContain(LONG.title);
    expect(document.querySelectorAll("[aria-label='Labels'] li")).toHaveLength(12);
    expect(document.querySelector(".decision-card")?.hasAttribute("data-open")).toBe(false);
  });

  it("still links a decided proposal in a read-only transcript", async () => {
    await render(<IssueProposalCard proposal={SHORT} outcome={CREATED} />);
    expect(document.querySelector("a")?.getAttribute("href")).toBe(CREATED.url);
    expect(text()).not.toContain("Waiting for a decision.");
  });
});
