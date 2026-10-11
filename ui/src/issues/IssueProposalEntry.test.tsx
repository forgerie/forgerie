// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueProposalEntry, type IssueRequest } from "./IssueProposalEntry";
import type { IssueProposal } from "./issueProposal";
import { CREATED, DISMISSED, GITHUB_FAILED, SHORT } from "./fixtures/proposals";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const buttons = () => [...document.querySelectorAll("button")].filter((button) => !button.hasAttribute("aria-expanded"));
const button = (name: string) => buttons().find((candidate) => candidate.textContent === name);
const press = async (name: string) => { await act(async () => { button(name)?.click(); }); };
const alert = () => document.querySelector("[role='alert']")?.textContent;
const closedLine = () => document.querySelector(".decision-card-closed")?.textContent;
/** A request the test answers by hand, so the in-flight state can be read. */
function held() {
  const calls: { path: string; init: RequestInit; answer: (response: Response) => void; refuse: (error: unknown) => void }[] = [];
  const request: IssueRequest = (path, init) => new Promise((resolve, reject) => { calls.push({ path, init, answer: resolve, refuse: reject }); });
  return { request: vi.fn(request), calls };
}
const mount = async (request: IssueRequest, proposal: IssueProposal = SHORT, readOnly = false) => {
  await act(async () => { root.render(<IssueProposalEntry proposal={proposal} sessionId="session 1" cwd="/srv/forgerie" readOnly={readOnly} request={request} />); });
};

describe("the issue proposal binding", () => {
  it("creates the issue through the create route, shows Creating… meanwhile, then links the issue", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/sessions/session%201/issue-proposals/prop-short/create");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ cwd: "/srv/forgerie" });
    expect(button("Creating…")?.disabled).toBe(true);
    expect(button("Dismiss")?.disabled).toBe(true);
    await act(async () => { calls[0]?.answer(json(200, CREATED)); });
    const link = document.querySelector("a");
    expect(link?.textContent).toBe("Created issue #38");
    expect(link?.getAttribute("href")).toBe(CREATED.url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(buttons()).toEqual([]);
  });

  it("dismisses through the dismiss route", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Dismiss");
    expect(calls[0]?.path).toBe("/api/sessions/session%201/issue-proposals/prop-short/dismiss");
    expect(button("Dismissing…")?.disabled).toBe(true);
    expect(button("Create issue")?.disabled).toBe(true);
    await act(async () => { calls[0]?.answer(json(200, DISMISSED)); });
    expect(closedLine()).toBe("Dismissed");
  });

  it("shows GitHub's failure with Retry, and the retry creates the issue", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(502, { error: GITHUB_FAILED })); });
    expect(alert()).toBe(GITHUB_FAILED);
    expect(buttons().map((candidate) => candidate.textContent)).toEqual(["Dismiss", "Retry"]);
    await press("Retry");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.path).toMatch(/\/create$/);
    expect(alert()).toBeUndefined();
    await act(async () => { calls[1]?.answer(json(200, CREATED)); });
    expect(document.querySelector("a")?.getAttribute("href")).toBe(CREATED.url);
  });

  it("can still dismiss after a failed create", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(502, { error: GITHUB_FAILED })); });
    await press("Dismiss");
    await act(async () => { calls[1]?.answer(json(200, DISMISSED)); });
    expect(closedLine()).toBe("Dismissed");
  });

  it("shows the saved outcome from a 409 instead of an error", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(409, { error: "Already decided.", outcome: CREATED })); });
    expect(alert()).toBeUndefined();
    expect(document.querySelector("a")?.textContent).toBe("Created issue #38");
  });

  it("shows a dismissal another tab saved when this tab presses Create issue", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(409, { error: "Already decided.", outcome: DISMISSED })); });
    expect(alert()).toBeUndefined();
    expect(closedLine()).toBe("Dismissed");
  });

  it("names a 404 and a 400 in the server's words", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(404, { error: "This proposal is not on the session's current branch." })); });
    expect(alert()).toBe("This proposal is not on the session's current branch.");
    await press("Retry");
    await act(async () => { calls[1]?.answer(json(400, { error: "cwd is required." })); });
    expect(alert()).toBe("cwd is required.");
  });

  it("says when the request did not reach the server, or the answer had no words", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.refuse(new TypeError("Failed to fetch")); });
    expect(alert()).toBe("The request did not reach the server. Check the connection, then retry.");
    await press("Retry");
    await act(async () => { calls[1]?.answer(new Response("Bad gateway", { status: 502 })); });
    expect(alert()).toBe("The server answered with status 502.");
  });

  it("sends one request for a double tap", async () => {
    const { request, calls } = held();
    await mount(request);
    const create = button("Create issue");
    await act(async () => { create?.click(); create?.click(); });
    expect(calls).toHaveLength(1);
  });

  it("trusts the transcript's outcome once it arrives", async () => {
    const { request, calls } = held();
    await mount(request);
    await press("Create issue");
    await act(async () => { calls[0]?.answer(json(200, CREATED)); });
    await mount(request, { ...SHORT, outcome: DISMISSED });
    expect(closedLine()).toBe("Dismissed");
    expect(document.querySelector("a")).toBeNull();
  });

  it("offers no choices and sends nothing in a read-only transcript", async () => {
    const { request } = held();
    await mount(request, SHORT, true);
    expect(buttons()).toEqual([]);
    expect(closedLine()).toBe("Waiting for a decision.");
    expect(request).not.toHaveBeenCalled();
  });

  it("shows a recorded outcome without asking the server", async () => {
    const { request } = held();
    await mount(request, { ...SHORT, outcome: CREATED });
    expect(document.querySelector("a")?.getAttribute("href")).toBe(CREATED.url);
    expect(buttons()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
