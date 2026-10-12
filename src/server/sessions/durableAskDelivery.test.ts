import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { Check } from "typebox/value";
import { Type } from "typebox";
import { ParentAsks, Presentation, initializeParentDocuments } from "./durableParentDocuments.js";
import { askDeliveryExtension } from "./durableAskDelivery.js";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { renderAskUserAnswersText } from "./sessionAsks.js";

// A cold tsx subprocess opens SQLite and imports the runtime. The 5-second unit budget is not a subprocess budget.
it("delivers an accepted decision after SIGKILL between close and answer admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-answer-crash-"));
  const databasePath = join(directory, "state.sqlite");
  const moduleUrl = (name: string) => pathToFileURL(join(process.cwd(), "src/server/sessions", name)).href;
  const script = `
    import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
    import { createModels } from "@earendil-works/pi-ai/models";
    import { createRegistry, Harness } from "@earendil-works/pi-durable";
    import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
    import { initializeParentDocuments } from ${JSON.stringify(moduleUrl("durableParentDocuments.ts"))};
    import { createDurableParentState } from ${JSON.stringify(moduleUrl("durableParentState.ts"))};
    const harness = await Harness.open(await openNodeSqliteStorage(${JSON.stringify(databasePath)}), { models: createModels(), registry: createRegistry(), conversationCreated: initializeParentDocuments }, context);
    const conversation = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });
    const state = createDurableParentState({ harness, conversation, address: { journalId: "crash", databasePath: ${JSON.stringify(databasePath)}, sessionId: "logical", conversationId: conversation.id }, release: async () => {} }, { resolve: async () => { throw new Error("Not used"); } });
    const { ask } = await state.openAsk([{ id: "q", question: "Continue?", options: [] }], context);
    await state.submitAsk(ask.askId, { answers: [{ id: "q", values: [], otherText: "Continue" }] }, context);
    process.stdout.write(JSON.stringify({ askId: ask.askId }) + "\\n");
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
  let harness: Harness | undefined;
  try {
    const output = await Promise.race([once(child.stdout, "data"), exited.then(() => { throw new Error(`Crash fixture exited before accepting an answer: ${stderr}`); })]);
    const bytes: unknown = output[0];
    if (!Buffer.isBuffer(bytes)) throw new Error("Missing accepted answer receipt");
    const ready: unknown = JSON.parse(bytes.toString());
    if (!Check(Type.Object({ askId: Type.String() }), ready)) throw new Error("Invalid accepted answer receipt");
    child.kill("SIGKILL");
    await exited;
    const models = createModels();
    const provider = fauxProvider();
    models.setProvider(provider.provider);
    const registry = createRegistry();
    registry.install(askDeliveryExtension());
    harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry, conversationCreated: initializeParentDocuments }, context);
    const conversation = await harness.root(context);
    expect((await harness.snapshot(ParentAsks, conversation.id, context))?.closed[ready.askId]).toMatchObject({ outcome: { answeredCount: 1 }, delivery: { kind: "pending" } });
    const delivery = (await harness.inspect(context)).tasks.find(task => task.record.kind === "forgerie.parent-ask-delivery");
    if (delivery === undefined) throw new Error("Missing durable answer task after crash");
    await harness.waitForTask(delivery.record.id, context);
    await conversation.waitForIdle(context);
    const receipt = (await harness.snapshot(ParentAsks, conversation.id, context))?.closed[ready.askId];
    expect(receipt?.delivery.kind).toBe("admitted");
    expect(provider.state.callCount).toBe(1);
    const inputs = (await conversation.entries({}, 100, undefined, context)).items.filter(entry => entry.kind === "pi.user");
    expect(inputs).toHaveLength(1);
    const entry = inputs[0];
    const model = entry?.model?.[0];
    if (receipt === undefined || entry === undefined || model?.role !== "user") throw new Error("Missing delivered input");
    expect(entry.model).toEqual(convertToLlm([{ role: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
      content: renderAskUserAnswersText(receipt.outcome), display: true, details: receipt.outcome, timestamp: model.timestamp }]));
    expect(await harness.snapshot(Presentation, conversation.id, String(entry.id), context)).toMatchObject({ envelope: { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, details: receipt.outcome } });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await harness?.close(context);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
