import { createDurableChildHost, LiveChildSessionIndex } from "../sessions/durableChildHost.js";
import { ChildRunStore } from "../sessions/childRunStore.js";
// Subprocess acceptance owns only the supplied temporary profile. SIGKILL is intentional.
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { WorkflowLibrary, assertProseOnly, workflowInputs } from "../resources/workflowLibrary.js";
import { PiSessionService } from "../sessions/piSessionService.js";
import { createPiSessionManagerGateway } from "../sessions/piSessionManagerGateway.js";
import { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { RegisteredProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import { WorkspaceService } from "../workspaces/workspaceService.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";
import { TriggerService } from "./triggerService.js";
import { workflowTriggerFire } from "./triggerFire.js";

const root = process.argv[2];
const checkpoint = process.argv[3];
if (root === undefined) throw new Error("Temporary root is required");
const cwd = join(root, "workspace");
const agentDir = join(root, "agent");
const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
const provider = fauxProvider();
models.registerNativeProvider(provider.provider);
provider.setResponses(Array.from({ length: 30 }, () => (transcript) => {
  const launch = transcript.messages.find((message) => message.role === "user" && JSON.stringify(message.content).includes("Workflow run "));
  const runId = /Workflow run ([a-f0-9]+)/u.exec(JSON.stringify(launch?.content))?.[1];
  if (runId !== undefined && !transcript.messages.some((message) => message.role === "toolResult")) return fauxAssistantMessage([fauxToolCall("workflow_stop", { runId, stage: "land", summary: "Review this night" })], { stopReason: "toolUse" });
  return fauxAssistantMessage("Waiting at land");
}));
const archive = new SessionArchiveStore(join(root, "archive.json"));
await archive.initialize();
const sessions = new PiSessionService(new SessionEventHub(), { agentDir, modelRuntime: models, archiveStore: archive,
  durableChildAgents: createDurableChildHost({ index: new LiveChildSessionIndex(join(root, "children.json")), runRecords: new ChildRunStore(join(root, "child-runs.json")) }),
  sessionManager: createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }),
});
const library = new WorkflowLibrary(agentDir);
const projects = new ProjectService(new ProjectStore(join(root, "projects.json")));
const workspaces = new RegisteredProjectWorkspaceCwds({ projects, workspaces: new WorkspaceService() });
const triggers = await TriggerService.open({ env: { PI_WEB_DATA_DIR: root }, workflows: library, workspaces,
  fire: workflowTriggerFire({ sessions,
    requireWorkspace: async (value) => { if (await workspaces.forCwd(value) === undefined) throw new Error("Unregistered workspace"); },
    validateAction: async (action) => { const workflow = await library.read(action.cwd, action.workflow); assertProseOnly(workflow); workflowInputs(workflow.definition, action.inputs); },
    afterStep: async (step) => {
      if (step !== checkpoint) return;
      process.stdout.write(`CHECKPOINT ${step}\n`);
      await new Promise<never>(() => undefined);
    },
  }), publish: () => undefined, onError: (error) => { throw error; },
});
try {
  if ((await triggers.list()).triggers.length === 0) {
    await triggers.create({ id: "night", name: "Nightly refinement", schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, action: { kind: "workflow", cwd, workflow: "nightly", inputs: {} } });
    await triggers.pause("night");
    await triggers.run("night", { requestId: "restart" });
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    const trigger = await triggers.get("night");
    const fire = trigger.history[0];
    if (fire?.outcome.kind === "failed") throw new Error(fire.outcome.error);
    if (fire?.outcome.kind === "started") {
      const ref = { id: fire.outcome.sessionId, cwd };
      const runs = await sessions.workflowRuns(ref);
      if (runs[0]?.stops?.["land"]?.state === "waiting" && !(await sessions.status(ref)).isStreaming) {
        process.stdout.write(`RESULT ${JSON.stringify({ sessionId: ref.id, history: trigger.history.length, runs: runs.length, land: "waiting", name: (await sessions.list(cwd)).find((session) => session.id === ref.id)?.name })}\n`);
        break;
      }
    }
    if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(trigger)}`);
    await sleep(20);
  }
} finally { await triggers.close(); await sessions.dispose(); }
