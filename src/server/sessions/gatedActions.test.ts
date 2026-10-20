import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { expect, it } from "vitest";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";
const reads: GatedActionReads = {
  git: (_cwd, args) => Promise.resolve(args[0] === "status" ? " M dirty.txt" : args[0] === "branch" ? "merged\nmain\n" : args.includes("--short") ? "feature\n" : "refs/remotes/origin/main\n"),
  issueLabels: (_cwd, id) => Promise.resolve(String(id) === "7" ? ["agent-filed"] : []),
  disposable: () => Promise.resolve(false),
};
type RepositoryState = "clean" | "unknown-remote";
const cases: [string, string | undefined, RepositoryState?][] = [
  ["git --config-env core.ignorecase=IGNORECASE push -f", "force-push"],
  ["git --namespace scoped push -f", "force-push"], ["git --namespace=scoped push origin feature", "force-push"],
  ["git --config-env core.ignorecase=IGNORECASE status", undefined],
  ["npm --color always publish", "publish"], ["npm --no-color always publish", "publish"],
  ["npm --yes null publish", "publish"], ["npm -y null publish", "publish"],
  ["npm --workspaces null publish", "publish"], ["npm --no-workspaces null publish", "publish"],
  ["npm --no-optional null publish", "publish"], ["npm --no-production null publish", "publish"],
  ["npm --no-expect-results null publish", "publish"], ["npm --no-browser firefox publish", "publish"],
  ["npm --color always install", undefined], ["npm --yes null run publish-docs", undefined],
  ["npm --no-workspaces null install", undefined],
  ["git clean -fn --no-dry", "destroy-local"], ["git clean -fn --no-dry-r", "destroy-local"],
  ["git clean -f --excl -n", "destroy-local"], ["git clean -fn --excl --no-dry-run", undefined],
  ["git push --tags --no-ta origin", "force-push"], ["git push --no-ta --tags origin", undefined],
  ["git push --push-opt --tags origin", "force-push"],
  ["npm --ignore-scripts true publish", "publish"], ["npm --dry-run false publish", "publish"],
  ["npm --json true publish", "publish"], ["npm --json true install", undefined],
  ["npm --silent true run publish-docs", undefined], ["npm --force false publish", "publish"],
  ["npm --no-ignore-scripts true publish", "publish"], ["npm --no-dry-run false publish", "publish"],
  ["npm --no-progress false publish", "publish"], ["npm -s false publish", "publish"],
  ["npm -gs true publish", "publish"], ["npm -f true publish", "publish"],
  ["npm --json true --ignore-scripts false publish", "publish"], ["npm --json true -- publish", "publish"],
  ["npm --dry-run true --no-dry-run publish", "publish"], ["npm publish --no-dry-run", "publish"],
  ["npm --json=false publish", "publish"], ["npm --dry-run=false publish", "publish"],
  ["npm --no-json true view publish", undefined], ["npm --no-dry-run false run publish-docs", undefined],
  ["npm --ignore-scripts false install", undefined], ["npm -gs false install", undefined],
  ["npm --dry-run=true install", undefined], ["npm --json -- true publish", undefined],
  ["git clean -fn --no-dry-run", "destroy-local"], ["git clean --no-dry-run -n", undefined],
  ["git clean -nf --no-dry-run", "destroy-local"], ["git clean -fn --no-dry-run -n", undefined],
  ["git clean --dry-run --no-dry-run -f", "destroy-local"], ["git clean --no-dry-run --dry-run -f", undefined],
  ["git clean -f -- -n", "destroy-local"], ["git clean -n -- --no-dry-run", undefined],
  ["git clean -f -e -n", "destroy-local"], ["git clean -fe-n", "destroy-local"],
  ["git clean -fen", "destroy-local"], ["git clean -fneanything", undefined],
  ["git clean -f --exclude --dry-run", "destroy-local"], ["git clean -fn -e --no-dry-run", undefined],
  ["git clean -f --exclude=--dry-run", "destroy-local"],
  ["git push --tags --no-tags origin", "force-push"], ["git push --no-tags --tags origin", undefined],
  ["git push --push-option --tags origin", "force-push"], ["git push -o --tags origin", "force-push"],
  ["git push --tags -o --no-tags origin", undefined], ["git push --repo --tags", "force-push"],
  ["git push --tags --no-tags --repo origin", "force-push"], ["git push --no-tags --tags --repo origin", undefined],
  ["git push --tags --no-tags origin main", "push-default"], ["git push --tags --no-tags origin feature", undefined],
  ["git push -n origin main", "push-default"], ["git push --no-dry-run origin main", "push-default"],
  ["git push -n --no-dry-run -f origin feature", "force-push"], ["git push -n --delete origin feature", "delete-remote"],
  ["git push -n origin feature", undefined], ["git push --no-dry-run -n origin feature", undefined],
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
  ["cd x && git push origin feature", undefined], ["cd x && git push origin feature 2>&1 | tail -3", undefined],
  ["cd ~/x && cd y && git push -q origin feature", undefined], ["cd x && git push origin main", "push-default"],
  ["cd x || true && git push origin feature", "force-push"], ["cd x | cat && git push origin feature", "force-push"],
  ["cd \"$X\" && git push origin feature", "force-push"], ["true && cd x && git push origin feature", undefined],
  ["(cd x); git push origin feature", "force-push"], ["true && cd x && git push origin main", "push-default"],
  ["cd x 2>/dev/null && git push origin feature", undefined], ["git fetch && cd x; git push origin feature", "force-push"],
  ["if true; then git push -f; fi", "force-push"],
  // Redirects are not refs: a ref-less push gates, and the named ref still decides.
  ["git push origin 2>&1", "force-push"], ["git push origin &>/dev/null", "force-push"], ["git push origin >/dev/null", "force-push"],
  ["git push origin 2>/dev/null", "force-push"], ["git push origin > log.txt", "force-push"], ["git push origin >&2", "force-push"],
  ["git push origin 2>&1 | tail -3", "force-push"], ["git push origin main 2>&1", "push-default"], ["git push origin main &>/dev/null", "push-default"],
  ["git push origin feature 2>&1", undefined], ["git push origin feature > main", undefined], ["git push origin \">x\"", undefined],
  ["2>/dev/null git push --force", "force-push"], ["&>/dev/null git push --force", "force-push"], [">/dev/null git reset --hard", "destroy-local"],
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
  ["git push --tags origin main", "push-default"], ["git push --branches origin", "force-push"],
  ["git push --repo origin main", "push-default"], ["git push --repo=origin main", "push-default"],
  ["git push main --repo origin", "push-default"], ["git push --tags --repo origin main", "push-default"],
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
  ["git push origin main", "push-default"], ["git push origin feature:main", "push-default"],
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
  expect((await gatedAction("bash", {command: "git -C x push -u origin HEAD"}, "/repo", defaults))?.category).toBe("push-default");
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
    const untracked = join(root, "preview-check"); await writeFile(untracked, "scratch");
    expect((await classify("git clean -fn --no-dry-run"))?.category).toBe("destroy-local");
    expect(await classify("git clean --no-dry-run -fn")).toBeUndefined();
    await git("clean", "--no-dry-run", "-fn");
    expect(await promisify(execFile)("git", ["-C", root, "status", "--porcelain", "--", "preview-check"])).toMatchObject({stdout: "?? preview-check\n"});
    await git("clean", "-fn", "--no-dry-run"); // Scratch only: verify the same flag sequence really removes the file.
    expect((await git("status", "--porcelain", "--", "preview-check")).stdout).toBe("");
  } finally { await rm(root, {recursive: true, force: true}); }
});

it("deletes a branch that origin's default branch already holds, even when local main is behind", async () => {
  const base = await mkdtemp(join(tmpdir(), "forgerie-classifier-remote-"));
  const root = join(base, "work"); const remote = join(base, "remote.git");
  const run = (cwd: string, ...args: string[]) => promisify(execFile)("git", ["-C", cwd, ...args], {env: {...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0"}, encoding: "utf8"});
  const git = (...args: string[]) => run(root, ...args);
  const observed: GatedActionReads = {...reads, git: async (_cwd, args) => (await git(...args)).stdout};
  const classify = async (command: string) => (await gatedAction("bash", {command}, root, observed))?.category;
  try {
    await promisify(execFile)("git", ["init", "--bare", "-b", "main", remote]);
    await promisify(execFile)("git", ["init", "-b", "main", root]);
    await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
    await writeFile(join(root, "base.txt"), "base"); await git("add", "base.txt"); await git("commit", "-m", "Base");
    await git("remote", "add", "origin", remote); await git("push", "-q", "origin", "main"); await git("remote", "set-head", "origin", "main");
    // The branch landed on origin/main, but local main was never fast-forwarded.
    await git("checkout", "-q", "-b", "landed"); await writeFile(join(root, "landed.txt"), "x"); await git("add", "landed.txt"); await git("commit", "-m", "Landed");
    await git("push", "-q", "origin", "landed:main");
    await git("checkout", "-q", "-b", "unmerged", "main"); await writeFile(join(root, "other.txt"), "y"); await git("add", "other.txt"); await git("commit", "-m", "Unmerged");
    await git("checkout", "-q", "main");
    expect(await classify("git branch -D landed")).toBeUndefined();
    expect(await classify("git branch -D unmerged")).toBe("destroy-local");
    expect(await classify("git branch -D landed unmerged")).toBe("destroy-local");
    // Without a known remote default branch, only HEAD can prove a merge.
    await git("remote", "set-head", "origin", "--delete");
    expect(await classify("git branch -D landed")).toBe("destroy-local");
  } finally { await rm(base, {recursive: true, force: true}); }
});

it("names the main checkout of a default-branch push, also from a linked worktree, and keeps a force-push separate", async () => {
  const base = await mkdtemp(join(tmpdir(), "forgerie-classifier-push-"));
  const root = join(base, "repo"); const remote = join(base, "remote.git"); const linked = join(base, "elsewhere", "wt");
  const run = (cwd: string, ...args: string[]) => promisify(execFile)("git", ["-C", cwd, ...args], {env: {...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0"}, encoding: "utf8"});
  const observed: GatedActionReads = {...reads, git: async (cwd, args) => (await run(cwd, ...args)).stdout};
  try {
    await promisify(execFile)("git", ["init", "--bare", "-b", "main", remote]);
    await promisify(execFile)("git", ["init", "-b", "main", root]);
    await run(root, "config", "user.name", "Test"); await run(root, "config", "user.email", "test@example.invalid");
    await writeFile(join(root, "base.txt"), "base"); await run(root, "add", "base.txt"); await run(root, "commit", "-m", "Base");
    await run(root, "remote", "add", "origin", remote); await run(root, "push", "-q", "origin", "main"); await run(root, "remote", "set-head", "origin", "main");
    await run(root, "worktree", "add", "-q", "-b", "feature", linked);
    for (const cwd of [root, linked]) {
      expect(await gatedAction("bash", {command: "git push origin HEAD:main"}, cwd, observed)).toEqual({category: "push-default", description: "Push to default branch main", repo: await realpath(root)});
      expect((await gatedAction("bash", {command: "git push --force origin HEAD:main"}, cwd, observed))?.category).toBe("force-push");
      expect((await gatedAction("bash", {command: "git push --all origin"}, cwd, observed))?.category).toBe("force-push");
    }
    // Redirect words are not refs, before or after the command.
    for (const command of ["git push origin 2>&1", "git push origin &>/dev/null", "git push origin >/dev/null", "git push origin 2>&1 | tail -3", "2>/dev/null git push --force", "&>/dev/null git push --force"]) {
      expect((await gatedAction("bash", {command}, root, observed))?.category, command).toBe("force-push");
    }
    expect((await gatedAction("bash", {command: "git push origin HEAD:main 2>&1"}, root, observed))?.category).toBe("push-default");
    expect((await gatedAction("bash", {command: ">/dev/null git reset --hard"}, root, observed))?.category).toBe("destroy-local");
  } finally { await rm(base, {recursive: true, force: true}); }
});

it("discards files in a disposable worktree without approval, and reads the root of the tree the action changes", async () => {
  const asked: string[] = [];
  const scratch: GatedActionReads = {
    ...reads,
    git: (cwd, args) => args[0] === "rev-parse" && args[1] === "--show-toplevel"
      ? (cwd.startsWith("/tmp/") ? Promise.resolve(`${cwd}\n`) : Promise.resolve("/repo\n")) : reads.git(cwd, args),
    disposable: (root) => { asked.push(root); return Promise.resolve(root.startsWith("/tmp/")); },
  };
  const classify = async (command: string, cwd = "/repo") => (await gatedAction("bash", {command}, cwd, scratch))?.category;
  for (const command of ["git reset --hard", "git clean -fd", "git checkout -- dirty.txt", "git restore dirty.txt", "git checkout -f HEAD"]) {
    expect(await classify(command, "/tmp/clone")).toBeUndefined();
    expect(await classify(command)).toBe("destroy-local");
  }
  expect(await classify("git -C /tmp/clone reset --hard")).toBeUndefined();
  expect(await classify("cd /tmp/clone; git clean -fd")).toBeUndefined();
  // A leading `cd <path> &&` is certain: the rest runs there or not at all.
  expect(await classify("cd /tmp/clone && git clean -fd")).toBeUndefined();
  expect(await classify("cd /tmp/clone && git worktree remove --force /tmp/baseline && echo ok")).toBeUndefined();
  // A `cd` later in an `&&` chain is certain too: the rest runs there or not at all.
  expect(await classify("echo start && cd /tmp/clone && git clean -fd")).toBeUndefined();
  // The removed worktree decides, not the cwd.
  expect(await classify("git worktree remove --force /tmp/baseline")).toBeUndefined();
  expect(await classify("git worktree remove --force ../../repo/copy", "/tmp/clone")).toBe("destroy-local");
  expect(await classify("git worktree remove --force")).toBe("destroy-local");
  // Branches are repository refs, shared by every worktree.
  expect(await classify("git branch -D unmerged", "/tmp/clone")).toBe("destroy-local");
  // Overridden Git state, a computed cwd or a failed read cannot prove the tree.
  expect(await classify("git --work-tree=/repo reset --hard", "/tmp/clone")).toBe("destroy-local");
  expect(await classify("cd \"$DIR\" && git reset --hard", "/tmp/clone")).toBe("destroy-local");
  const failing: GatedActionReads = {...scratch, git: () => Promise.reject(new Error("not a repository"))};
  expect((await gatedAction("bash", {command: "git reset --hard"}, "/tmp/clone", failing))?.category).toBe("destroy-local");
  expect(asked).toContain("/tmp/baseline");
});

it("follows each `cd <literal> &&` of a land recipe to the tree that each Git command changes", async () => {
  const asked: string[] = [];
  const project: GatedActionReads = {
    ...reads,
    git: (cwd, args) => args[0] === "rev-parse" && args[1] === "--show-toplevel"
      ? Promise.resolve(`${cwd.startsWith("/repo/.worktree/") ? cwd : "/repo"}\n`) : reads.git(cwd, args),
    disposable: (root) => { asked.push(root); return Promise.resolve(root.startsWith("/repo/.worktree/")); },
  };
  const classify = async (command: string, cwd = "/elsewhere") => (await gatedAction("bash", {command}, cwd, project))?.category;
  const land = "cd /repo/.worktree/x && git add -A && git commit -qm 'Fix' && cd /repo && git merge --ff-only x";
  // The removal reaches the disposable rule and its backup, in the tree that the last `cd` names.
  expect(await classify(`${land} && git worktree remove .worktree/x`)).toBeUndefined();
  expect(await classify(`${land} && git worktree remove --force .worktree/x && git branch -d x`)).toBeUndefined();
  expect(asked).toEqual(["/repo/.worktree/x", "/repo/.worktree/x"]);
  // A relative `cd` resolves from the last certain folder.
  expect(await classify("cd .worktree/x && git commit -qm Fix && cd ../.. && git worktree remove .worktree/x", "/repo")).toBeUndefined();
  // Shared branches and the main checkout stay gated.
  expect(await classify(`${land} && git push origin main`)).toBe("push-default");
  expect(await classify(`${land} && git reset --hard`)).toBe("destroy-local");
  expect(await classify(`${land} && git branch -D x`)).toBe("destroy-local");
  expect(await classify("cd /repo && git clean -fd", "/repo/.worktree/x")).toBe("destroy-local");
  expect(await classify("cd /repo/.worktree/x && git status && cd /repo && git checkout -- dirty.txt")).toBe("destroy-local");
  expect(await classify("cd /repo/.worktree/x && cd .. && git clean -fd")).toBe("destroy-local");
});

it("accepts redirects on cd and keeps every folder it cannot prove uncertain", async () => {
  const scratch: GatedActionReads = {
    ...reads,
    git: (cwd, args) => args[0] === "rev-parse" && args[1] === "--show-toplevel" ? Promise.resolve(`${cwd}\n`) : reads.git(cwd, args),
    disposable: (root) => Promise.resolve(root.startsWith("/tmp/")),
  };
  const classify = async (command: string, cwd = "/tmp/start") => (await gatedAction("bash", {command}, cwd, scratch))?.category;
  for (const command of ["cd /tmp/x 2>/dev/null && git checkout -- dirty.txt", "cd /tmp/x >/dev/null 2>&1 && git clean -fd", "cd /tmp/x 2> /dev/null && git reset --hard", "cd -- /tmp/x &>/dev/null && git restore dirty.txt"]) {
    expect(await classify(command, "/repo")).toBeUndefined();
  }
  // Both folders are disposable, so only an uncertain folder, whose Git reads fail closed, can gate these.
  expect(await classify("cd /tmp/clone && git clean -fd")).toBeUndefined();
  expect(await classify("cd /tmp/clone\nbash <<EOF\ngit clean -fd\nEOF")).toBeUndefined();
  // A newline or comment after `&&`, `||` or `|` continues the list.
  expect(await classify("cd /tmp/clone &&\n  git clean -fd")).toBeUndefined();
  expect(await classify("cd /tmp/clone && # enter the clone\n  git clean -fd")).toBeUndefined();
  for (const command of [
    "cd /tmp/clone || true && git clean -fd", "cd /tmp/clone 2>/dev/null || exit 1; git clean -fd", "cd /tmp/clone ||\n  true\ngit clean -fd",
    "cd /tmp/clone |\n  cat && git clean -fd", "false || cd /tmp/clone && git clean -fd",
    "git fetch && cd /tmp/clone; git clean -fd", "cd /tmp/clone | cat && git clean -fd", "cd /tmp/clone |& cat && git clean -fd",
    "(cd /tmp/clone) && git clean -fd", "(cd /tmp/clone && true); git clean -fd", "{ cd /tmp/clone; } && git clean -fd",
    "cd /tmp/clone & git clean -fd", "cd /tmp/clone && true & git clean -fd", "echo $(cd /tmp/clone) && git clean -fd",
    "if true; then cd /tmp/clone; fi; git clean -fd", "for d in a; do cd /tmp/clone; done && git clean -fd",
    "cd \"$DIR\" && git clean -fd", "cd $(mktemp -d) && git clean -fd", "cd `mktemp -d` && git clean -fd", "cd /tmp/cl* && git clean -fd",
    "cd ~other && git clean -fd", "cd -P /tmp/clone && git clean -fd", "cd - && git clean -fd", "cd && git clean -fd",
    "pushd /tmp/clone && git clean -fd", "builtin cd /tmp/clone && git clean -fd", "env cd /tmp/clone && git clean -fd",
    "cd /tmp/clone || true; bash -c 'git clean -fd'", "cd /tmp/clone && bash <<EOF\ngit clean -fd\nEOF",
  ]) expect(await classify(command), command).toBe("destroy-local");
  // Substitutions and heredoc bodies run where their command runs, not where a later `cd` goes.
  expect(await classify("echo $(git clean -fd) && cd /tmp/clone", "/repo")).toBe("destroy-local");
  expect(await classify("bash <<EOF\ngit clean -fd\nEOF\ncd /tmp/clone", "/repo")).toBe("destroy-local");
});

it("gates `cd <missing>; <destructive>` because the Git read in the missing folder fails", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "forgerie-classifier-cd-")));
  const main = join(base, "main"); const clone = join(base, "clone");
  const observed: GatedActionReads = {
    ...reads,
    git: async (cwd, args) => (await promisify(execFile)("git", ["-C", cwd, ...args], {env: {...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0"}, encoding: "utf8"})).stdout,
    disposable: (root) => Promise.resolve(root === clone),
  };
  const classify = async (command: string) => (await gatedAction("bash", {command}, main, observed))?.category;
  try {
    for (const repo of [main, clone]) await promisify(execFile)("git", ["init", "-q", "-b", "main", repo]);
    expect(await classify(`cd ${clone}; git clean -fd`)).toBeUndefined();
    // If this `cd` fails, git clean runs in the main checkout.
    expect(await classify(`cd ${join(base, "missing")}; git clean -fd`)).toBe("destroy-local");
    expect(await classify("git clean -fd")).toBe("destroy-local");
  } finally { await rm(base, {recursive: true, force: true}); }
});

it("does not gate marking a draft PR ready for review", async () => {
  expect(await gatedAction("github_write", { action: "ready_pr", number: 9 }, "/repo")).toBeUndefined();
});
