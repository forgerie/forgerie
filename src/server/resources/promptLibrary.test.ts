import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDirPromptLibrary, parsePromptDraft, renderPromptFile, type PromptSaveResult } from "./promptLibrary.js";

async function agentDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "forgerie-prompt-library-"));
}

function refusalMessage(result: PromptSaveResult): string {
  return result.kind === "saved" ? `unexpected save of /${result.name}` : result.message;
}

describe("parsePromptDraft", () => {
  it("splits the name from a multi-line body and keeps the body's line breaks", () => {
    expect(parsePromptDraft("tell\nSpeak plainly.\n\nUse short sentences.")).toEqual({
      name: "tell",
      body: "Speak plainly.\n\nUse short sentences.",
    });
  });

  it("accepts a single-line prompt written after a space", () => {
    expect(parsePromptDraft("  tell   Speak plainly.  ")).toEqual({ name: "tell", body: "Speak plainly." });
  });

  it("reports an empty body when only a name was typed", () => {
    expect(parsePromptDraft("tell")).toEqual({ name: "tell", body: "" });
  });
});

describe("renderPromptFile", () => {
  it("derives a description from the first line and ends with a newline", () => {
    expect(renderPromptFile("Speak plainly.\nUse short sentences.")).toBe(
      "---\ndescription: Speak plainly.\n---\n\nSpeak plainly.\nUse short sentences.\n",
    );
  });

  it("quotes descriptions that would break a plain YAML scalar", () => {
    expect(renderPromptFile("Rule: no # marks").split("\n")[1]).toBe('description: "Rule: no # marks"');
  });

  it("strips a leading markdown heading and truncates a long first line", () => {
    const rendered = renderPromptFile(`## ${"word ".repeat(40)}`);
    const description = rendered.split("\n")[1] ?? "";
    expect(description.startsWith("description: word word")).toBe(true);
    expect(description.length).toBeLessThanOrEqual("description: ".length + 120);
    expect(description.endsWith("…")).toBe(true);
  });

  it("passes an author-written frontmatter body through untouched", () => {
    const authored = "---\ndescription: Mine\nmodel: fast\n---\n\nBody.\n";
    expect(renderPromptFile(authored)).toBe(authored);
  });
});

describe("AgentDirPromptLibrary", () => {
  it("writes a usable prompt file into <agentDir>/prompts", async () => {
    const dir = await agentDir();
    const library = new AgentDirPromptLibrary(dir);

    const result = await library.save({ name: "tell", body: "Speak plainly." });

    expect(result).toEqual({ kind: "saved", name: "tell", path: join(dir, "prompts", "tell.md") });
    if (result.kind !== "saved") throw new Error("Expected saved result");
    await expect(readFile(result.path, "utf8")).resolves.toBe("---\ndescription: Speak plainly.\n---\n\nSpeak plainly.\n");
  });

  it("normalizes a phone-capitalized name and a repeated slash", async () => {
    const dir = await agentDir();

    const result = await new AgentDirPromptLibrary(dir).save({ name: "/Tell", body: "Speak plainly." });

    expect(result).toMatchObject({ kind: "saved", name: "tell" });
  });

  it("refuses to overwrite an existing prompt", async () => {
    const dir = await agentDir();
    const library = new AgentDirPromptLibrary(dir);
    await library.save({ name: "tell", body: "First." });

    const result = await library.save({ name: "tell", body: "Second." });

    expect(result.kind).toBe("name-taken");
    await expect(readFile(join(dir, "prompts", "tell.md"), "utf8")).resolves.toContain("First.");
  });

  it("rejects names that would escape the prompts directory or shadow a builtin", async () => {
    const dir = await agentDir();
    const library = new AgentDirPromptLibrary(dir);

    await expect(library.save({ name: "../escape", body: "x" })).resolves.toMatchObject({ kind: "invalid-name" });
    await expect(library.save({ name: "a b", body: "x" })).resolves.toMatchObject({ kind: "invalid-name" });
    expect(refusalMessage(await library.save({ name: "compact", body: "x" }))).toContain("built-in");
    expect(refusalMessage(await library.save({ name: "", body: "x" }))).toContain("Usage:");
  });

  it("rejects an empty body before touching the filesystem", async () => {
    const dir = await agentDir();

    await expect(new AgentDirPromptLibrary(dir).save({ name: "tell", body: "  " })).resolves.toMatchObject({ kind: "empty-body" });
  });

  it("reports a write failure instead of throwing", async () => {
    const dir = await agentDir();
    // A file where the prompts directory belongs makes mkdir fail with ENOTDIR.
    await writeFile(join(dir, "prompts"), "not a directory", "utf8");

    const result = await new AgentDirPromptLibrary(dir).save({ name: "tell", body: "Speak plainly." });

    expect(result.kind).toBe("write-failed");
  });
});
