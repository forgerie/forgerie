import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime } from "./piSessionService.testSupport.js";

const catalogSchema = Type.Object({ activeTools: Type.Array(Type.String()), allTools: Type.Array(Type.String()) });
const roots: string[] = [];
const services: PiSessionService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function hostedSession(scope: "global" | "project", askUserEnabled = true) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-question-tools-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const home = join(root, "home");
  await Promise.all([agentDir, cwd, home].map((path) => mkdir(path, { recursive: true })));
  vi.stubEnv("HOME", home);
  const extensionDir = scope === "global" ? join(agentDir, "extensions") : join(cwd, ".pi", "extensions");
  await mkdir(extensionDir, { recursive: true });
  const catalogPath = join(root, "catalog.json");
  const confirmationPath = join(root, "confirmation.txt");
  const extensionPath = join(extensionDir, "questions.js");
  // A real extension registers the competing tool and keeps independent hooks
  // and commands. Host policy must suppress the tool, not disable the extension.
  const source = `
    import { writeFileSync } from "node:fs";
    export default function (pi) {
      for (const name of ["question", "plugin_probe"]) {
        pi.registerTool({
          name, label: name, description: "Question-tool policy acceptance probe",
          parameters: { type: "object", properties: {} },
          async execute() { return { content: [{ type: "text", text: "probe" }] }; }
        });
      }
      const recordTools = () => {
        pi.setActiveTools([...pi.getActiveTools(), "question"]);
        writeFileSync(${JSON.stringify(catalogPath)}, JSON.stringify({
          activeTools: pi.getActiveTools(),
          allTools: pi.getAllTools().map((tool) => tool.name)
        }));
      };
      pi.on("session_start", recordTools);
      pi.registerCommand("tool-catalog-probe", { description: "Record tool availability", handler: recordTools });
      pi.registerCommand("plugin-confirmation", {
        description: "Ask for plugin permission",
        async handler(_args, ctx) {
          const answer = await ctx.ui.confirm("Allow plugin action?", "This is an extension confirmation.");
          writeFileSync(${JSON.stringify(confirmationPath)}, String(answer));
        }
      });
    }
  `;
  await writeFile(extensionPath, source);
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir,
    modelRuntime: await createTestModelRuntime(),
    sessionManager: createPiSessionManagerGateway({ agentDir, env: {}, sessionDirEnvKeys: [] }),
    askUserEnabled,
    heartbeatIntervalMs: 60_000,
  });
  services.push(service);
  const session = await service.start(cwd);
  return { service, ref: { id: session.id, cwd }, events, catalogPath, confirmationPath, extensionPath, source };
}

async function readCatalog(path: string) {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Value.Check(catalogSchema, value)) throw new Error("Invalid tool catalog marker");
  return value;
}

async function expectSingleQuestionTool(path: string): Promise<void> {
  const catalog = await readCatalog(path);
  for (const names of [catalog.activeTools, catalog.allTools]) {
    expect(names).toContain("ask_user");
    expect(names).toContain("plugin_probe");
    expect(names).not.toContain("question");
  }
}

describe("Forgerie agent question tools", () => {
  it.each(["global", "project"] as const)("keeps only ask_user when a %s extension registers question, including after reload", async (scope) => {
    const harness = await hostedSession(scope);
    await expectSingleQuestionTool(harness.catalogPath);

    await expect(harness.service.runCommand(harness.ref, "/reload")).resolves.toMatchObject({ type: "done" });
    await expect(harness.service.runCommand(harness.ref, "/tool-catalog-probe")).resolves.toMatchObject({ type: "done" });
    await expectSingleQuestionTool(harness.catalogPath);
    expect(await readFile(harness.extensionPath, "utf8")).toBe(harness.source);
  });

  it("does not restore question as a fallback when ask_user is disabled", async () => {
    const harness = await hostedSession("global", false);
    const catalog = await readCatalog(harness.catalogPath);
    for (const names of [catalog.activeTools, catalog.allTools]) {
      expect(names).not.toContain("ask_user");
      expect(names).not.toContain("question");
      expect(names).toContain("plugin_probe");
    }
  });

  it("preserves plugin confirmations and delivers their answers", async () => {
    const harness = await hostedSession("global");
    const command = harness.service.runCommand(harness.ref, "/plugin-confirmation");
    await vi.waitFor(() => {
      expect(harness.events.sessionEvents.some(({ event }) => event.type === "dialog.opened")).toBe(true);
    });
    const status = await harness.service.status(harness.ref);
    const dialog = status.pendingDialogs?.[0];
    if (dialog === undefined) throw new Error("Plugin confirmation did not open");
    expect(dialog).toMatchObject({ kind: "confirm", title: "Allow plugin action?" });
    await harness.service.answerDialog(harness.ref, dialog.dialogId, true);
    await expect(command).resolves.toMatchObject({ type: "done" });
    expect(await readFile(harness.confirmationPath, "utf8")).toBe("true");
    await expectSingleQuestionTool(harness.catalogPath);
  });
});
