// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestOpener, PullRequestReview } from "./PullRequestReview";
import { useSessionPull } from "../pullRequests/useSessionPull";
import type { PullLink, PullRequest, PullRequestApi } from "../pullRequests/pullRequestApi";

const TIME = "2026-10-07T12:00:00.000Z";
const SHA = "b".repeat(40);
const pull = (extra: Partial<PullRequest> = {}): PullRequest => ({ repo: "o/r", number: 9, title: "Fix tests", url: "https://github.com/o/r/pull/9", state: "open",
  head: "fix", headSha: SHA, base: "main", author: "agent", updatedAt: TIME, mergeability: "clean", files: 1, additions: 2, deletions: 1,
  checks: [{ id: "run:1", name: "tests", state: "passed", url: "https://ci/1", required: true }], reviews: [], comments: [], complete: true,
  merge: { kind: "allowed" }, ...extra });
const link = (watch: PullLink["watch"] = { kind: "off" }): PullLink => ({ session: { id: "s1", cwd: "/repo" }, repo: "o/r", number: 9, watch });

function fakeApi(initial: { link: PullLink | null; pull: PullRequest | null }) {
  let current = initial;
  const api = {
    read: vi.fn(async () => current),
    link: vi.fn(async () => { current = { link: link(), pull: pull() }; return current; }),
    // The server's read reflects its own watch state, as the real one does.
    watch: vi.fn(async () => { const next = link({ kind: "watching", since: TIME, wakes: 0 }); current = { ...current, link: next }; return next; }),
    stopWatch: vi.fn(async () => { const next = link({ kind: "stopped", reason: "Stopped.", at: TIME }); current = { ...current, link: next }; return next; }),
    merge: vi.fn(async () => ({ text: "Merged #9." })),
  } satisfies PullRequestApi;
  return { api, set: (next: typeof current) => { current = next; } };
}

function Harness({ api, catalogLink, onAsk = () => {} }: { api: PullRequestApi; catalogLink?: PullLink | undefined; onAsk?: (text: string) => void }) {
  const state = useSessionPull(api, { id: "s1", cwd: "/repo" }, catalogLink);
  return <>
    <PullRequestOpener pr={state.load.type === "ready" ? state.load.value : undefined} link={state.link} onOpen={() => {}} />
    <PullRequestReview load={state.load} link={state.link} notice={state.notice} writing={state.writing} now={Date.parse(TIME)}
      onRefresh={state.refresh} onAsk={onAsk} onWatch={(on) => { void state.setWatch(on); }} onLink={(number) => { void state.linkNumber(number); }}
      onMerge={() => { void state.merge("rebase"); }} onClose={() => {}} />
  </>;
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const button = (name: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);

describe("session pull request panel", () => {
  it("links an existing pull request by number, then shows what the server read", async () => {
    const { api } = fakeApi({ link: null, pull: null });
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-link")?.textContent).toContain("No pull request is linked");
    const input = document.querySelector<HTMLInputElement>(".pr-link input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "9");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLFormElement>(".pr-link")!.requestSubmit());
    expect(api.link).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 9);
    expect(document.querySelector(".pr-verdict")?.textContent).toContain("Ready to merge. All 1 check passed.");
  });

  it("shows the server's merge refusal and offers no merge", async () => {
    const { api } = fakeApi({ link: link(), pull: pull({ checks: [], merge: { kind: "blocked", reason: "No CI ran on this commit." } }) });
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-verdict")?.textContent).toContain("No checks ran on this commit");
    expect(document.querySelector(".pr-foot p")?.textContent).toBe("No CI ran on this commit.");
    expect(document.querySelector<HTMLButtonElement>(".pr-foot .changes-write")?.disabled).toBe(true);
  });

  it("merges only after confirmation, bound to the head commit that was read", async () => {
    const { api } = fakeApi({ link: link(), pull: pull() });
    await act(async () => root.render(<Harness api={api} />));
    await act(async () => button("Merge")!.click());
    expect(document.querySelector(".pr-foot p")?.textContent).toContain(SHA.slice(0, 7));
    expect(api.merge).not.toHaveBeenCalled();
    await act(async () => button("Merge now")!.click());
    expect(api.merge).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, expect.objectContaining({ repo: "o/r", number: 9, headSha: SHA }), "rebase");
    expect(document.querySelector(".pr-notice")?.textContent).toBe("Merged #9.");
  });

  it("starts and stops a watch, and reads again when the catalog reports a wake", async () => {
    const { api } = fakeApi({ link: link(), pull: pull() });
    await act(async () => root.render(<Harness api={api} catalogLink={link()} />));
    await act(async () => button("Watch")!.click());
    expect(api.watch).toHaveBeenCalledOnce();
    expect(document.querySelector(".pr-watch")?.getAttribute("data-watch")).toBe("watching");
    const reads = api.read.mock.calls.length;
    await act(async () => root.render(<Harness api={api} catalogLink={link({ kind: "watching", since: TIME, wakes: 1, lastWake: TIME })} />));
    expect(api.read.mock.calls.length).toBe(reads + 1);
    await act(async () => button("Stop watching")!.click());
    expect(api.stopWatch).toHaveBeenCalledOnce();
  });

  it("puts a failed check's fix request in the message box, with GitHub text fenced as data", async () => {
    const { api } = fakeApi({ link: link(), pull: pull({ checks: [{ id: "run:1", name: "tests", state: "failed", url: "https://ci/1", required: true, logTail: "boom", logSource: "annotations" }],
      merge: { kind: "blocked", reason: "Every check must pass on this head commit." } }) });
    const onAsk = vi.fn();
    await act(async () => root.render(<Harness api={api} onAsk={onAsk} />));
    await act(async () => button("Ask the agent to fix it")!.click());
    expect(onAsk).toHaveBeenCalledOnce();
    expect(onAsk.mock.calls[0]![0]).toContain("```json");
    expect(onAsk.mock.calls[0]![0]).toContain("\"annotations\": \"boom\"");
  });

  it("reports a read failure in the server's words, with a retry", async () => {
    const { api } = fakeApi({ link: link(), pull: pull() });
    api.read.mockRejectedValueOnce(new Error("Forgerie's GitHub App cannot see o/r."));
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot see o/r");
    await act(async () => button("Try again")!.click());
    expect(document.querySelector(".pr-verdict")).not.toBeNull();
  });
});
