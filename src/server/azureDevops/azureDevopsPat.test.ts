import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AzureDevopsPatStore } from "./azureDevopsPat.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() { const directory = await mkdtemp(join(tmpdir(), "azure-pat-")); directories.push(directory); return { directory, path: join(directory, "amazeinsights.pat"), store: new AzureDevopsPatStore(directory) }; }

describe("server-only Azure PAT", () => {
  it("reads a private file and sees rotation and removal without a restart", async () => {
    const f = await fixture();
    await writeFile(f.path, "firstReadToken1234567890\n", { mode: 0o600 });
    expect(await f.store.read("AMAZEINSIGHTS")).toEqual({ ok: true, token: "firstReadToken1234567890" });
    await writeFile(f.path, "secondReadToken1234567890\n");
    expect(await f.store.read("amazeinsights")).toEqual({ ok: true, token: "secondReadToken1234567890" });
    await rm(f.path);
    expect(await f.store.read("amazeinsights")).toMatchObject({ ok: false });
  });
  it("refuses public files, symlinks, malformed tokens and path traversal without returning any bytes", async () => {
    const f = await fixture();
    await writeFile(f.path, "privateReadToken1234567890", { mode: 0o600 }); await chmod(f.path, 0o644);
    expect(await f.store.read("amazeinsights")).toMatchObject({ ok: false });
    await rm(f.path); await writeFile(join(f.directory, "other"), "privateReadToken1234567890", { mode: 0o600 });
    await symlink(join(f.directory, "other"), f.path);
    expect(await f.store.read("amazeinsights")).toMatchObject({ ok: false });
    await rm(f.path); await writeFile(f.path, "private\nReadToken1234567890", { mode: 0o600 });
    expect(JSON.stringify(await f.store.read("amazeinsights"))).not.toContain("private\\nReadToken");
    expect(await f.store.read("../other")).toMatchObject({ ok: false });
  });
});
