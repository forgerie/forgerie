import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledSubagentsPackagePath } from "./bundledSubagents.js";
import { parseChildAgentFile } from "./durableChildProfiles.js";
import { planChildRuntime, runtimeGaps } from "./durableChildRuntime.js";
import { diffInputProblem, imageType, page, DIFF_PAGE_CHARS } from "./durableChildTools.js";

// The agent files sessiond really falls back to.
const bundled = join(bundledSubagentsPackagePath(), "agents");
const bundledAgent = async (name: string) => {
  const path = join(bundled, `${name}.md`);
  const profile = parseChildAgentFile(await readFile(path), path);
  if (profile === undefined) throw new Error(`Bundled agent ${name} did not parse`);
  return profile;
};

let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "forgerie-child-runtime-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function skill(dir: string, name: string, description: string) {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  return { name, description, path: join(dir, name, "SKILL.md") };
}

describe("a pi-subagents agent file in a Durable child", () => {
  it("gives the bundled reviewer its diff tool and its way to the user, and says how they differ", async () => {
    const plan = planChildRuntime(await bundledAgent("reviewer"), [], []);
    expect([...(plan.tools ?? [])].sort()).toEqual(["ask_human", "bash", "read", "watchdog_diff"]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.section).toContain("contact_supervisor is ask_human here");
    expect(plan.section).toContain("watchdog_diff also takes `range`");
    expect(plan.section).toContain("read also opens PNG");
    expect(runtimeGaps(plan)).toBe("");
  });

  it("names tools it cannot provide, in the child's instructions and in the parent's spawn result", async () => {
    const plan = planChildRuntime(await bundledAgent("researcher"), [], []);
    expect(plan.unavailable).toEqual(expect.arrayContaining(["web_search", "fetch_content"]));
    expect(plan.tools).not.toContain("web_search");
    expect(plan.section).toContain("Not available here: web_search");
    expect(runtimeGaps(plan)).toContain("Not available to it here: tools web_search");
  });

  it("lists the skills the file names, from its own skill folder first, and reports the ones it cannot find", async () => {
    const own = join(root, "own-skills");
    const session = join(root, "session-skills");
    const local = await skill(own, "frontend-design", "Local copy");
    await skill(session, "frontend-design", "Session copy");
    const intrinsic = await skill(session, "intrinsic-design", "Layout from the container");
    await mkdir(join(root, "agents"));
    const path = join(root, "agents", "design-engineer.md");
    const profile = parseChildAgentFile(`---\nname: design-engineer\ndescription: UI\ntools: read, bash, edit, write, contact_supervisor\nskillPath: ../own-skills\nskills: frontend-design, intrinsic-design, mobbin-reference\ninheritSkills: false\n---\nBuild UI.\n`, path);
    const plan = planChildRuntime(profile, [], [{ ...intrinsic }, { name: "frontend-design", description: "Session copy", path: join(session, "frontend-design", "SKILL.md") }, { name: "unrelated", description: "x", path: "/x" }]);
    expect(plan.skills).toEqual([local, intrinsic]);
    expect(plan.missingSkills).toEqual(["mobbin-reference"]);
    expect(plan.section).toContain(`<location>${local.path}</location>`);
    expect(plan.section).not.toContain("unrelated");
    expect(runtimeGaps(plan)).toBe(" Not available to it here: skills mobbin-reference.");
  });

  it("offers every tool and adds nothing for a general helper", () => {
    const plan = planChildRuntime(undefined, [], []);
    expect(plan.tools).toBeUndefined();
    expect(plan.section).toContain("read also opens PNG");
    expect(plan.unavailable).toEqual([]);
  });
});

describe("watchdog_diff input and paging", () => {
  it("accepts revisions and ranges and refuses option-like input", () => {
    for (const range of ["main", "3e72540c..HEAD", "main...c-22432a39", "HEAD~3..HEAD", "origin/main...feat/x"]) expect(diffInputProblem(range, undefined)).toBeUndefined();
    for (const range of ["--output=/tmp/x", "a..b..c", "main;rm", "", "a..-b"]) expect(diffInputProblem(range, undefined)).toBeDefined();
    expect(diffInputProblem(undefined, "ui/src")).toBeUndefined();
    for (const path of ["-x", "/etc", "../up"]) expect(diffInputProblem(undefined, path)).toBeDefined();
  });

  it("pages a long diff and says where the next page starts", () => {
    const text = "x".repeat(DIFF_PAGE_CHARS + 10);
    expect(page(text, 0)).toContain(`call again with offset ${String(DIFF_PAGE_CHARS)}`);
    expect(page(text, DIFF_PAGE_CHARS)).toBe("x".repeat(10));
    expect(page("short", 0)).toBe("short");
  });

  it("knows image types by their first bytes", () => {
    expect(imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(imageType(new TextEncoder().encode("plain text"))).toBeUndefined();
  });
});
