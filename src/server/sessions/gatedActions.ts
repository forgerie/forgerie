import { homedir } from "node:os";
import { resolve } from "node:path";
import type { GatedCategory } from "../../shared/autonomyPolicy.js";

export interface GatedActionMatch { category: GatedCategory; description: string }
export interface GatedActionReads {
  git(cwd: string, args: readonly string[]): Promise<string>;
  issueLabels(cwd: string, issue: string | number, repo?: string, worktreeId?: string): Promise<readonly string[]>;
  /** Whether a Git worktree root holds only throwaway files, so discarding them needs no approval. */
  disposable(worktreeRoot: string): Promise<boolean>;
}
const unavailableReads: GatedActionReads = {
  git: () => Promise.reject(new Error("Git state unavailable")),
  issueLabels: () => Promise.reject(new Error("Issue labels unavailable")),
  disposable: () => Promise.resolve(false),
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

/**
 * A script that starts with `cd <path> &&` runs the rest in that folder or not at all, so its folder is certain.
 * Later `cd` commands stay uncertain when the script has pipes, subshells or other control operators.
 */
const LEADING_CD = /^\s*cd\s+(?:"([^"$`\\]+)"|'([^']+)'|([^\s;&|()<>"'$`\\]+))\s*&&/u;
export function leadingDirectory(command: string, cwd: string, home: string): {cwd: string; rest: string} {
  let folder = cwd; let rest = command;
  for (let found = LEADING_CD.exec(rest); found !== null; found = LEADING_CD.exec(rest)) {
    folder = resolve(folder, expandHome(found[1] ?? found[2] ?? found[3] ?? ".", home));
    rest = rest.slice(found[0].length);
  }
  return {cwd: folder, rest};
}
const expandHome = (path: string, home: string) => path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;

async function shellAction(script: string, cwd: string, reads: GatedActionReads, depth: number): Promise<GatedActionMatch | undefined> {
  const lead = leadingDirectory(script, cwd, homedir());
  const command = lead.rest;
  let folder = lead.cwd; let uncertainCwd = false;
  for (const words of shellCommands(command)) {
    const normalized = normalizeCommand(words, folder);
    if (normalized === undefined) continue;
    const tokens = normalized.tokens;
    let overriddenGitState = normalized.unknownGitState;
    const commandCwd = normalized.cwd;
    const executable = tokens.shift()?.split("/").at(-1);
    if (executable === "cd") {
      uncertainCwd ||= tokens[0] === undefined || normalized.unknownGitState || /[|&()`]/u.test(command);
      if (tokens[0] !== undefined) folder = resolve(commandCwd, expandHome(tokens[0], homedir()));
      continue;
    }
    if ((executable === "bash" || executable === "sh") && depth === 0) {
      const index = tokens.findIndex(t => /^-[^-]*c/u.test(t));
      const script = tokens[index + 1];
      if (index >= 0 && script !== undefined) { const found = await shellAction(script, commandCwd, reads, depth + 1); if (found !== undefined) return found; }
    }
    if (executable === "npm" && npmCommand(tokens) === "publish") return match("publish", "Publish an npm package (including dry-run)");
    if (executable === "git") {
      let gitCwd = commandCwd;
      while (tokens[0]?.startsWith("-") === true) {
        const option = tokens.shift();
        if (option === "-C") { gitCwd = resolve(gitCwd, tokens.shift() ?? "."); }
        else if (option?.startsWith("-C") === true) gitCwd = resolve(gitCwd, option.slice(2));
        else if (option === "-c" || option === "--git-dir" || option === "--work-tree" || option === "--config-env" || option === "--namespace") { overriddenGitState = true; tokens.shift(); }
        else if (option?.startsWith("-c") === true) overriddenGitState = true;
        else if (option?.startsWith("--git-dir=") === true || option?.startsWith("--work-tree=") === true || option?.startsWith("--config-env=") === true || option?.startsWith("--namespace=") === true) overriddenGitState = true;
      }
      const action = tokens.shift();
      const found = await gitAction(action, tokens, gitCwd, (overriddenGitState || uncertainCwd) ? {...reads, git: unavailableReads.git.bind(unavailableReads)} : reads);
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
        try { if ((await reads.issueLabels(commandCwd, words[2] ?? "", repo)).includes("agent-filed")) continue; } catch { /* Gate unknown ownership. */ }
        return match("github-merge-close", `Close issue ${words[2] ?? ""}`.trim());
      }
    }
  }
  return undefined;
}
const WRAPPERS = new Set(["command", "exec", "env", "nice", "nohup", "time", "sudo", "!"]);
const WRAPPER_VALUES: Record<string, readonly string[]> = {
  command: [], exec: ["-a"], env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
  nice: ["-n", "--adjustment"], nohup: [], time: ["-f", "--format", "-o", "--output"],
  sudo: ["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-T", "--command-timeout", "-R", "--chroot", "-D", "--chdir", "-r", "--role", "-t", "--type"],
};
function normalizeCommand(words: readonly string[], cwd: string): {tokens: string[]; cwd: string; unknownGitState: boolean} | undefined {
  let tokens = [...words]; let folder = cwd; let unknownGitState = words.some(word => word.includes("<substitution>") || word.includes("$"));
  for (;;) {
    while (tokens[0] !== undefined && /^[A-Za-z_][A-Za-z_0-9]*=/u.test(tokens[0])) {
      unknownGitState ||= tokens[0].startsWith("GIT_"); tokens.shift();
    }
    const wrapper = tokens[0]?.split("/").at(-1) ?? "";
    if (!WRAPPERS.has(wrapper)) return {tokens, cwd: folder, unknownGitState};
    tokens.shift();
    if (wrapper === "sudo") unknownGitState = true;
    while (tokens[0]?.startsWith("-") === true) {
      const option = tokens.shift() ?? "";
      if (option === "--") break;
      if (option === "--help" || option === "--version" || (wrapper === "command" && /^-[^-]*[vV]/u.test(option))) return undefined;
      const valued = (WRAPPER_VALUES[wrapper] ?? []).find(key => option === key || option.startsWith(`${key}=`) || (key.length === 2 && option.startsWith(key)));
      const value = valued === undefined ? undefined : option === valued ? tokens.shift() : option.slice(valued.length).replace(/^=/u, "");
      if (wrapper === "env") {
        if (option === "-i" || option === "--ignore-environment" || ((valued === "-u" || valued === "--unset") && value?.startsWith("GIT_") === true)) unknownGitState = true;
        if ((valued === "-C" || valued === "--chdir") && value !== undefined) folder = resolve(folder, value);
        if ((valued === "-S" || valued === "--split-string") && value !== undefined) tokens = [...shellCommands(value).flat(), ...tokens];
      }
      if (wrapper === "sudo" && (valued === "-D" || valued === "--chdir") && value !== undefined) folder = resolve(folder, value);
    }
  }
}
const NPM_VALUE_OPTIONS = new Set(["--access", "--tag", "--otp", "--prefix", "--workspace", "-w", "--registry", "--userconfig", "--globalconfig", "--cache", "--loglevel", "--scope", "--auth-type", "--fetch-retries", "--fetch-timeout", "--proxy", "--https-proxy", "--node-options", "--script-shell"]);
const NPM_BOOLEAN_OPTIONS = new Set(["--dry-run", "--force", "--global", "-g", "--silent", "-s", "--verbose", "--json", "--ignore-scripts", "--foreground-scripts", "--workspaces", "--include-workspace-root", "--audit", "--fund", "--package-lock", "--package-lock-only", "--save", "--save-dev", "--save-exact", "--legacy-peer-deps", "--offline", "--prefer-offline", "--prefer-online", "--yes", "-y", "--color", "--unicode", "--timing", "--progress"]);
// npm's boolean unions also accept these literal values before the command.
const NPM_BOOLEAN_LITERALS: Record<string, readonly string[]> = {
  "--color": ["always"], "--yes": ["null"], "-y": ["null"], "--workspaces": ["null"],
  "--expect-results": ["null"], "--optional": ["null"], "--production": ["null"],
};
function npmCommand(tokens: readonly string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const option = tokens[i] ?? "";
    if (option === "--") return tokens[i + 1];
    if (!option.startsWith("-")) return option;
    if (option.includes("=") || (option.startsWith("-w") && option !== "-w")) continue;
    // browser is a String/Boolean union; a negated spelling can still consume a browser value.
    if (option === "--browser" || option === "--no-browser") {
      if (tokens[i + 1] !== undefined && tokens[i + 1]?.startsWith("-") === false) i++;
      continue;
    }
    const positive = option.startsWith("--no-") ? `--${option.slice(5)}` : /^-[gsfy]*y$/u.test(option) ? "-y" : option;
    const literals = NPM_BOOLEAN_LITERALS[positive] ?? [];
    if (option.startsWith("--no-") || /^-[gsfy]+$/u.test(option) || NPM_BOOLEAN_OPTIONS.has(option) || literals.length > 0) {
      // npm accepts literal boolean values separately, including after negated switches and short groups.
      if (tokens[i + 1] === "true" || tokens[i + 1] === "false" || literals.includes(tokens[i + 1] ?? "")) i++;
      continue;
    }
    // Unknown boolean flags must not consume a visible publish command as an option value.
    if (NPM_VALUE_OPTIONS.has(option) || (tokens[i + 1] !== "publish" && tokens[i + 1]?.startsWith("-") === false)) i++;
  }
  return undefined;
}
function optionValue(tokens: readonly string[], name: string): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === name) value = tokens[++i];
    else if (tokens[i]?.startsWith(`${name}=`) === true) value = tokens[i]?.slice(name.length + 1);
  }
  return value;
}
function operands(tokens: readonly string[], valued: readonly string[] = []): string[] {
  const result: string[] = []; let afterSeparator = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]; if (t === undefined) continue;
    if (t === "--" && !afterSeparator) { afterSeparator = true; continue; }
    if (!afterSeparator && valued.includes(t)) { i++; continue; }
    if (afterSeparator || !t.startsWith("-") || t === "-") result.push(t);
  }
  return result;
}
const PUSH_VALUE_OPTIONS = ["--repo", "--receive-pack", "--exec", "--push-option", "-o"];

/** Safe exemptions need effective flags, not presence: negations, values and -- change their meaning. */
function effectiveFlag(tokens: readonly string[], long: string, short: string | undefined, valued: readonly string[]): boolean {
  let enabled = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "--") break;
    // Git accepts unique long-option abbreviations. A value that looks like a flag stays data.
    if (valued.some(name => token === name || (token.startsWith("--") && !token.includes("=") && name.startsWith(token)))) { i++; continue; }
    if (token === long) enabled = true;
    else if ((token.startsWith("--no-") && `--no-${long.slice(2)}`.startsWith(token.split("=")[0] ?? token)) || token.startsWith(`${long}=`)) enabled = false;
    else if (/^-[^-]/u.test(token)) {
      for (let j = 1; j < token.length; j++) {
        if (valued.includes(`-${token[j] ?? ""}`)) {
          if (j === token.length - 1) i++; // Otherwise the rest of the short group is its attached value.
          break;
        }
        if (short !== undefined && token[j] === short) enabled = true;
      }
    }
  }
  return enabled;
}
/**
 * Discarding files in a disposable worktree needs no approval. Branch deletion still gates: refs belong to the whole repository.
 * The worktree root comes from Git, so `cd`, `-C` and relative paths resolve to the tree the action really changes.
 */
async function gitAction(action: string | undefined, tokens: string[], cwd: string, reads: GatedActionReads): Promise<GatedActionMatch | undefined> {
  const found = await gitMatch(action, tokens, cwd, reads);
  if (found?.category !== "destroy-local" || action === "branch") return found;
  const removed = action === "worktree" ? operands(tokens).find(t => t !== "remove") : undefined;
  if (action === "worktree" && removed === undefined) return found;
  const tree = removed === undefined ? cwd : resolve(cwd, removed);
  try {
    const root = (await reads.git(tree, ["rev-parse", "--show-toplevel"])).trim();
    if (root !== "" && await reads.disposable(root)) return undefined;
  } catch { /* An unknown worktree is not disposable. */ }
  return found;
}
async function gitMatch(action: string | undefined, tokens: string[], cwd: string, reads: GatedActionReads): Promise<GatedActionMatch | undefined> {
  if (action === "push") {
    const words = operands(tokens, PUSH_VALUE_OPTIONS);
    if (flag(tokens, "--delete", "d") || words.some(t => t.startsWith(":"))) return match("delete-remote", "Delete a remote Git ref");
    if (flag(tokens, "--force", "f") || flag(tokens, "--force-with-lease") || flag(tokens, "--force-if-includes") || words.some(t => t.startsWith("+"))) return match("force-push", "Force-push Git refs");
    if (flag(tokens, "--all") || flag(tokens, "--branches") || flag(tokens, "--mirror")) return match("force-push", "Push all branches, including the default branch");
    const remoteOption = optionValue(tokens, "--repo");
    const remote = remoteOption ?? words[0] ?? "origin";
    const refs = remoteOption === undefined ? words.slice(1) : words;
    if (refs.length === 0) return effectiveFlag(tokens, "--tags", undefined, PUSH_VALUE_OPTIONS) ? undefined : match("force-push", "Push Git refs with unknown implicit destination");
    try {
      const prefix = `refs/remotes/${remote}/`;
      const remoteHead = (await reads.git(cwd, ["symbolic-ref", `${prefix}HEAD`])).trim();
      if (!remoteHead.startsWith(prefix) || remoteHead === `${prefix}HEAD`) throw new Error("Default branch unknown");
      const defaultBranch = remoteHead.slice(prefix.length);
      if (defaultBranch === "") throw new Error("Default branch unknown");
      const branch = refs.includes("HEAD") ? (await reads.git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim() : "";
      if (refs.includes("HEAD") && branch === "") throw new Error("HEAD destination unknown");
      if (refs.some(ref => {
        const destination = (ref.includes(":") ? ref.split(":")[1] : ref)?.replace(/^refs\/heads\//u, "");
        return destination === "" || destination === defaultBranch || (destination === "HEAD" && branch === defaultBranch) || destination?.includes("*") === true;
      })) return match("force-push", `Push to default branch ${defaultBranch}`);
    } catch { return match("force-push", "Push Git refs with unknown default branch"); }
  }
  if (action === "reset" && flag(tokens, "--hard")) return match("destroy-local", "Discard local changes with git reset --hard");
  // ADR 0003 gates git clean, including an interactive clean. Preview-only clean is read-only.
  if (action === "clean" && !effectiveFlag(tokens, "--dry-run", "n", ["--exclude", "-e"])) return match("destroy-local", "Remove untracked files with git clean");
  if (action === "restore" || action === "checkout") {
    let paths: string[];
    if (action === "checkout" && (flag(tokens, "--force", "f") || flag(tokens, "--patch", "p"))) paths = [];
    else if (tokens.includes("--")) paths = tokens.slice(tokens.indexOf("--") + 1);
    else {
      paths = operands(tokens, ["--source", "-s", "-b", "-B", "--orphan"]);
      if (action === "checkout") {
        if (paths.length === 0) return undefined;
        try {
          if ((await reads.git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${paths[0] ?? ""}^{tree}`])).trim() !== "") {
            if (paths.length === 1) return undefined; // Ordinary branch/tree-ish switch, without force.
            paths = paths.slice(1);
          }
        } catch { /* Non-revisions may be checkout pathspecs; status must prove them clean. */ }
      }
    }
    try { if ((await reads.git(cwd, ["status", "--porcelain", "--", ...paths])).trim() === "") return undefined; } catch { /* Unknown is not clean. */ }
    return match("destroy-local", `Discard changes with git ${action}`);
  }
  if (action === "worktree" && tokens.includes("remove")) {
    if (flag(tokens, "--force", "f")) return match("destroy-local", "Force-remove a Git worktree");
    const path = operands(tokens).find(t => t !== "remove");
    try { if (path !== undefined && (await reads.git(resolve(cwd, path), ["status", "--porcelain"])).trim() === "") return undefined; } catch { /* Gate unreadable worktrees. */ }
    return match("destroy-local", "Remove a dirty or unreadable Git worktree");
  }
  if (action === "branch" && (tokens.some(t => /^-[^-]*D/u.test(t)) || (flag(tokens, "--delete", "d") && flag(tokens, "--force", "f")))) {
    try {
      const merged = (await reads.git(cwd, ["branch", "--format=%(refname:short)", "--merged", "HEAD"])).trim().split("\n");
      if (operands(tokens).every(t => merged.includes(t))) return undefined;
    } catch { /* Unknown is not merged. */ }
    return match("destroy-local", "Delete an unmerged Git branch");
  }
  return undefined;
}

/** Quote-aware recognition, not shell execution. Only unquoted heredocs expand substitutions. */
function shellCommands(script: string, readSubstitutions = true): string[][] {
  const lines = script.split("\n"); const code: string[] = [];
  const delimiters: {word: string; quoted: boolean; shell: boolean}[] = [];
  const shellBodies: string[][] = []; const substitutions: string[][] = []; let body: string[] = [];
  for (const line of lines) {
    const delimiter = delimiters[0];
    if (delimiter !== undefined) {
      if (line.replace(/^\t+/u, "") === delimiter.word) {
        delimiters.shift(); const content = body.join("\n");
        if (delimiter.shell) shellBodies.push(["bash", "-c", content]);
        if (!delimiter.quoted && readSubstitutions) substitutions.push(...heredocSubstitutions(content));
        body = [];
      } else body.push(line);
      continue;
    }
    code.push(line);
    const shell = /^\s*(?:bash|sh)\s+.*<</u.test(line);
    for (const found of line.matchAll(/(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z_0-9]*)\1(?=$|[\s;|&<>])/gu)) {
      if (found[2] !== undefined) delimiters.push({word: found[2], quoted: found[1] !== "", shell});
    }
  }
  const result: string[][] = []; let tokens: string[] = []; let word = ""; let quote = ""; let started = false;
  const flush = () => { if (started) tokens.push(word); word = ""; started = false; };
  const end = () => { flush(); if (tokens.length > 0) result.push(tokens); tokens = []; };
  const text = code.join("\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (c === "\\" && quote !== "'") {
      const escaped = text[++i] ?? "";
      if (escaped !== "\n") { word += escaped; started = true; }
      continue;
    }
    if (quote !== "'" && (c === "`" || (c === "$" && text[i + 1] === "("))) {
      const endIndex = substitutionEnd(text, i);
      const inner = text.slice(i + (c === "`" ? 1 : 2), endIndex);
      if (readSubstitutions) substitutions.push(...shellCommands(inner, false));
      word += "<substitution>"; started = true; i = endIndex; continue;
    }
    if (quote !== "") { if (c === quote) quote = ""; else word += c; started = true; continue; }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === "#" && !started) { while (i < text.length && text[i] !== "\n") i++; end(); continue; }
    if (";|&\n(){}".includes(c)) { end(); continue; }
    if (/\s/u.test(c)) { flush(); continue; }
    word += c; started = true;
  }
  end(); return [...result, ...shellBodies, ...substitutions];
}
function substitutionEnd(text: string, start: number): number {
  const backtick = text[start] === "`"; let depth = 1; let quote = "";
  for (let i = start + (backtick ? 1 : 2); i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && quote !== "'") { i++; continue; }
    if (backtick && c === "`") return i;
    if (quote !== "'") {
      if (c === "$" && text[i + 1] === "(") { i = substitutionEnd(text, i); continue; }
      if (!backtick && c === "`") { i = substitutionEnd(text, i); continue; }
    }
    if (quote !== "") { if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (!backtick && c === "(") depth++;
    if (!backtick && c === ")" && --depth === 0) return i;
  }
  return text.length;
}
function heredocSubstitutions(text: string): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "`" || (text[i] === "$" && text[i + 1] === "(")) {
      const end = substitutionEnd(text, i);
      result.push(...shellCommands(text.slice(i + (text[i] === "`" ? 1 : 2), end), false)); i = end;
    }
  }
  return result;
}
