import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("owned managed processes packaging", () => {
  it("ships the owned tool and skill, without the retired package", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.dependencies).not.toHaveProperty("@aliou/pi-processes");
    expect(manifest.bundleDependencies).not.toContain("@aliou/pi-processes");
    expect(manifest.files).not.toContain("vendor");
    const skills = JSON.parse(await readFile(new URL("../skills/package.json", import.meta.url), "utf8"));
    expect(skills.pi.skills).toContain("./processes");
  });
});
