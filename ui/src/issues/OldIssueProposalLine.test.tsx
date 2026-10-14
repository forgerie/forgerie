// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OldIssueProposalLine } from "./OldIssueProposalLine";
import type { OldIssueProposal } from "./oldIssueProposal";
import { CREATED_OLD, DISMISSED_OLD, DRAFT_TITLE, UNDECIDED_OLD, UNLINKED_OLD, UNTITLED_OLD } from "./fixtures/issues";

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const render = async (proposal: OldIssueProposal) => { await act(async () => root.render(<OldIssueProposalLine proposal={proposal} />)); };
const line = () => host.querySelector(".event-sentence")!;
const links = () => [...host.querySelectorAll("a")];

describe("an old issue proposal's line", () => {
  it("names the title and links the created issue", async () => {
    await render(CREATED_OLD);
    expect(line().textContent).toBe(`Proposed issue (old card): ${DRAFT_TITLE} — created #142`);
    expect(line().querySelector("strong")?.textContent).toBe(DRAFT_TITLE);
    expect(links().map((link) => [link.textContent, link.getAttribute("href"), link.target, link.rel]))
      .toEqual([["created #142", "https://github.com/forgerie/forgerie/issues/142", "_blank", "noreferrer"]]);
    expect(line().getAttribute("data-tone")).toBe("positive");
    expect(line().hasAttribute("data-hollow")).toBe(false);
  });

  it("says dismissed, with no link", async () => {
    await render(DISMISSED_OLD);
    expect(line().textContent).toBe("Proposed issue (old card): Show the card idea from the design review — dismissed");
    expect(links()).toEqual([]);
    expect(line().getAttribute("data-tone")).toBe("neutral");
    expect(line().hasAttribute("data-hollow")).toBe(false);
  });

  it("names only the title when the branch records no outcome, with a hollow dot", async () => {
    await render(UNDECIDED_OLD);
    expect(line().textContent).toBe(`Proposed issue (old card): ${DRAFT_TITLE}`);
    expect(line().hasAttribute("data-hollow")).toBe(true);
    expect(links()).toEqual([]);
  });

  it("still says a proposal was here when nothing names its title", async () => {
    await render(UNTITLED_OLD);
    expect(line().textContent).toBe("Proposed issue (old card) — dismissed");
    await render({});
    expect(line().textContent).toBe("Proposed issue (old card)");
    expect(line().querySelector("strong")).toBeNull();
  });

  it("keeps a created number without a web address, unlinked", async () => {
    await render(UNLINKED_OLD);
    expect(line().textContent).toBe(`Proposed issue (old card): ${DRAFT_TITLE} — created #142`);
    expect(links()).toEqual([]);
  });
});
