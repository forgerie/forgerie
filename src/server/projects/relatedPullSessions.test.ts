import { expect, it } from "vitest";
import { relatedPullSessions } from "./relatedPullSessions.js";
import type { PullNote } from "../github/pullRequestService.js";
it("checks the owning chat, keeps the PR workspace, and routes notifications back without creating a session", async () => {
  const home = { id: "source", cwd: "/repo-a" }, target = { id: "source", cwd: "/repo-b/.worktree/task" };
  let active = true;
  const inspected: unknown[] = [], notices: unknown[] = [];
  const gateway = relatedPullSessions({ owner: () => Promise.resolve({ ref: home, active }) }, {
    inspect: (ref) => { inspected.push(ref); return Promise.resolve({ ref, available: true, settled: false, leaf: "leaf" }); },
    wake: (ref, notice) => { notices.push([ref, notice]); return Promise.resolve("delivered"); },
    note: (ref, notice) => { notices.push([ref, notice]); return Promise.resolve(); },
  });
  expect(await gateway.inspect(target)).toEqual({ ref: target, available: true, settled: false, leaf: "leaf" });
  expect(inspected).toEqual([home]);
  const notice = { id: "wake", text: "repo B check failed" };
  expect(await gateway.wake(target, notice, () => true)).toBe("delivered");
  const note: PullNote = { text: "Merged B", details: { kind: "merged", repo: "o/b", number: 1, headSha: "sha", method: "rebase", base: "main" } };
  await gateway.note?.(target, note);
  expect(notices).toEqual([[home, notice], [home, note]]);
  active = false;
  expect((await gateway.inspect(target)).available).toBe(false);
  expect(await gateway.wake(target, notice, () => true)).toBe("busy");
  await gateway.note?.(target, note);
  expect(notices).toHaveLength(2);
});
