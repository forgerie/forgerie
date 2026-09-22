import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildActiveCommandCatalog } from "../sessions/commandCatalog.js";
import { canonicalPromptResourceOrigin } from "../sessions/promptResourceOrigin.js";
import { createDefaultPromptResourceLoader, enforcePromptResourceCatalogLimits, PROMPT_RESOURCE_CATALOG_LIMITS, PromptResourceCatalogService, promptResourceCatalogUnavailable, type PromptResourceLoader } from "./promptResourceCatalog.js";
import type { PromptResourceCatalogAvailable, PromptResourceCatalogResponse } from "../../shared/promptResourceCommand.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("PromptResourceCatalogService", () => {
  it("loads prompt and skill descriptors with the real resource loader without sessions, extensions, themes, or context", async () => {
    const root = await tempRoot();
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const marker = join(root, "extension-ran");
    await mkdir(join(workspace, ".pi", "prompts"), { recursive: true });
    await mkdir(join(workspace, ".pi", "skills", "audit"), { recursive: true });
    await mkdir(join(workspace, ".pi", "extensions"), { recursive: true });
    await mkdir(join(workspace, ".pi", "themes"), { recursive: true });
    await writeFile(join(workspace, ".pi", "prompts", "review.md"), "---\ndescription: Review changes\n---\nReview $ARGUMENTS\n", "utf8");
    await writeFile(join(workspace, ".pi", "skills", "audit", "SKILL.md"), "---\nname: audit\ndescription: Audit changes\n---\nAudit body\n", "utf8");
    await writeFile(join(workspace, ".pi", "extensions", "index.js"), `import { writeFileSync } from "node:fs";\nexport default function extension() { writeFileSync(${JSON.stringify(marker)}, "ran"); }\n`, "utf8");
    await writeFile(join(workspace, ".pi", "themes", "broken.json"), "{ not json", "utf8");
    await writeFile(join(workspace, "AGENTS.md"), "context file that must not affect the resource catalog", "utf8");

    const service = new PromptResourceCatalogService({ agentDir, loader: createDefaultPromptResourceLoader() });

    const response = await service.catalog(workspace);

    expect(response).toMatchObject({ available: true });
    if (!response.available) throw new Error(response.message);
    expect(response.commands.map((command) => `${command.source}:${command.name}`)).toEqual(expect.arrayContaining(["prompt:review", "skill:skill:audit"]));
    expect(response.commands.every((command) => /^[a-f0-9]{64}$/u.exec(command.identity.fingerprint) !== null)).toBe(true);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(agentDir, "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(response)).not.toContain(workspace);
    expect(JSON.stringify(response)).not.toContain(agentDir);
  });

  it("projects the same prompt and skill metadata as the active command catalog without leaking paths", async () => {
    const root = await tempRoot();
    const workspace = join(root, "workspace");
    const promptPath = join(workspace, ".pi", "prompts", "review.md");
    const skillPath = join(workspace, ".pi", "skills", "audit", "SKILL.md");
    const skillBody = "---\ndescription: Audit\n---\nAudit body\n";
    const resources = {
      prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", filePath: "review.md", sourceInfo: sourceInfo(promptPath) }],
      skills: [{ name: "audit", description: "Audit", filePath: skillPath, baseDir: join(workspace, ".pi", "skills", "audit"), sourceInfo: sourceInfo(skillPath), disableModelInvocation: false }],
      diagnostics: [],
    };
    const loader = resourcesFrom({ ...resources, skillFiles: { [skillPath]: skillBody } });
    const service = new PromptResourceCatalogService({ agentDir: join(root, "agent"), loader });

    const response = await service.catalog(workspace);
    const active = await buildActiveCommandCatalog({
      builtins: [],
      extensions: [],
      prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", origin: canonicalPromptResourceOrigin("prompt", "review.md", sourceInfo(promptPath)) }],
      skills: [{ name: "audit", description: "Audit", content: skillBody, origin: canonicalPromptResourceOrigin("skill", skillPath, sourceInfo(skillPath)), baseDir: join(workspace, ".pi", "skills", "audit"), filePath: skillPath }],
    });

    expect(response).toEqual({ available: true, commands: active.firstPromptCommands, diagnostics: [] });
    expect(JSON.stringify(response)).not.toContain(workspace);
    expect(JSON.stringify(response)).not.toContain(skillPath);
  });

  it("uses canonical origins, not public basenames, in command identities", async () => {
    const firstPath = "/workspace/a/.pi/prompts/review.md";
    const secondPath = "/workspace/b/.pi/prompts/review.md";
    const service = new PromptResourceCatalogService({
      agentDir: "/agent",
      loader: {
        loadResources({ cwd }) {
          const filePath = cwd === "/workspace/a" ? firstPath : secondPath;
          return Promise.resolve({
            prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", filePath, sourceInfo: sourceInfo(filePath) }],
            skills: [],
            diagnostics: [],
          });
        },
      },
    });

    const first = await service.catalog("/workspace/a");
    const second = await service.catalog("/workspace/b");

    if (!first.available || !second.available) throw new Error("Expected available catalogs");
    expect(first.commands[0]?.identity.fingerprint).not.toBe(second.commands[0]?.identity.fingerprint);
    expect(JSON.stringify(first)).not.toContain(firstPath);
    expect(JSON.stringify(second)).not.toContain(secondPath);
  });

  it("returns an available empty catalog for a destination with no prompt resources", async () => {
    const service = new PromptResourceCatalogService({ agentDir: "/agent", loader: resourcesFrom({ prompts: [], skills: [], diagnostics: [] }) });

    await expect(service.catalog("/workspace")).resolves.toEqual({ available: true, commands: [], diagnostics: [] });
  });

  it("keeps valid resources available while sanitizing loader diagnostics", async () => {
    const workspace = "/workspace/private-repo";
    const agentDir = "/agent/private-profile";
    const service = new PromptResourceCatalogService({
      agentDir,
      loader: resourcesFrom({
        prompts: [{ name: "review", description: "Review", content: "Review $ARGUMENTS", filePath: `${workspace}/.pi/prompts/review.md`, sourceInfo: sourceInfo(`${workspace}/.pi/prompts/review.md`) }],
        skills: [],
        diagnostics: [
          { type: "error", message: `failed to parse ${workspace}/.pi/prompts/broken.md`, path: `${workspace}/.pi/prompts/broken.md` },
          { type: "collision", message: `collision between ${workspace}/a.md and ${agentDir}/b.md`, collision: { resourceType: "prompt", name: "review", winnerPath: `${workspace}/a.md`, loserPath: `${agentDir}/b.md` } },
        ],
      }),
    });

    const response = await service.catalog(workspace);

    expect(response).toMatchObject({ available: true, commands: [{ name: "review", source: "prompt" }] });
    if (!response.available) throw new Error(response.message);
    expect(response.diagnostics).toEqual([
      "error: failed to parse [path]",
      "collision: collision between [path] and [path]",
    ]);
    expect(JSON.stringify(response.diagnostics)).not.toContain(workspace);
    expect(JSON.stringify(response.diagnostics)).not.toContain(agentDir);
  });

  it("rejects command count, field, and serialized-size limit breaches as one unavailable catalog", () => {
    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(PROMPT_RESOURCE_CATALOG_LIMITS.maxCommands))).toMatchObject({ available: true });
    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(1, { nameLength: PROMPT_RESOURCE_CATALOG_LIMITS.maxNameLength, descriptionLength: PROMPT_RESOURCE_CATALOG_LIMITS.maxDescriptionLength }))).toMatchObject({ available: true });

    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(PROMPT_RESOURCE_CATALOG_LIMITS.maxCommands + 1))).toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog exceeded the command limit."));
    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(1, { nameLength: PROMPT_RESOURCE_CATALOG_LIMITS.maxNameLength + 1 }))).toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit command name."));
    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(1, { descriptionLength: PROMPT_RESOURCE_CATALOG_LIMITS.maxDescriptionLength + 1 }))).toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit description."));
    expect(enforcePromptResourceCatalogLimits(catalogWithCommands(1, { fingerprintLength: PROMPT_RESOURCE_CATALOG_LIMITS.maxIdentityLength + 1 }))).toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained an over-limit identity."));
    expect(enforcePromptResourceCatalogLimits(responseWithSerializedBytes(PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes))).toMatchObject({ available: true });
    expect(enforcePromptResourceCatalogLimits(responseWithSerializedBytes(PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes + 1))).toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog exceeded the response size limit."));
  });

  it("rejects oversized and non-regular resource content before fingerprinting", async () => {
    const root = await tempRoot();
    const oversizedPrompt = new PromptResourceCatalogService({
      agentDir: join(root, "agent"),
      loader: resourcesFrom({
        prompts: [{ name: "oversized", description: "Too large", content: "x".repeat(PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes + 1), filePath: "oversized.md", sourceInfo: sourceInfo("oversized.md") }],
        skills: [],
        diagnostics: [],
      }),
    });
    await expect(oversizedPrompt.catalog(join(root, "workspace"))).resolves.toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained over-limit resource content."));
    const oversizedPath = join(root, "oversized", "SKILL.md");
    await mkdir(join(root, "oversized"), { recursive: true });
    await writeFile(oversizedPath, "x".repeat(PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes + 1), "utf8");
    const oversized = new PromptResourceCatalogService({
      agentDir: join(root, "agent"),
      loader: resourcesFrom({
        prompts: [],
        skills: [{ name: "oversized", description: "Too large", filePath: oversizedPath, baseDir: join(root, "oversized"), sourceInfo: sourceInfo(oversizedPath), disableModelInvocation: false }],
        diagnostics: [],
      }),
    });

    await expect(oversized.catalog(join(root, "workspace"))).resolves.toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained over-limit resource content."));

    const directoryPath = join(root, "directory-skill");
    await mkdir(directoryPath, { recursive: true });
    const nonRegular = new PromptResourceCatalogService({
      agentDir: join(root, "agent"),
      loader: resourcesFrom({
        prompts: [],
        skills: [{ name: "directory", description: "Not a file", filePath: directoryPath, baseDir: directoryPath, sourceInfo: sourceInfo(directoryPath), disableModelInvocation: false }],
        diagnostics: [],
      }),
    });

    await expect(nonRegular.catalog(join(root, "workspace"))).resolves.toEqual(promptResourceCatalogUnavailable("over-limit", "Prompt-resource catalog contained over-limit resource content."));
  });

  it("coalesces concurrent loads for the same canonical destination", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const service = new PromptResourceCatalogService({
      agentDir: "/agent",
      loader: {
        async loadResources() {
          calls += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return { prompts: [], skills: [], diagnostics: [] };
        },
      },
    });

    const first = service.catalog("/workspace/child/..");
    const second = service.catalog("/workspace");
    release?.();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  it("runs at most two distinct loaders, queues sixteen distinct destinations, and returns busy for the rest", async () => {
    const running = new Map<string, () => void>();
    const started: string[] = [];
    const service = new PromptResourceCatalogService({
      agentDir: "/agent",
      loader: {
        async loadResources({ cwd }) {
          started.push(cwd);
          await new Promise<void>((resolve) => { running.set(cwd, resolve); });
          return { prompts: [], skills: [], diagnostics: [] };
        },
      },
    });

    const requests = Array.from({ length: 20 }, (_value, index) => service.catalog(`/workspace-${String(index)}`));
    const duplicateQueued = service.catalog("/workspace-2");
    await Promise.resolve();

    expect(started).toEqual(["/workspace-0", "/workspace-1"]);
    await expect(requests[18]).resolves.toEqual(promptResourceCatalogUnavailable("busy", "Prompt-resource catalog loading is busy."));
    await expect(requests[19]).resolves.toEqual(promptResourceCatalogUnavailable("busy", "Prompt-resource catalog loading is busy."));

    for (let index = 0; index < 18; index += 1) {
      running.get(`/workspace-${String(index)}`)?.();
      await requests[index];
    }
    await expect(duplicateQueued).resolves.toEqual({ available: true, commands: [], diagnostics: [] });
    expect(started).toHaveLength(18);
  });

  it("times out queued destinations even when an active loader never settles", async () => {
    const service = new PromptResourceCatalogService({
      agentDir: "/agent",
      limits: { ...PROMPT_RESOURCE_CATALOG_LIMITS, deadlineMs: 5, activeLoads: 1, queuedLoads: 1 },
      loader: {
        async loadResources() {
          await new Promise<void>(() => undefined);
          return { prompts: [], skills: [], diagnostics: [] };
        },
      },
    });

    const active = service.catalog("/hung");
    const queued = service.catalog("/queued");

    await expect(active).resolves.toEqual(promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background."));
    const queuedOutcome = await Promise.race([
      queued,
      new Promise<"still-pending">((resolvePending) => { setTimeout(() => { resolvePending("still-pending"); }, 50); }),
    ]);
    expect(queuedOutcome).toEqual(promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background."));
  });

  it("reports the ten-second deadline truthfully without claiming abort and keeps the active slot until settlement", async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const service = new PromptResourceCatalogService({
      agentDir: "/agent",
      limits: { ...PROMPT_RESOURCE_CATALOG_LIMITS, deadlineMs: 5, activeLoads: 1, queuedLoads: 16 },
      loader: {
        async loadResources({ cwd }) {
          started.push(cwd);
          if (cwd === "/slow") await new Promise<void>((resolve) => { releaseFirst = resolve; });
          return { prompts: [], skills: [], diagnostics: [] };
        },
      },
    });

    const slow = service.catalog("/slow");
    const queued = service.catalog("/queued");

    const timedOut = await slow;
    expect(timedOut).toEqual(promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background."));
    if (timedOut.available) throw new Error("Expected timeout response");
    expect(timedOut.message).not.toMatch(/abort|cancel/iu);
    expect(started).toEqual(["/slow"]);

    await expect(queued).resolves.toEqual(promptResourceCatalogUnavailable("timeout", "Prompt-resource catalog loading timed out after 10 seconds; the loader will finish in the background."));
    releaseFirst?.();
    await Promise.resolve();
    await Promise.resolve();
    await expect(service.catalog("/after-settlement")).resolves.toEqual({ available: true, commands: [], diagnostics: [] });
    expect(started).toEqual(["/slow", "/after-settlement"]);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forgerie-prompt-resources-"));
  tempRoots.push(root);
  return root;
}

function sourceInfo(path: string) {
  return { path, source: "local", scope: "project" as const, origin: "top-level" as const, baseDir: path };
}

function resourcesFrom(input: {
  prompts: Awaited<ReturnType<PromptResourceLoader["loadResources"]>>["prompts"];
  skills: Awaited<ReturnType<PromptResourceLoader["loadResources"]>>["skills"];
  diagnostics: Awaited<ReturnType<PromptResourceLoader["loadResources"]>>["diagnostics"];
  skillFiles?: Record<string, string>;
}): PromptResourceLoader {
  return {
    async loadResources() {
      const skillFiles = input.skillFiles ?? {};
      await Promise.all(Object.entries(skillFiles).map(async ([path, content]) => {
        await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
        await writeFile(path, content, "utf8");
      }));
      return { prompts: input.prompts, skills: input.skills, diagnostics: input.diagnostics };
    },
  };
}

function catalogWithCommands(count: number, options: { nameLength?: number; descriptionLength?: number; fingerprintLength?: number } = {}): PromptResourceCatalogAvailable {
  return {
    available: true,
    diagnostics: [],
    commands: Array.from({ length: count }, (_value, index) => {
      const suffix = String(index).padStart(4, "0");
      const name = options.nameLength === undefined ? `p${suffix}` : `${"p".repeat(options.nameLength - suffix.length)}${suffix}`;
      return {
        name,
        source: "prompt" as const,
        ...(options.descriptionLength === undefined ? {} : { description: "d".repeat(options.descriptionLength) }),
        identity: { source: "prompt" as const, name, fingerprint: "a".repeat(options.fingerprintLength ?? 64) },
      };
    }),
  };
}

function responseWithSerializedBytes(byteLength: number): PromptResourceCatalogResponse {
  const response: PromptResourceCatalogAvailable = { available: true, commands: [], diagnostics: [""] };
  const emptyLength = Buffer.byteLength(JSON.stringify(response), "utf8");
  response.diagnostics[0] = "x".repeat(byteLength - emptyLength);
  return response;
}
