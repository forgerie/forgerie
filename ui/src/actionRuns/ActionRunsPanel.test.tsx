// @vitest-environment happy-dom
import { act, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestReview } from "../ui/PullRequestReview";
import { runKey, type ActionRunApi, type SessionActionRuns } from "./actionRunApi";
import { createActionRunsStore } from "./actionRunsStore";
import { ActionRunsPanel } from "./ActionRunsPanel";
import { PullRunsSection } from "./PullRunsSection";
import { derived, failedRun, fixtureNow, items, link, passedRun, permissionError, session } from "./fixtures/actionRuns";
import { pullItem } from "./fixtures/pull";
import { runServer } from "./fixtures/runServer";


const server = (initial: SessionActionRuns) => runServer(initial, [passedRun]).api;

/** The pull request panel as the session binds it: the Actions tab and the runs under each linked pull request share one store. */
function Harness({ api, readOnly = false, first = true }: { api: ActionRunApi; readOnly?: boolean; first?: boolean }) {
  const [store] = useState(() => createActionRunsStore(api));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { store.setSession(session); store.open(); }, [store]);
  const actions = { onRefresh: store.refresh, onLink: store.link, onOpenRun: store.openDetail, onCloseRun: store.closeDetail,
    onUnlink: (key: string, id: number) => { void store.unlink(key, id); }, onWatch: (key: string, id: number, on: boolean) => { void store.setWatch(key, id, on); } };
  return <PullRequestReview load={{ type: "ready", items: [pullItem] }} selected={142} onSelect={() => {}} reading={new Set()} notice={undefined} writing={false}
    now={fixtureNow} onRefresh={() => store.recover()} onAsk={() => {}} onWatch={() => {}} onLink={async () => false} onUnlink={() => {}} onMerge={() => {}} onClose={() => {}}
    extraView={{ label: "Actions", title: "Workflow runs", first, onRefresh: store.refresh, content: <ActionRunsPanel state={state} now={fixtureNow} readOnly={readOnly} actions={actions} /> }}
    belowPull={(number) => <PullRunsSection number={number} state={state} now={fixtureNow} readOnly={readOnly} onWatch={actions.onWatch} onRefresh={store.refresh} />} />;
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const button = (name: string | RegExp) => [...document.querySelectorAll("button")].find((item) => typeof name === "string" ? item.textContent?.trim() === name : name.test(item.textContent ?? ""));
const press = async (element: Element | null | undefined) => { if (!element) throw new Error("Nothing to press."); await act(async () => { (element as HTMLElement).click(); }); };
const text = () => document.body.textContent ?? "";
async function render(api: ActionRunApi, options: { readOnly?: boolean; first?: boolean } = {}) {
  await act(async () => root.render(<Harness api={api} {...options} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function type(value: string) {
  const input = document.querySelector<HTMLInputElement>(".text-submit-input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { document.querySelector<HTMLFormElement>(".text-submit")!.requestSubmit(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("the Actions tab", () => {
  it("says no run is linked and links one by URL", async () => {
    const api = server({ items: [], derived: [] });
    await render(api);
    expect(text()).toContain("No linked runs");
    await type(passedRun.url);
    expect(api.link).toHaveBeenCalledWith(session, passedRun.url);
    expect(text()).not.toContain("No linked runs");
    expect(button(/^CI.*Retry dropped upload chunks/)?.textContent).toContain("Success");
    expect(document.querySelector<HTMLInputElement>(".text-submit-input")?.value).toBe("");
  });

  it("keeps a refused value and says why: not a run, or the server's words", async () => {
    const api = server({ items: [], derived: [] });
    await render(api);
    await type("ci");
    expect(api.link).not.toHaveBeenCalled();
    expect(document.querySelector(".text-submit-error")?.textContent).toContain("Paste a run's URL from GitHub");
    await type("4");
    expect(document.querySelector(".text-submit-error")?.textContent).toBe("GitHub has no run 4 on forgerie/forgerie.");
    expect(document.querySelector<HTMLInputElement>(".text-submit-input")?.value).toBe("4");
  });

  it("lists linked runs oldest first with their state, facts, and watch", async () => {
    await render(server({ items, derived }));
    const rows = [...document.querySelectorAll(".run-row")];
    expect(rows.map((row) => row.querySelector(".run-row-name")?.textContent)).toEqual(["CI", "Build SM8550", "CI"]);
    expect(rows[0]?.textContent).toContain("Failure");
    expect(rows[0]?.textContent).toContain("fix/upload-retry");
    expect(rows[0]?.textContent).toContain("3f9a2c4");
    expect(rows[0]?.textContent).toContain("attempt 2");
    // People read GitHub's run number; the run ID stays in routes and keys.
    expect(rows[0]?.querySelector(".run-row-fact")?.textContent).toBe("#4812");
    expect(rows[0]?.textContent).not.toContain(String(failedRun.runId));
    expect(rows[0]?.querySelector(".watch-toggle")?.getAttribute("aria-pressed")).toBe("true");
    expect(rows[0]?.querySelector(".watch-toggle")?.textContent).toContain("Watching2 wakes");
    expect(rows[2]?.textContent).toContain("Stopped: run completed (success).");
    // A finished run that is not watched offers no watch.
    expect(rows[2]?.querySelector(".watch-toggle")).toBeNull();
  });

  it("opens a run's jobs, failures first with their annotations, and goes back", async () => {
    const api = server({ items, derived });
    await render(api);
    await press(document.querySelector(".run-row-main"));
    expect(api.read).toHaveBeenCalledWith(session, failedRun.runId, expect.anything());
    expect(document.querySelector(".run-detail-title")?.textContent).toBe("Retry dropped upload chunks");
    expect(document.querySelector(".run-detail-verdict")?.textContent).toBe("2 of 7 jobs failed in 12m.");
    expect(document.querySelector(".run-detail-number")?.textContent).toBe("#4812");
    expect(button(/^Unlink run/)?.textContent).toBe("Unlink run #4812 from this session.");
    expect([...document.querySelectorAll(".job-list-name")].map((name) => name.textContent).slice(0, 3))
      .toEqual(["Failed: test (ubuntu-latest, node 24)", "Failed: test (macos-latest, node 24)", "Cancelled: e2e (chromium)"]);
    expect(document.querySelector(".job-list-log pre")?.textContent).toContain("AssertionError: expected 2 to be 3");
    await press(button("All runs"));
    expect(document.querySelector(".run-detail")).toBeNull();
    expect(document.querySelectorAll(".run-row")).toHaveLength(3);
  });

  it("stops a watch from the row and keeps the link; a finished run then offers no new watch", async () => {
    const api = server({ items, derived });
    await render(api);
    await press(document.querySelector(".run-row .watch-toggle"));
    expect(api.stopWatch).toHaveBeenCalledWith(session, failedRun.runId);
    const first = document.querySelector(".run-row");
    expect(first?.querySelector(".run-row-name")?.textContent).toBe("CI");
    expect(first?.querySelector(".run-row-note")?.textContent).toBe("Stopped: Stopped by you.");
    expect(first?.querySelector(".watch-toggle")).toBeNull();
    // The running one can still be stopped and watched again.
    const running = document.querySelectorAll(".run-row")[1];
    await press(running?.querySelector(".watch-toggle") ?? undefined);
    expect(document.querySelectorAll(".run-row")[1]?.querySelector(".watch-toggle")?.textContent).toBe("Watch again, run #4813");
  });

  it("keeps a run it could not read, and names the missing Actions permission with its link", async () => {
    await render(server({ items: [{ link: link(18234488888), run: null, error: permissionError }], derived: [] }));
    const problem = document.querySelector(".run-row-problem");
    expect(problem?.textContent).toContain("Forgerie's GitHub App needs Actions: read to read this run.");
    expect(problem?.querySelector("a")?.getAttribute("href")).toBe("https://github.com/settings/apps/forgerie-dev/permissions");
    expect(document.querySelector(".run-row-name")?.textContent).toBe("Run ID 18234488888");
  });

  it("offers no writes in a read-only session", async () => {
    await render(server({ items, derived }), { readOnly: true });
    expect(document.querySelector(".watch-toggle")).toBeNull();
    expect(document.querySelector(".text-submit")).toBeNull();
    expect(document.querySelector(".menu-button")).toBeNull();
  });
});

describe("runs under a linked pull request", () => {
  it("lists the runs on its head and links one when the reader watches it", async () => {
    const api = server({ items: [], derived });
    await render(api, { first: false });
    expect(document.querySelector(".run-list h3")?.textContent).toBe("Workflow runs on 3f9a2c4");
    const codeql = derived[0]!.runs[1]!;
    const row = [...document.querySelectorAll(".run-row")].find((candidate) => candidate.textContent?.includes("CodeQL"));
    expect(row?.querySelector(".run-row-main")?.getAttribute("href")).toBe(codeql.url);
    await press(row?.querySelector(".watch-toggle") ?? undefined);
    expect(api.watch).toHaveBeenCalledWith(session, codeql.runId);
    await press([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Actions"));
    expect([...document.querySelectorAll(".run-row-name")].map((name) => name.textContent)).toEqual(["CodeQL"]);
    expect(document.querySelector(".run-row .watch-toggle")?.getAttribute("aria-pressed")).toBe("true");
    expect(runKey(codeql)).toBe(`forgerie/forgerie#${String(codeql.runId)}`);
  });

  it("names the missing permission above the runs, with a retry", async () => {
    await render(server({ items: [], derived: [{ pull: 142, headSha: failedRun.headSha, runs: [], error: permissionError }] }), { first: false });
    const alert = document.querySelector(".run-list-alert");
    expect(alert?.textContent).toContain("needs Actions: read to read the runs on this commit.");
    expect(alert?.querySelector("button")?.textContent).toBe("Try again");
  });

  it("waits on the reread for a pull request linked since the last list, instead of saying it has no runs", async () => {
    let answer: (value: SessionActionRuns) => void = () => {};
    const api = server({ items: [], derived: [] });
    await render(api, { first: false });
    expect(text()).toContain("GitHub listed no runs for #142.");
    api.list.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    await press(document.querySelector('button[aria-label="Read the pull request again"]'));
    expect(text()).not.toContain("GitHub listed no runs");
    expect(document.querySelector(".run-list-skeleton")).not.toBeNull();
    await act(async () => { answer({ items: [], derived }); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.querySelector(".run-list h3")?.textContent).toBe("Workflow runs on 3f9a2c4");
  });
});
