import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChildAgentCatalog, parseChildAgentFile } from "./durableChildProfiles.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const content = "---\r\nname: worker\r\nmodel: test/small\r\n---\r\nDo the work.\r\n";

describe("child agent file provenance", () => {
  it("hashes original bytes rather than normalized Markdown", () => {
    const source = Buffer.from(content);
    const profile = parseChildAgentFile(source, "/profile/worker.md");
    expect(profile?.source).toEqual({ path: "/profile/worker.md", sha256: createHash("sha256").update(source).digest("hex") });
    expect(profile?.prompt).toBe("Do the work.");
    expect(profile?.source.sha256).not.toBe(parseChildAgentFile(content.replace(/\r/g, ""))?.source.sha256);
  });
  it("keeps the selected file's provenance when a lower-priority file has the same name", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-agent-source-")); roots.push(root);
    const project = join(root, "project"); const profile = join(root, "profile");
    await mkdir(project); await mkdir(profile);
    const path = join(project, "worker.md");
    await writeFile(path, content);
    await writeFile(join(profile, "worker.md"), content.replace("Do the work.", "Different instructions."));
    const found = await new ChildAgentCatalog([project, profile]).find("worker");
    expect(found?.source).toEqual({ path, sha256: createHash("sha256").update(content).digest("hex") });
    await writeFile(path, content.replace("Do the work.", "Updated instructions."));
    expect((await new ChildAgentCatalog([project, profile]).find("worker"))?.source.sha256).not.toBe(found?.source.sha256);
  });
});
