import { readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceFile, WorkspaceFileConflictError, writeWorkspaceFile } from "./fileContentService.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("file versions", () => {
  it("gives a whole UTF-8 file a version, and the same bytes the same version", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "a.txt"), "\uFEFFhéllo\r\n");
    await writeFile(join(root, "b.txt"), "\uFEFFhéllo\r\n");

    const [a, b] = await Promise.all([readWorkspaceFile(root, "a.txt"), readWorkspaceFile(root, "b.txt")]);

    expect(a.version).toMatch(/^[0-9a-f]{64}$/u);
    expect(a.version).toBe(b.version);
    expect(a.content).toBe("\uFEFFhéllo\r\n");
  });

  it("gives no version to text an editor could not save back unchanged", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    await writeFile(join(root, "binary.dat"), Buffer.from([0x00, 0x01, 0x02]));
    await writeFile(join(root, "large.txt"), "");
    await truncate(join(root, "large.txt"), 512 * 1024 + 1);

    const files = await Promise.all(["latin1.txt", "binary.dat", "large.txt"].map((path) => readWorkspaceFile(root, path)));

    expect(files.map((file) => file.version)).toEqual([undefined, undefined, undefined]);
  });

  it("writes when the expected version still matches, and returns the new version", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "notes.txt"), "old\n");
    const { version } = await readWorkspaceFile(root, "notes.txt");

    const result = await writeWorkspaceFile(root, "notes.txt", Buffer.from("new\n"), { expectedVersion: version ?? "" });

    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("new\n");
    expect(result.version).toBe((await readWorkspaceFile(root, "notes.txt")).version);
  });

  it("refuses to write over a change made after the read, and names the version on disk", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "notes.txt"), "old\n");
    const { version } = await readWorkspaceFile(root, "notes.txt");
    await writeFile(join(root, "notes.txt"), "the agent's edit\n");
    const now = (await readWorkspaceFile(root, "notes.txt")).version;

    const write = writeWorkspaceFile(root, "notes.txt", Buffer.from("mine\n"), { expectedVersion: version ?? "" });

    await expect(write).rejects.toBeInstanceOf(WorkspaceFileConflictError);
    await expect(write).rejects.toMatchObject({ path: "notes.txt", version: now });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("the agent's edit\n");
  });

  it("refuses to bring back a file deleted after the read", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "gone.txt"), "here\n");
    const { version } = await readWorkspaceFile(root, "gone.txt");
    await rm(join(root, "gone.txt"));

    const write = writeWorkspaceFile(root, "./gone.txt", Buffer.from("mine\n"), { expectedVersion: version ?? "" });

    await expect(write).rejects.toMatchObject({ name: "WorkspaceFileConflictError", path: "gone.txt", version: undefined });
    await expect(readFile(join(root, "gone.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
