import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { canonicalGitEndpoint } from "./canonicalGitEndpoint.js";

it.each([
  "https://token@EXAMPLE.invalid/owner/repo.git/",
  "ssh://git@example.invalid/owner/repo",
  "git@EXAMPLE.invalid:owner/repo.git",
  "example.invalid:owner/repo/",
  "ssh://git@example.invalid:22/owner/repo.git",
])("uses host and repository path, not credentials or transport: %s", async url => {
  expect(await canonicalGitEndpoint(url, "/tmp")).toBe("network:example.invalid/owner/repo");
});
it("keeps other hosts, paths and non-default ports separate", async () => {
  expect(await canonicalGitEndpoint("ssh://host.invalid:2222/o/r", "/tmp")).toBe("network:host.invalid:2222/o/r");
  expect(await canonicalGitEndpoint("https://other.invalid/o/r", "/tmp")).not.toBe(await canonicalGitEndpoint("https://host.invalid/o/r", "/tmp"));
  expect(await canonicalGitEndpoint("https://host.invalid/other/r", "/tmp")).not.toBe(await canonicalGitEndpoint("https://host.invalid/o/r", "/tmp"));
});
it("uses real paths for local remotes and file URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-endpoint-"));
  try {
    await symlink(root, join(root, "alias"));
    expect(await canonicalGitEndpoint("alias", root)).toBe(`local:${await realpath(root)}`);
    expect(await canonicalGitEndpoint(pathToFileURL(root).href, root)).toBe(`local:${await realpath(root)}`);
  } finally { await rm(root, {recursive: true, force: true}); }
});
it.each(["", "--bad", "~/unknown", "ext::custom", "https://host.invalid/", " https://host.invalid/o/r", "https://host.invalid/o/r ", "https://host.invalid/o/r?x=1", "https://host.invalid/o/%2fr", "git@host.invalid:o/../r", "/does/not/exist"])("does not guess an uncertain endpoint: %s", async url => {
  await expect(canonicalGitEndpoint(url, "/tmp")).rejects.toThrow();
});
