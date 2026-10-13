import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { expect, it } from "vitest";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";
const reads: GatedActionReads = {
  git: (_cwd, args) => Promise.resolve(args[0] === "status" ? " M dirty.txt" : args[0] === "branch" ? "merged\nmain\n" : args.includes("--short") ? "feature\n" : "refs/remotes/origin/main\n"),
  issueLabels: (_cwd, id) => Promise.resolve(String(id) === "7" ? ["agent-filed"] : []),
};
type RepositoryState = "clean" | "unknown-remote";
const cases: [string, string | undefined, RepositoryState?][] = [
  ["command -p git push -f", "force-push"], ["command -v git", undefined],
  ["command -V git", undefined], ["command -pv git push -f", undefined],
  ["env -i git push -f", "force-push"], ["env -u HOME git push -f", "force-push"],
  ["env --unset=HOME TOKEN=x /usr/bin/git push -f", "force-push"],
  ["/usr/bin/env -i /usr/bin/nice -n 10 /usr/bin/nohup /usr/bin/git push -f", "force-push"],
  ["nice --adjustment 10 git push -f", "force-push"], ["nice -10 git push -f", "force-push"],
  ["nohup -- git push -f", "force-push"], ["time -p git push -f", "force-push"],
  ["/usr/bin/time -f %E -o timings git push -f", "force-push"],
  ["sudo -n -u root git push -f", "force-push"], ["sudo --user=root git push -f", "force-push"],
  ["exec -a custom git push -f", "force-push"], ["command -p git status", undefined],
  ["env -i nice -n 10 git status", undefined], ["npm --access public publish", "publish"],
  ["npm --registry https://registry.npmjs.org --access=public publish --dry-run", "publish"],
  ["npm --cache /tmp/cache --loglevel silent publish", "publish"],
  ["npm --access public view publish", undefined], ["npm -wpackage view publish", undefined],
  ["cd x && git push origin feature", "force-push"], ["(cd x); git push origin feature", "force-push"],
  ["(git push --force)", "force-push"], ["{ git push --force; }", "force-push"],
  ["git \\\npush --force", "force-push"], ["gi\\\nt push --force", "force-push"],
  ['echo "$(git push --force)"', "force-push"], ["echo $(git push --force)", "force-push"],
  ["echo `git push --force`", "force-push"], ['echo "`git push --force`"', "force-push"],
  ["echo '$(git push --force)'", undefined], ["echo '`git push --force`'", undefined],
  ['echo "(git push --force)"', undefined], ['echo "{ git push --force; }"', undefined],
  ["echo \"\\$(git push --force)\"", undefined],
  ["cat <<EOF\n$(git push --force)\nEOF", "force-push"],
  ["cat <<'EOF'\n$(git push --force)\nEOF", undefined],
  ["cat <<EOF.txt\ndata\nEOF.txt\ngit push -f", "force-push"],
  ["git push --tags origin main", "force-push"], ["git push --branches origin", "force-push"],
  ["git push --repo origin main", "force-push"], ["git push --repo=origin main", "force-push"],
  ["git push main --repo origin", "force-push"], ["git push --tags --repo origin main", "force-push"],
  ["git push --tags origin feature", undefined], ["git push --repo origin feature", undefined],
  ["git push --repo=origin feature", undefined], ["git push --tags origin", undefined],
  ["git push origin feature", "force-push", "unknown-remote"],
  ["git -ccore.ignorecase=true push origin feature", "force-push"],
  ["git -c core.ignorecase=true push origin feature", "force-push"],
  ["git push origin", "force-push"], ["git push", "force-push"], ["git push --repo origin", "force-push"],
  ["git checkout .", "destroy-local"], ["git checkout dirty.txt", "destroy-local"],
  ["git checkout HEAD dirty.txt", "destroy-local"], ["git checkout HEAD -- dirty.txt", "destroy-local"],
  ["git checkout -f HEAD", "destroy-local"], ["git checkout --force feature", "destroy-local"],
  ["git checkout .", undefined, "clean"], ["git checkout HEAD dirty.txt", undefined, "clean"],
  ["git checkout -f HEAD", undefined, "clean"], ["git checkout feature", undefined, "clean"],
  ["git checkout -b new-branch", undefined, "clean"],
  ["git branch --delete --force unmerged", "destroy-local"], ["git branch -d -f unmerged", "destroy-local"],
  ["git branch -df unmerged", "destroy-local"], ["git branch -fd unmerged", "destroy-local"],
  ["git branch --force --delete unmerged", "destroy-local"], ["git branch --delete --force merged", undefined],
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
it.each(cases)("classifies %s", async (command, category, state) => {
  const configured: GatedActionReads = {...reads, git: (cwd, args) => {
    if (state === "clean" && args[0] === "status") return Promise.resolve("");
    if (state === "unknown-remote" && args[0] === "symbolic-ref" && args[1]?.startsWith("refs/remotes/") === true) return Promise.reject(new Error("Unknown remote HEAD"));
    if (state === "unknown-remote" && args[0] === "for-each-ref") return Promise.resolve("main\n");
    if (args[0] === "rev-parse") return args.at(-1) === "HEAD^{tree}" || args.at(-1) === "feature^{tree}" ? Promise.resolve("tree-id") : Promise.reject(new Error("Not a tree-ish"));
    return reads.git(cwd, args);
  }};
  expect((await gatedAction("bash", {command}, "/repo", configured))?.category).toBe(category);
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
it("uses real read-only Git observations for dirty checkout forms and unmerged branch aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-classifier-review-"));
  const git = (...args: string[]) => promisify(execFile)("git", ["-C", root, ...args], {env: {...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0"}, encoding: "utf8"});
  const observed: GatedActionReads = {...reads, git: async (_cwd, args) => (await git(...args)).stdout};
  const classify = (command: string) => gatedAction("bash", {command}, root, observed);
  try {
    await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
    await writeFile(join(root, "base.txt"), "base"); await git("add", "base.txt"); await git("commit", "-m", "Base"); await git("branch", "feature");
    expect(await classify("git checkout feature")).toBeUndefined(); expect(await classify("git checkout -f HEAD")).toBeUndefined();
    await git("checkout", "-b", "unmerged"); await writeFile(join(root, "other.txt"), "other"); await git("add", "other.txt"); await git("commit", "-m", "Unmerged"); await git("checkout", "main");
    await writeFile(join(root, "base.txt"), "dirty");
    for (const command of ["git checkout .", "git checkout base.txt", "git checkout HEAD base.txt", "git checkout -f HEAD", "git branch --delete --force unmerged", "git branch -df unmerged"]) expect((await classify(command))?.category).toBe("destroy-local");
    // A local main branch cannot prove the remote's default branch.
    expect((await classify("git push origin feature"))?.category).toBe("force-push");
    expect(await classify("git branch -df feature")).toBeUndefined();
  } finally { await rm(root, {recursive: true, force: true}); }
});
