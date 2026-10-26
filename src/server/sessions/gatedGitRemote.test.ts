import { afterEach, expect, it, vi } from "vitest";
import { remoteDefaultBranchReader, REMOTE_HEAD_TIMEOUT_MS } from "./gatedGitRemote.js";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";

afterEach(() => { vi.useRealTimers(); });

it("caches successful HEAD observations per push URL, expires them, and does not confuse relative local URLs", async () => {
  let now = 0; let branch = "main"; const calls: string[] = [];
  const git = (cwd: string, args: readonly string[]) => {
    if (args[0] === "config") return Promise.resolve("");
    if (args[0] === "remote") return Promise.resolve(args.at(-1) === "other" ? "../other.git\n" : "../remote.git\n");
    calls.push(`${cwd}:${args.join(" ")}`);
    return Promise.resolve(`ref: refs/heads/${branch}\tHEAD\n`);
  };
  const read = remoteDefaultBranchReader(git, () => now);
  expect(await read("/one/repo", "origin")).toBe("main");
  branch = "trunk";
  expect(await read("/one/repo", "alias")).toBe("main");
  expect(calls).toHaveLength(1);
  expect(await read("/two/repo", "origin")).toBe("trunk");
  expect(await read("/one/repo", "other")).toBe("trunk");
  now = 180_001;
  expect(await read("/one/repo", "origin")).toBe("trunk");
  expect(calls).toHaveLength(4);
});

it.each(["failure", "no-head", "multiple-urls", "rewrite", "timeout"])("gates a failed live default-branch observation: %s", async mode => {
  vi.useFakeTimers(); let calls = 0;
  const git = (_cwd: string, args: readonly string[]) => {
    if (args[0] === "symbolic-ref") return Promise.reject(new Error("No origin/HEAD"));
    if (args[0] === "config") return Promise.resolve(mode === "rewrite" ? "url.ssh://host/.insteadof\n" : "");
    if (args[0] === "remote") return Promise.resolve(mode === "multiple-urls" ? "/remote.git\n/other.git\n" : "/remote.git\n");
    calls++;
    if (mode === "timeout") return new Promise<string>(() => undefined);
    return mode === "failure" ? Promise.reject(new Error("Offline")) : Promise.resolve("");
  };
  const reads: GatedActionReads = {git, remoteDefaultBranch: remoteDefaultBranchReader(git), disposable: () => Promise.resolve(false), issueLabels: () => Promise.resolve([])};
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = gatedAction("bash", {command: "git push origin feature:feature"}, "/repo", reads);
    await vi.advanceTimersByTimeAsync(REMOTE_HEAD_TIMEOUT_MS + 1);
    expect((await result)?.category).toBe("force-push");
  }
  expect(calls).toBe(mode === "multiple-urls" || mode === "rewrite" ? 0 : 2);
});

it("does not consult the network for local HEAD observations or unrelated actions, and cannot use a cached reader with an uncertain cwd", async () => {
  let network = 0;
  const reads: GatedActionReads = {
    git: () => Promise.resolve("refs/remotes/origin/main\n"),
    remoteDefaultBranch: () => { network++; return Promise.resolve("main"); },
    disposable: () => Promise.resolve(false), issueLabels: () => Promise.resolve([]),
  };
  for (const command of ["git status", "git push origin feature", "git push -f origin feature", "git checkout --detach HEAD", "npm install"]) await gatedAction("bash", {command}, "/repo", reads);
  expect(network).toBe(0);
  expect((await gatedAction("bash", {command: "git -C $UNKNOWN push origin feature"}, "/repo", reads))?.category).toBe("force-push");
  expect(network).toBe(0);
});
