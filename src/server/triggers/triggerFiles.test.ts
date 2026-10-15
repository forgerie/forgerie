import { watch } from "node:fs";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TriggerFiles } from "./triggerFiles.js";
import { parseScheduledWorkflow } from "./triggerFileFormat.js";
let root: string;
let files: TriggerFiles;
const text = '---\n# comment\nworkflow: { version: 1 }\nschedule: { at: "03:00", projects: all }\n---\nReview.\n';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "trigger-files-")); await mkdir(join(root, "prompts")); await writeFile(join(root, "prompts", "night.md"), text); let time = 100; files = new TriggerFiles(join(root, "prompts"), join(root, "versions"), "UTC", () => time++, () => undefined); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it("round trips a document, refuses a stale save, and reads retained versions", async () => {
  const original = await files.document("night");
  const saved = await files.save("night", { text, baseSha256: original.sha256, schedule: { at: "04:00", projects: "all" } }, (value) => { parseScheduledWorkflow("night", original.path, value, "UTC"); return Promise.resolve(); });
  expect(saved.text).toContain("# comment"); expect(saved.schedule?.at).toBe("04:00");
  expect(await readFile(saved.path, "utf8")).toBe(saved.text);
  await expect(files.save("night", { text, baseSha256: original.sha256 }, () => Promise.resolve())).rejects.toMatchObject({ status: 409 });
  const versions = (await files.versions("night")).versions;
  expect(versions.map((v) => v.source)).toEqual(["forgerie", "outside"]);
  expect(await files.version("night", versions[0]?.id ?? "")).toMatchObject({ text: saved.text });
});
it("retains the newest 30 distinct observations", async () => {
  for (let i = 0; i < 33; i++) await files.observe("night", `version ${String(i)}`, "outside");
  const versions = (await files.versions("night")).versions;
  expect(await readdir(join(root, "versions", "night"))).toHaveLength(30);
  expect(versions).toHaveLength(30); expect((await files.version("night", versions[29]?.id ?? "")).text).toBe("version 3");
});
it("keeps invalid documents readable and rejects unsafe file and version IDs", async () => {
  await writeFile(join(root, "prompts", "night.md"), "---\nworkflow: broken\nschedule: nope\n---\nRepair me\n");
  expect(await files.document("night")).toMatchObject({ schedule: null, definition: null, body: "Repair me\n" });
  await expect(files.document("../night")).rejects.toMatchObject({ status: 400 });
  await expect(files.version("night", "../secret")).rejects.toMatchObject({ status: 400 });
});

it("publishes a complete version by rename and leaves no temporary archive", async () => {
  const directory = join(root, "versions", "night"); await mkdir(directory, { recursive: true });
  const events: { event: string; name: string }[] = [];
  const watcher = watch(directory, (event, name) => { if (name !== null) events.push({ event, name }); });
  try {
    await files.observe("night", text, "forgerie");
    await vi.waitFor(() => { expect(events.some(({ name }) => name.endsWith(".tmp"))).toBe(true); });
    expect(events.filter(({ name }) => name.endsWith(".json")).every(({ event }) => event === "rename")).toBe(true);
    const names = await readdir(directory); expect(names).toHaveLength(1); expect(names[0]?.endsWith(".json")).toBe(true);
    const version = (await files.versions("night")).versions[0]; if (version === undefined) throw new Error("Missing version");
    expect((await files.version("night", version.id)).text).toBe(text);
  } finally { watcher.close(); }
});
