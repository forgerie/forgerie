import { expect, it } from "vitest";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";
const reads: GatedActionReads = {
  git: (_cwd, args) => Promise.resolve(args[0] === "status" ? " M dirty.txt" : args[0] === "branch" ? "merged\nmain\n" : args.includes("--short") ? "feature\n" : "refs/remotes/origin/main\n"),
  issueLabels: (_cwd, id) => Promise.resolve(String(id) === "7" ? ["agent-filed"] : []),
};
const cases: [string, string | undefined][] = [
  ["GIT_DIR=x git push origin feature", "force-push"], ["git --git-dir=x restore file", "destroy-local"],
  ["env TOKEN=x git push -f", "force-push"], ["npm run publish", undefined], ["npm view publish", undefined],
  ["bash <<EOF\ngit push -f\nEOF", "force-push"], ["npm --prefix x publish", "publish"],
  ["git push origin feature", undefined], ["git push -u origin HEAD", undefined],
  ["git push --force-with-lease", "force-push"], ["git -C x push -f", "force-push"],
  ['echo "git push -f"', undefined], ["git reset --soft", undefined], ["git clean -n", undefined],
  ["gh pr view", undefined], ["npm publish --dry-run", "publish"], ["npm publish", "publish"],
  ["git push origin main", "force-push"], ["git push origin feature:main", "force-push"],
  ["git push --force origin feature", "force-push"], ["git push origin +feature", "force-push"],
  ["git push origin feature --force-with-lease=main:abc", "force-push"], ["git push --delete origin feature", "delete-remote"],
  ["git push origin :feature", "delete-remote"], ["git push origin --delete feature", "delete-remote"],
  ["git push --tags", undefined], ["git push --all", "force-push"], ["git reset --hard", "destroy-local"],
  ["git reset HEAD", undefined], ["git clean -fd", "destroy-local"], ["git clean -fnd", undefined],
  ["git clean -i", "destroy-local"], ["git checkout -- dirty.txt", "destroy-local"], ["git checkout feature", undefined],
  ["git restore dirty.txt", "destroy-local"], ["git worktree remove x --force", "destroy-local"],
  ["git worktree remove x", "destroy-local"], ["git branch -D unmerged", "destroy-local"], ["git branch -D merged", undefined],
  ["git branch -d unmerged", undefined], ["gh release delete v1", "delete-remote"], ["gh release create v1", "publish"],
  ["gh api repos/x -X DELETE", "delete-remote"], ["gh -R a/b api --method=DELETE x", "delete-remote"],
  ["gh api -X GET x", undefined], ["gh pr merge 2 --squash", "github-merge-close"], ["gh pr --repo a/b close 2", "github-merge-close"],
  ["gh --hostname example.com issue close 7", "github-merge-close"], ["gh issue close 7", undefined], ["gh issue close 8", "github-merge-close"],
  ["echo safe; git push -f", "force-push"], ["true && git push -f", "force-push"],
  ["false || git push -f", "force-push"], ["git push -f | cat", "force-push"], ["echo safe\ngit push -f", "force-push"],
  ['bash -c "git push -f"', "force-push"], ["sh -c 'git reset --hard'", "destroy-local"],
  ["cat <<'EOF'\ngit push -f\nEOF", undefined], ["cat <<EOF\ngit push -f\nEOF\ngit clean -f", "destroy-local"],
  ["# git push -f\ngit status", undefined], ["git status", undefined], ["npm install", undefined],
];
it.each(cases)("classifies %s", async (command, category) => {
  expect((await gatedAction("bash", {command}, "/repo", reads))?.category).toBe(category);
});
it("reads dirty and merged state through the supplied boundary", async () => {
  const clean: GatedActionReads = {...reads, git: () => Promise.resolve("")};
  expect(await gatedAction("bash", {command: "git restore file"}, "/repo", clean)).toBeUndefined();
  expect(await gatedAction("bash", {command: "git worktree remove x"}, "/repo", clean)).toBeUndefined();
  expect((await gatedAction("bash", {command: "git push origin feature"}, "/repo"))?.category).toBe("force-push");
});
it("gates GitHub ownership lookup failure and all prefixed eBay tools", async () => {
  expect(await gatedAction("github_write", {action: "close", number: 7}, "/repo", reads)).toBeUndefined();
  expect((await gatedAction("github_write", {action: "close", number: 7}, "/repo"))?.category).toBe("github-merge-close");
  for (const suffix of ["ebay_seller_update", "ebay_seller_offer_respond", "ebay_seller_message_reply"]) expect((await gatedAction(`mcp_${suffix}`, {}, "/repo"))?.category).toBe("messages");
});

it("gates a HEAD push on the default branch and keeps -C state reads in the target repository", async () => {
  const paths: string[] = [];
  const defaults: GatedActionReads = {...reads, git: (cwd, args) => { paths.push(cwd); return Promise.resolve(args.includes("--short") ? "main" : "refs/remotes/origin/main"); }};
  expect((await gatedAction("bash", {command: "git -C x push -u origin HEAD"}, "/repo", defaults))?.category).toBe("force-push");
  expect(paths.every(path => path === "/repo/x")).toBe(true);
});
