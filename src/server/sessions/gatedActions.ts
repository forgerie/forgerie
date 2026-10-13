import { resolve } from "node:path";
import type { GatedCategory } from "../../shared/autonomyPolicy.js";

export interface GatedActionMatch { category: GatedCategory; description: string }
export interface GatedActionReads {
  git(cwd: string, args: readonly string[]): Promise<string>;
  issueLabels(cwd: string, issue: string | number, repo?: string, worktreeId?: string): Promise<readonly string[]>;
}
const unavailableReads: GatedActionReads = {
  git: () => Promise.reject(new Error("Git state unavailable")),
  issueLabels: () => Promise.reject(new Error("Issue labels unavailable")),
};
const match = (category: GatedCategory, description: string): GatedActionMatch => ({ category, description });
const flag = (tokens: readonly string[], long: string, short?: string) => tokens.some(t => t === long || t.startsWith(`${long}=`) || (short !== undefined && /^-[^-]/u.test(t) && t.slice(1).includes(short)));

/** No effects: callers supply read-only repository and GitHub observations. Unknown state gates the action. */
export async function gatedAction(name: string, args: Record<string, unknown>, cwd: string, reads: GatedActionReads = unavailableReads): Promise<GatedActionMatch | undefined> {
  if (["ebay_seller_update", "ebay_seller_offer_respond", "ebay_seller_message_reply"].some(suffix => name.endsWith(suffix))) return match("messages", `Run ${name} in your name`);
  if (name === "github_write") {
    if (args["action"] === "merge_pr") return match("github-merge-close", `Merge pull request #${String(args["number"])}`);
    if (args["action"] === "close") {
      try {
        const labels = await reads.issueLabels(cwd, String(args["number"]), undefined, typeof args["worktreeId"] === "string" ? args["worktreeId"] : undefined);
        if (labels.includes("agent-filed")) return undefined;
      } catch { /* A missing label observation is not permission. */ }
      return match("github-merge-close", `Close issue #${String(args["number"])}`);
    }
  }
  if (name !== "bash" || typeof args["command"] !== "string") return undefined;
  return shellAction(args["command"], cwd, reads, 0);
}

async function shellAction(command: string, cwd: string, reads: GatedActionReads, depth: number): Promise<GatedActionMatch | undefined> {
  let folder = cwd;
  for (let tokens of shellCommands(command)) {
    let overriddenGitState = tokens.some(token => /^(?:GIT_DIR|GIT_WORK_TREE|GIT_CONFIG_COUNT)=/u.test(token));
    while (tokens[0] !== undefined && /^[A-Za-z_][A-Za-z_0-9]*=/u.test(tokens[0])) tokens = tokens.slice(1);
    while (["command", "exec", "env"].includes(tokens[0] ?? "")) {
      tokens = tokens.slice(1);
      while (tokens[0] !== undefined && (/^[A-Za-z_][A-Za-z_0-9]*=/u.test(tokens[0]) || tokens[0] === "--")) tokens = tokens.slice(1);
    }
    const executable = tokens.shift()?.split("/").at(-1);
    if (executable === "cd" && tokens[0] !== undefined) { folder = resolve(folder, tokens[0]); continue; }
    if ((executable === "bash" || executable === "sh") && depth === 0) {
      const index = tokens.findIndex(t => /^-[^-]*c/u.test(t));
      const script = tokens[index + 1];
      if (index >= 0 && script !== undefined) { const found = await shellAction(script, folder, reads, depth + 1); if (found !== undefined) return found; }
    }
    if (executable === "npm" && operands(tokens, ["--prefix", "--workspace", "-w", "--registry", "--userconfig"])[0] === "publish") return match("publish", "Publish an npm package (including dry-run)");
    if (executable === "git") {
      let gitCwd = folder;
      while (tokens[0]?.startsWith("-") === true) {
        const option = tokens.shift();
        if (option === "-C") { gitCwd = resolve(gitCwd, tokens.shift() ?? "."); }
        else if (option?.startsWith("-C") === true) gitCwd = resolve(gitCwd, option.slice(2));
        else if (option === "-c" || option === "--git-dir" || option === "--work-tree") { overriddenGitState = true; tokens.shift(); }
        else if (option?.startsWith("--git-dir=") === true || option?.startsWith("--work-tree=") === true || option?.startsWith("--config-env=") === true) overriddenGitState = true;
      }
      const action = tokens.shift();
      const found = await gitAction(action, tokens, gitCwd, overriddenGitState ? {...reads, git: unavailableReads.git.bind(unavailableReads)} : reads);
      if (found !== undefined) return found;
    }
    if (executable === "gh") {
      const repoIndex = tokens.findIndex(t => t === "-R" || t === "--repo");
      const repo = repoIndex < 0 ? tokens.find(t => t.startsWith("--repo="))?.slice(7) : tokens[repoIndex + 1];
      const words = operands(tokens, ["-R", "--repo", "-X", "--method", "-F", "--field", "-f", "--raw-field", "--hostname"]);
      if (words[0] === "api" && (tokens.some(t => /^--method=DELETE$/iu.test(t) || /^-XDELETE$/iu.test(t)) || tokens.some((t, i) => (t === "-X" || t === "--method") && tokens[i + 1]?.toUpperCase() === "DELETE"))) return match("delete-remote", "Delete through the GitHub API");
      if (words[0] === "release" && words[1] === "delete") return match("delete-remote", "Delete a GitHub release");
      if (words[0] === "release" && words[1] === "create") return match("publish", "Publish a GitHub release");
      if (words[0] === "pr" && ["merge", "close"].includes(words[1] ?? "")) return match("github-merge-close", `${words[1] === "merge" ? "Merge" : "Close"} pull request ${words[2] ?? ""}`.trim());
      if (words[0] === "issue" && words[1] === "close") {
        const hostIndex = tokens.indexOf("--hostname");
        const host = hostIndex < 0 ? tokens.find(t => t.startsWith("--hostname="))?.slice(11) : tokens[hostIndex + 1];
        if (host !== undefined && host !== "github.com") return match("github-merge-close", "Close an issue on an unconfirmed GitHub host");
        try { if ((await reads.issueLabels(folder, words[2] ?? "", repo)).includes("agent-filed")) continue; } catch { /* Gate unknown ownership. */ }
        return match("github-merge-close", `Close issue ${words[2] ?? ""}`.trim());
      }
    }
  }
  return undefined;
}
function operands(tokens: readonly string[], valued: readonly string[] = []): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]; if (t === undefined) continue;
    if (valued.includes(t)) { i++; continue; }
    if (!t.startsWith("-") || t === "-") result.push(t);
  }
  return result;
}
async function gitAction(action: string | undefined, tokens: string[], cwd: string, reads: GatedActionReads): Promise<GatedActionMatch | undefined> {
  if (action === "push") {
    const words = operands(tokens, ["--repo", "--receive-pack", "--exec", "--push-option", "-o"]);
    if (flag(tokens, "--delete", "d") || words.some(t => t.startsWith(":"))) return match("delete-remote", "Delete a remote Git ref");
    if (flag(tokens, "--force", "f") || flag(tokens, "--force-with-lease") || flag(tokens, "--force-if-includes") || words.some(t => t.startsWith("+"))) return match("force-push", "Force-push Git refs");
    if (flag(tokens, "--all") || flag(tokens, "--mirror")) return match("force-push", "Push all branches, including the default branch");
    if (flag(tokens, "--tags")) return undefined;
    try {
      const remote = words[0] ?? "origin";
      let defaultBranch: string;
      try { defaultBranch = (await reads.git(cwd, ["symbolic-ref", `refs/remotes/${remote}/HEAD`])).trim().replace(`refs/remotes/${remote}/`, ""); }
      catch {
        defaultBranch = (await reads.git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/main", "refs/heads/master"])).trim().split("\n")[0] ?? "";
      }
      if (defaultBranch === "") throw new Error("Default branch unknown");
      const refs = words.slice(1);
      const branch = refs.length === 0 || refs.includes("HEAD") ? (await reads.git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim() : "";
      if ((refs.length === 0 ? [branch] : refs).some(ref => {
        const destination = (ref.includes(":") ? ref.split(":")[1] : ref)?.replace(/^refs\/heads\//u, "");
        return destination === defaultBranch || (destination === "HEAD" && branch === defaultBranch) || destination?.includes("*") === true;
      })) return match("force-push", `Push to default branch ${defaultBranch}`);
    } catch { return match("force-push", "Push Git refs with unknown default branch"); }
  }
  if (action === "reset" && flag(tokens, "--hard")) return match("destroy-local", "Discard local changes with git reset --hard");
  // ADR 0003 gates git clean, including an interactive clean. Preview-only clean is read-only.
  if (action === "clean" && !flag(tokens, "--dry-run", "n")) return match("destroy-local", "Remove untracked files with git clean");
  if (action === "restore" || (action === "checkout" && tokens.includes("--"))) {
    const paths = tokens.includes("--") ? tokens.slice(tokens.indexOf("--") + 1) : operands(tokens, ["--source", "-s"]);
    try { if ((await reads.git(cwd, ["status", "--porcelain", "--", ...paths])).trim() === "") return undefined; } catch { /* Unknown is not clean. */ }
    return match("destroy-local", `Discard changes with git ${action}`);
  }
  if (action === "worktree" && tokens.includes("remove")) {
    if (flag(tokens, "--force", "f")) return match("destroy-local", "Force-remove a Git worktree");
    const path = operands(tokens).find(t => t !== "remove");
    try { if (path !== undefined && (await reads.git(resolve(cwd, path), ["status", "--porcelain"])).trim() === "") return undefined; } catch { /* Gate unreadable worktrees. */ }
    return match("destroy-local", "Remove a dirty or unreadable Git worktree");
  }
  if (action === "branch" && tokens.some(t => /^-[^-]*D/u.test(t))) {
    try {
      const merged = (await reads.git(cwd, ["branch", "--merged", "--format=%(refname:short)"])).trim().split("\n");
      if (operands(tokens).every(t => merged.includes(t))) return undefined;
    } catch { /* Unknown is not merged. */ }
    return match("destroy-local", "Delete an unmerged Git branch");
  }
  return undefined;
}

/** Quote-aware tokenisation, not shell execution. Heredoc bodies are data, not executable command lines. */
function shellCommands(script: string): string[][] {
  const lines = script.split("\n"); const code: string[] = []; const delimiters: string[] = [];
  const shellBodies: string[][] = []; let executesBody = false; let body: string[] = [];
  for (const line of lines) {
    if (delimiters.length > 0) {
      if (line.replace(/^\t+/u, "") === delimiters[0]) {
        delimiters.shift();
        if (executesBody) shellBodies.push(["bash", "-c", body.join("\n")]);
        executesBody = false; body = [];
      } else body.push(line);
      continue;
    }
    code.push(line);
    executesBody = /^\s*(?:bash|sh)\s+.*<</u.test(line);
    for (const found of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z_0-9]*)\1/gu)) if (found[2] !== undefined) delimiters.push(found[2]);
  }
  const result: string[][] = []; let tokens: string[] = []; let word = ""; let quote = ""; let started = false;
  const flush = () => { if (started) tokens.push(word); word = ""; started = false; };
  const end = () => { flush(); if (tokens.length > 0) result.push(tokens); tokens = []; };
  const text = code.join("\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (c === "\\" && quote !== "'") { word += text[++i] ?? ""; started = true; continue; }
    if (quote !== "") { if (c === quote) quote = ""; else word += c; started = true; continue; }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === "#" && !started) { while (i < text.length && text[i] !== "\n") i++; end(); continue; }
    if (";|&\n".includes(c)) { end(); continue; }
    if (/\s/u.test(c)) { flush(); continue; }
    word += c; started = true;
  }
  end(); return [...result, ...shellBodies];
}
