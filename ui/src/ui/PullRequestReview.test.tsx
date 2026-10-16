// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestOpener, PullRequestReview, PullRequestRowMark } from "./PullRequestReview";
import { useSessionPulls } from "../pullRequests/useSessionPull";
import { firstToShow } from "../pullRequests/pullRequestModel";
import type { PullItem, PullLink, PullRequest, PullRequestApi } from "../pullRequests/pullRequestApi";

const TIME = "2026-10-07T12:00:00.000Z";
const SHA = "b".repeat(40);
const pull = (number: number, extra: Partial<PullRequest> = {}): PullRequest => ({ repo: "o/r", number, title: `Fix ${String(number)}`, url: `https://github.com/o/r/pull/${String(number)}`, state: "open",
  head: `fix-${String(number)}`, headSha: SHA, base: "main", author: "agent", updatedAt: TIME, mergeability: "clean", files: 1, additions: 2, deletions: 1,
  checks: [{ id: "run:1", name: "tests", state: "passed", url: "https://ci/1", required: true }], reviews: [], comments: [], complete: true,
  merge: { kind: "allowed" }, ...extra });
const failing = (number: number) => pull(number, { checks: [{ id: "run:1", name: "tests", state: "failed", url: "https://ci/1", required: true, logTail: "boom", logSource: "annotations" }],
  merge: { kind: "blocked", reason: "Every check must pass on this head commit." } });
const link = (number: number, watch: PullLink["watch"] = { kind: "off" }): PullLink => ({ provider: "github", session: { id: "s1", cwd: "/repo" }, repo: "o/r", number, watch });

/** A fake server that holds links the way the real one does: per pull request, never replacing another. */
function fakeApi(initial: PullItem[]) {
  let items = initial;
  const pulls = new Map(initial.flatMap((item) => item.pull ? [[item.link.number, item.pull] as const] : []));
  const setLink = (next: PullLink) => { items = items.some((item) => item.link.number === next.number) ? items.map((item) => item.link.number === next.number ? { ...item, link: next } : item) : [...items, { link: next, pull: pulls.get(next.number) ?? pull(next.number) }]; return next; };
  const linkOf = (number: number) => items.find((item) => item.link.number === number)?.link ?? link(number);
  const api = {
    open: vi.fn<PullRequestApi["open"]>(async () => ({ provider: "github", repo: "o/r", items: [], complete: true })),
    preview: vi.fn<PullRequestApi["preview"]>(async (_ref, number) => ({ provider: "github", pull: pull(number) })),
    list: vi.fn(async () => items),
    read: vi.fn(async (_ref, number: number) => { const item = items.find((candidate) => candidate.link.number === number); if (!item?.pull) throw new Error("gone"); return { link: item.link, pull: item.pull }; }),
    link: vi.fn(async (_ref, number: number) => { const next = setLink(linkOf(number)); return { link: next, pull: pulls.get(number) ?? pull(number) }; }),
    unlink: vi.fn(async (_ref, number: number) => { const removed = linkOf(number); items = items.filter((item) => item.link.number !== number); return removed; }),
    watch: vi.fn(async (_ref, number: number) => setLink(link(number, { kind: "watching", since: TIME, wakes: 0 }))),
    stopWatch: vi.fn(async (_ref, number: number) => setLink(link(number, { kind: "stopped", reason: "Stopped.", at: TIME }))),
    merge: vi.fn(async () => ({ text: "Merged." })),
  } satisfies PullRequestApi;
  return { api };
}

function Harness({ api, catalog = [], onAsk = () => {} }: { api: PullRequestApi; catalog?: PullLink[]; onAsk?: (text: string) => void }) {
  const state = useSessionPulls(api, { id: "s1", cwd: "/repo" }, catalog);
  const items = state.load.type === "ready" ? state.load.items : [];
  const [selected, setSelected] = useState<number>();
  return <>
    <PullRequestOpener pulls={items.flatMap((item) => item.pull ? [item.pull] : [])} links={state.links} onOpen={() => {}} />
    <PullRequestReview discovery={state.discovery} load={state.load} selected={selected ?? firstToShow(items)} onSelect={setSelected} reading={state.reading}
      notice={state.notice} writing={state.writing} now={Date.parse(TIME)}
      onRefresh={state.refresh} onAsk={onAsk} onWatch={(number, on) => { void state.setWatch(number, on); }} onLink={state.linkNumber}
      onUnlink={(number) => { void state.unlink(number); }} onMerge={(number) => { void state.merge(number, "rebase"); }} onClose={() => {}} />
  </>;
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const button = (name: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const selectedTab = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true")?.querySelector("b")?.textContent;
async function typeNumber(value: string) {
  const input = document.querySelector<HTMLInputElement>(".pr-link input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.querySelector<HTMLFormElement>(".pr-link")!.requestSubmit());
}

describe("several pull requests in one session", () => {
  it("explains invalid input without previewing or linking, and clears the error for a valid number", async () => {
    const { api } = fakeApi([]);
    await act(async () => root.render(<Harness api={api} />));
    await typeNumber("not a pull request");
    const input = document.querySelector<HTMLInputElement>(".pr-link input")!;
    const hint = document.querySelector<HTMLElement>(".pr-link [role='alert']")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.textContent).toContain("number");
    expect(button("Preview")?.disabled).toBe(true);
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.link).not.toHaveBeenCalled();
    await typeNumber("12");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(document.querySelector(".pr-link [role='alert']")).toBeNull();
    expect(api.preview).toHaveBeenCalledOnce();
    expect(api.link).not.toHaveBeenCalled();
  });

  it("lists repository PRs, previews a selection, and keeps failures explicit", async () => {
    const { api } = fakeApi([]);
    api.open.mockResolvedValueOnce({ provider: "github", repo: "o/r", items: [{ ...pull(12), state: "open" }], complete: false });
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector('[aria-label="Repository open pull requests"]')?.textContent).toContain("Showing the first 1");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Repository open pull requests"] .pr-check-line')!.click());
    expect(api.preview).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 12, expect.any(AbortSignal));
    expect(document.querySelector(".pr-title")?.textContent).toBe("Fix 12");
    expect(api.link).not.toHaveBeenCalled(); expect(api.watch).not.toHaveBeenCalled();
    api.preview.mockRejectedValueOnce(new Error("GitHub denied access."));
    await typeNumber("13");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("GitHub denied access.");
    expect(button("Link #12")).toBeUndefined();
    api.open.mockRejectedValueOnce(new Error("Repository cannot be read."));
    await act(async () => button("Read open PRs again")!.click());
    expect(document.querySelector('[aria-label="Repository open pull requests"] [role="alert"]')?.textContent).toContain("Repository cannot be read.");
    await typeNumber("14"); expect(button("Link #14")).toBeDefined();
  });

  it("discards an old preview when the input changes and rejects URLs for another repository", async () => {
    const { api } = fakeApi([]);
    let finish!: (value: Awaited<ReturnType<PullRequestApi["preview"]>>) => void;
    api.preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<Harness api={api} />));
    await typeNumber("12");
    const input = document.querySelector<HTMLInputElement>(".pr-link input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "13");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => finish({ provider: "github", pull: pull(12) }));
    expect(button("Link #12")).toBeUndefined();
    await typeNumber("https://github.com/another/repository/pull/13");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("does not belong");
    expect(api.link).not.toHaveBeenCalled();
  });

  it("shows the worst state in the header and opens on the pull request that needs the reader", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }, { link: link(10), pull: failing(10) }, { link: link(11), pull: pull(11, { state: "merged" }) }]);
    await act(async () => root.render(<Harness api={api} catalog={[link(9), link(10), link(11)]} />));
    const opener = document.querySelector(".pr-opener")!;
    expect(opener.getAttribute("data-tone")).toBe("failed");
    expect(opener.getAttribute("aria-label")).toBe("3 pull requests. Most urgent: #10: 1 check failed.");
    expect(opener.querySelector(".pr-count")?.textContent).toBe("3");
    expect(tabs().map((tab) => tab.querySelector("b")?.textContent)).toEqual(["#9", "#10", "#11"]);
    expect(selectedTab()).toBe("#10");
    expect(document.querySelector(".pr-verdict")?.textContent).toContain("1 check failed.");
  });

  it("switches pull requests and keeps each one's own watch and merge", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }, { link: link(10), pull: failing(10) }]);
    await act(async () => root.render(<Harness api={api} />));
    await act(async () => tabs()[0]!.click());
    expect(selectedTab()).toBe("#9");
    await act(async () => button("Watch")!.click());
    expect(api.watch).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 9);
    expect(tabs()[0]!.querySelector(".pr-tab-eye")).not.toBeNull();
    expect(tabs()[1]!.querySelector(".pr-tab-eye")).toBeNull();
    await act(async () => button("Merge")!.click());
    await act(async () => button("Merge now")!.click());
    expect(api.merge).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, expect.objectContaining({ number: 9, headSha: SHA }), "rebase");
    await act(async () => tabs()[1]!.click());
    expect(document.querySelector<HTMLButtonElement>(".pr-foot .changes-write")?.disabled).toBe(true);
  });

  it("links another pull request without replacing the first, and opens it", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }]);
    await act(async () => root.render(<Harness api={api} />));
    await act(async () => button("Link another")!.click());
    await typeNumber("12");
    expect(api.preview).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 12, expect.any(AbortSignal));
    expect(api.link).not.toHaveBeenCalled();
    expect(button("Watch")).toBeUndefined();
    expect(button("Merge")).toBeUndefined();
    expect(document.querySelector('[aria-label="Link preview"]')?.textContent).toContain("Not linked yet");
    await act(async () => button("Link #12")!.click());
    expect(api.link).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 12, { provider: "github", repo: "o/r" });
    expect(tabs().map((tab) => tab.querySelector("b")?.textContent)).toEqual(["#9", "#12"]);
    expect(selectedTab()).toBe("#12");
  });

  it("unlinks one pull request and leaves the rest", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }, { link: link(10, { kind: "watching", since: TIME, wakes: 0 }), pull: failing(10) }]);
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-unlink")?.textContent).toContain("Its watch stops too.");
    await act(async () => button("Unlink #10 from this session")!.click());
    expect(api.unlink).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 10);
    expect(tabs().map((tab) => tab.querySelector("b")?.textContent)).toEqual(["#9"]);
  });

  it("keeps a pull request whose read failed, without letting it hide another's state", async () => {
    const { api } = fakeApi([{ link: link(9), pull: null, error: "GitHub refused the read." }, { link: link(10), pull: pull(10) }]);
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-opener")?.getAttribute("data-tone")).toBe("ready");
    await act(async () => tabs()[0]!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("GitHub refused the read.");
  });

  it("rereads only the pull request the catalog reports changed", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }, { link: link(10), pull: pull(10) }]);
    await act(async () => root.render(<Harness api={api} catalog={[link(9), link(10)]} />));
    expect(api.list).toHaveBeenCalledOnce();
    await act(async () => root.render(<Harness api={api} catalog={[link(9), link(10, { kind: "watching", since: TIME, wakes: 1, lastWake: TIME })]} />));
    expect(api.read.mock.calls.map((call) => call[1])).toEqual([10]);
    expect(api.list).toHaveBeenCalledOnce();
    // A link the catalog drops leaves the panel.
    await act(async () => root.render(<Harness api={api} catalog={[link(10)]} />));
    expect(tabs().map((tab) => tab.querySelector("b")?.textContent)).toEqual(["#10"]);
  });

  it("puts a fix request for the pull request on show in the message box, fenced as data", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }, { link: link(10), pull: failing(10) }]);
    const onAsk = vi.fn();
    await act(async () => root.render(<Harness api={api} onAsk={onAsk} />));
    await act(async () => button("Ask the agent to fix it")!.click());
    expect(onAsk.mock.calls[0]![0]).toContain("pull request #10");
    expect(onAsk.mock.calls[0]![0]).toContain("```json");
  });
});

describe("one or no pull request", () => {
  it("offers the link form when nothing is linked", async () => {
    const { api } = fakeApi([]);
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-link")?.textContent).toContain("No pull request is linked");
    expect(document.querySelector(".pr-opener")?.getAttribute("aria-label")).toBe("Link a pull request");
    await typeNumber("9");
    expect(document.querySelector(".pr-verdict")?.textContent).toContain("Ready to merge.");
  });

  it("shows the server's merge refusal and offers no merge", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9, { checks: [], merge: { kind: "blocked", reason: "No CI ran on this commit." } }) }]);
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector(".pr-foot p")?.textContent).toBe("No CI ran on this commit.");
    expect(document.querySelector<HTMLButtonElement>(".pr-foot .changes-write")?.disabled).toBe(true);
  });

  it("reports a list failure in the server's words, with a retry", async () => {
    const { api } = fakeApi([{ link: link(9), pull: pull(9) }]);
    api.list.mockRejectedValueOnce(new Error("Forgerie's GitHub App cannot see o/r."));
    await act(async () => root.render(<Harness api={api} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("cannot see o/r");
    await act(async () => button("Try again")!.click());
    expect(document.querySelector(".pr-verdict")).not.toBeNull();
  });
});

describe("session row mark", () => {
  it("names every pull request and how many the agent watches", async () => {
    await act(async () => root.render(<PullRequestRowMark links={[link(9), link(10, { kind: "watching", since: TIME, wakes: 0 }), link(11)]} />));
    const mark = document.querySelector(".pr-row-mark")!;
    expect(mark.getAttribute("aria-label")).toBe("3 pull requests: #9, #10, #11, 1 watched by the agent");
    expect(mark.textContent).toBe("#11+2");
  });
});

describe("Azure pull requests", () => {
  it("labels the source and hides merge even if a response accidentally allows it", async () => {
    const azureLink: PullLink = { ...link(9), provider: "azure-devops" };
    const { api } = fakeApi([{ link: azureLink, pull: pull(9, { url: "https://dev.azure.com/o/p/_git/r/pullrequest/9" }) }]);
    await act(async () => root.render(<Harness api={api} catalog={[azureLink]} />));
    expect(document.querySelector(".pr-facts")?.textContent).toContain("Azure DevOps");
    expect(document.querySelector('a[aria-label="Open on Azure DevOps"]')).not.toBeNull();
    expect(button("Merge")).toBeUndefined();
    expect(document.querySelector(".pr-foot")).toBeNull();
    expect(button("Watch")).toBeDefined();
  });
  it("links the number from an Azure PR URL through the same API", async () => {
    const { api } = fakeApi([]);
    await act(async () => root.render(<Harness api={api} />));
    api.preview.mockResolvedValueOnce({ provider: "azure-devops", pull: pull(12, { repo: "o/Amaze Insights/r" }) });
    await typeNumber("https://dev.azure.com/o/Amaze%20Insights/_git/r/pullrequest/12");
    expect(api.link).not.toHaveBeenCalled();
    await act(async () => button("Link #12")!.click());
    expect(api.link).toHaveBeenCalledWith({ id: "s1", cwd: "/repo" }, 12, { provider: "azure-devops", repo: "o/Amaze Insights/r" });
  });
});
