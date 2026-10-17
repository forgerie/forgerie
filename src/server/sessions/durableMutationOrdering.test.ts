import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineExtension, wrapTool } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { expect, it } from "vitest";
import { durableChildExtensions } from "./durableChildAgents.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";

it.each(["write", "edit"] as const)("orders delayed native child %s before bash in the same round", async name => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-child-order-"));
  let journal: DurableSessionJournal | undefined;
  try {
    if (name === "edit") await writeFile(join(directory, "ordered.sh"), "#!/bin/sh\nprintf initial");
    const models = createModels();
    const provider = fauxProvider(); models.setProvider(provider.provider);
    const native = durableChildExtensions().childOnly.find(extension => extension.name === "forgerie.child-tools");
    const mutation = native?.tools?.find(tool => tool.name === name);
    if (native === undefined || mutation === undefined) throw new Error("Missing native child tools");
    const delayed = defineExtension({ name: "test.delayed-mutation", wraps: [wrapTool(mutation, tool => ({ ...tool,
      execute: async (args, api, ctx) => { await delay(150); return tool.execute(args, api, ctx); },
    }))] });
    const registry = createRegistry(); registry.install(native); registry.install(delayed);
    journal = await DurableSessionJournal.open({ manager: SessionManager.create(directory, join(directory, "sessions")), models, registry,
      agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [native, delayed], tools: native.tools ?? [] }, env: () => new NodeExecutionEnv({ cwd: directory }) });
    provider.setResponses([fauxAssistantMessage([
      fauxToolCall(name, name === "write" ? { path: "ordered.sh", content: "#!/bin/sh\nprintf ordered" } : { path: "ordered.sh", oldText: "initial", newText: "ordered" }),
      fauxToolCall("bash", { command: "chmod +x ordered.sh && ./ordered.sh" }, { id: "run-written" }),
    ], { stopReason: "toolUse" }), fauxAssistantMessage("Done.")]);
    await journal.conversation.submit({ type: "input", content: "Write then execute." }, context);
    await journal.conversation.waitForIdle(context);
    const entries = await journal.conversation.entries({ order: "ascending" }, 100, undefined, context);
    const result = entries.items.flatMap(entry => entry.model ?? []).find(message => message.role === "toolResult" && message.toolCallId === "run-written");
    expect(result).toMatchObject({ isError: false });
    expect(JSON.stringify(result)).toContain("ordered");
    expect(JSON.stringify(result)).not.toContain("initial");
  } finally { await journal?.close(); await rm(directory, { recursive: true, force: true }); }
});
