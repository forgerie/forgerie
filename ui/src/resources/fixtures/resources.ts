import type { ResourceEntry, ResourceFile, ResourceInventory } from "../resourceApi";
import decomposition from "../../../docs/decomposition.md?raw";

const hex = (seed: string) => seed.padEnd(64, "0").slice(0, 64);
const PROFILE = "/home/ada/.local/share/forgerie/agent";
const AGENTS = "/home/ada/.agents/skills";
const CHECKOUT = "/home/ada/code/acme/.worktree/sign-in";
const BUNDLED = "/opt/forgerie/skills";
const MOBBIN = "/home/ada/code/pi-mobbin";

function entry(seed: string, values: Omit<ResourceEntry, "id" | "manual" | "activation" | "edit"> & Partial<Pick<ResourceEntry, "manual" | "activation" | "edit">>): ResourceEntry {
  return { id: hex(seed), manual: false, activation: { kind: "active" }, edit: { kind: "writable", saveEffect: "file-only" }, ...values };
}
const projectOrigin = { kind: "project", source: "local", scope: "project", root: `${CHECKOUT}/.agents/skills` } as const;
const userOrigin = { kind: "user", source: "local", scope: "user", root: AGENTS } as const;
const bundledOrigin = { kind: "bundled", source: "forgerie", scope: "temporary", root: BUNDLED } as const;
const packageOrigin = { kind: "package", source: "pi-mobbin", scope: "user", root: MOBBIN } as const;
const readOnlyPackage = { kind: "read-only", reason: "A package update replaces this file, so it is read-only here." } as const;

export const testingGuide = entry("a1", { kind: "skill", name: "testing-guide", description: "Repository-specific testing guide.",
  path: `${CHECKOUT}/.agents/skills/testing-guide/SKILL.md`, origin: projectOrigin, edit: { kind: "writable", saveEffect: "uncommitted" } });
export const bundledHandoff = entry("b1", { kind: "skill", name: "handoff", description: "Detach the conversation into a continuation session.",
  path: `${BUNDLED}/handoff/SKILL.md`, origin: bundledOrigin, edit: { kind: "read-only", reason: "Forgerie ships this file, so it is read-only here." } });
export const mobbin = entry("c1", { kind: "skill", name: "mobbin-reference", description: "How shipped apps solve a screen, flow, or section.",
  path: `${MOBBIN}/skills/mobbin-reference/SKILL.md`, origin: packageOrigin, edit: readOnlyPackage });

export const entries: ResourceEntry[] = [
  testingGuide,
  entry("a2", { kind: "skill", name: "documentation-guide", description: "Where documentation goes and how to write it.",
    path: `${CHECKOUT}/.agents/skills/documentation-guide/SKILL.md`, origin: projectOrigin, edit: { kind: "writable", saveEffect: "uncommitted" } }),
  entry("d1", { kind: "skill", name: "code-review", description: "Review the changes since a fixed point, on two axes.", path: `${AGENTS}/code-review/SKILL.md`, origin: userOrigin }),
  entry("d2", { kind: "skill", name: "teach", description: "Teach a new skill or concept, within this workspace.", path: `${AGENTS}/teach/SKILL.md`, origin: userOrigin, manual: true }),
  entry("d3", { kind: "skill", name: "handoff", description: "Compact the conversation into a handoff document.", path: `${AGENTS}/handoff/SKILL.md`, origin: userOrigin,
    activation: { kind: "shadowed", winnerId: hex("b1") } }),
  entry("d4", { kind: "skill", name: "draft-skill", description: "", path: `${AGENTS}/draft-skill/SKILL.md`, origin: userOrigin,
    activation: { kind: "invalid", message: "The description is missing." } }),
  bundledHandoff,
  mobbin,
  entry("e1", { kind: "prompt", name: "review", description: "Open one guided review of a changeset.", path: `${PROFILE}/prompts/review.md`,
    origin: { kind: "user", source: "local", scope: "user", root: `${PROFILE}/prompts` } }),
  entry("e2", { kind: "prompt", name: "relay", description: "Plan a relay and dispatch leg 1.", path: `${CHECKOUT}/.pi/prompts/relay.md`,
    origin: { kind: "project", source: "local", scope: "project", root: `${CHECKOUT}/.pi/prompts` }, edit: { kind: "writable", saveEffect: "uncommitted" } }),
  entry("f1", { kind: "context", name: "AGENTS.md", description: "", path: `${CHECKOUT}/AGENTS.md`,
    origin: { kind: "project", source: "local", scope: "project", root: CHECKOUT }, edit: { kind: "writable", saveEffect: "uncommitted" } }),
  entry("f2", { kind: "context", name: "AGENTS.md", description: "", path: `${PROFILE}/AGENTS.md`,
    origin: { kind: "user", source: "local", scope: "user", root: PROFILE } }),
];

export const sessionInventory: ResourceInventory = {
  scope: { kind: "session", sessionId: "s1", cwd: CHECKOUT }, resources: entries, diagnostics: [], maxFileBytes: 1_048_576,
};
export const settingsInventory: ResourceInventory = {
  scope: { kind: "settings" }, resources: entries.filter((item) => item.origin.kind !== "project"),
  diagnostics: ["Package npm:@acme/missing is not installed, so its files are not listed."], maxFileBytes: 1_048_576,
};

export const testingGuideFile: ResourceFile = { resource: testingGuide, revision: hex("r1"), text: [
  "---", "name: testing-guide", "description: Repository-specific testing guide.", "---", "", "# Testing guide", "",
  "Prefer the smallest layer that proves the behavior.", "Never sleep to wait for a render; await `settle()` instead.", "",
].join("\n") };
export const mobbinFile: ResourceFile = { resource: mobbin, revision: hex("r2"), text: [
  "---", "name: mobbin-reference", "description: How shipped apps solve a screen, flow, or section.", "---", "",
  "# Mobbin reference", "", "Before you draw, decide, or critique, look at how shipped products solved the same screen.", "",
].join("\n") };
/** A context file past the rich view's limit: about 300 KB of rules. */
export const largeContextFile: ResourceFile = { resource: entries.find((item) => item.kind === "context")!, revision: hex("r4"), text: [
  "# Acme agent rules", "",
  ...Array.from({ length: 2400 }, (_, index) => `${String(index + 1)}. Keep rule ${String(index + 1)} in mind: run the narrowest test that proves the change, then the suite, before every commit.\n`),
].join("\n") };
/** A real file of this repository, ui/docs/decomposition.md, as a project prompt: its tables are what the rich view would rewrite. */
export const decompositionFile: ResourceFile = { revision: hex("r5"), text: decomposition, resource: entry("g1", { kind: "prompt", name: "decomposition",
  description: "Where a file lives in the browser app.", path: `${CHECKOUT}/ui/docs/decomposition.md`,
  origin: { kind: "project", source: "local", scope: "project", root: `${CHECKOUT}/ui/docs` }, edit: { kind: "writable", saveEffect: "uncommitted" } }) };
