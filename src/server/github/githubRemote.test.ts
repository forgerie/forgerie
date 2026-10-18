import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { originGitHubRepo, parseGitHubRemote } from "./githubRemote.js";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("GitHub remote parsing", () => {
  it.each([
    ["git@github.com:korri-os/korri.git", "korri-os/korri"],
    ["github.com:korri-os/korri", "korri-os/korri"],
    ["https://github.com/korri-os/korri", "korri-os/korri"],
    ["https://github.com/korri-os/korri.git/", "korri-os/korri"],
    ["https://user@github.com/korri-os/korri.git", "korri-os/korri"],
    ["ssh://git@github.com/korri-os/korri.git", "korri-os/korri"],
    ["ssh://git@github.com:22/korri-os/korri.git", "korri-os/korri"],
    ["git://github.com/korri-os/korri.git", "korri-os/korri"],
    ["  https://GitHub.com/Owner/repo.name  \n", "Owner/repo.name"],
  ])("reads %s as %s", (url, slug) => {
    expect(parseGitHubRemote(url)).toBe(slug);
  });
  it.each([
    "https://gitlab.com/korri-os/korri.git", "git@gitlab.com:korri-os/korri.git", "https://github.com.evil.example/a/b",
    "https://github.com/korri-os", "https://github.com/a/b/c", "https://github.com:8443/a/b", "/home/me/korri", "file:///home/me/korri", "",
  ])("rejects %s", (url) => {
    expect(parseGitHubRemote(url)).toBeUndefined();
  });
  it("reads only origin, and reports a checkout without one as no repo", async () => {
    const repo = await mkdtemp(join(tmpdir(), "forgerie-github-remote-")); directories.push(repo);
    const git = (...args: string[]) => execute("git", ["-C", repo, ...args], { env: sanitizedGitEnv() });
    await git("init", "-b", "main");
    await git("remote", "add", "upstream", "https://github.com/someone-else/fork-source.git");
    expect(await originGitHubRepo(repo)).toBeUndefined();
    await git("remote", "add", "origin", "git@github.com:korri-os/korri.git");
    expect(await originGitHubRepo(repo)).toBe("korri-os/korri");
  });
  it("reports a folder that is not a git checkout as no repo", async () => {
    const folder = await mkdtemp(join(tmpdir(), "forgerie-github-remote-")); directories.push(folder);
    expect(await originGitHubRepo(folder)).toBeUndefined();
  });
});
