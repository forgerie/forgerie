import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager, createAgentSessionServices, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";

const directories: string[] = [];
const sessions: DurableAgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** A real Durable session whose faux model streams slowly enough for Durable to coalesce several tokens per commit. */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-stream-"));
  directories.push(directory);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "stream-1", reasoning: true }], tokensPerSecond: 40 });
  modelRuntime.registerNativeProvider(provider.provider);
  const model = modelRuntime.getModel("faux", "stream-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false } });
  const session = await DurableAgentSession.open({ services, sessionManager: SessionManager.create(directory, join(directory, "sessions")), initialModel: model });
  sessions.push(session);
  const events: AgentSessionEvent[] = [];
  const settled = new Promise<void>((resolve) => {
    session.subscribe((event) => {
      if (!isSdkEvent(event)) return;
      events.push(event);
      if (event.type === "agent_settled") resolve();
    });
  });
  return { provider, session, events, settled };
}

/** The session publishes SDK-shaped events; this test reads them as the SDK declares them. */
function isSdkEvent(event: unknown): event is AgentSessionEvent {
  return typeof event === "object" && event !== null && "type" in event && typeof event.type === "string";
}

type Shown = { index: number; text: string }[];
/**
 * What a reader that follows only deltas, such as the browser, shows after
 * each update: it appends a delta to the newest block of the same kind, or
 * opens a new block.
 */
function shownAfterEachUpdate(events: readonly AgentSessionEvent[]): Shown[] {
  const blocks: Shown = [];
  const shown: Shown[] = [];
  for (const event of events) {
    if (event.type !== "message_update") continue;
    const change = event.assistantMessageEvent;
    if (change.type !== "text_delta" && change.type !== "thinking_delta") continue;
    const last = blocks.at(-1);
    if (last?.index === change.contentIndex) last.text += change.delta;
    else blocks.push({ index: change.contentIndex, text: change.delta });
    shown.push(blocks.map((block) => ({ ...block })));
  }
  return shown;
}

describe("Durable streamed text", () => {
  it("streams the opening words of the reply after its reasoning, in block order", async () => {
    const { provider, session, events, settled } = await fixture();
    const thinking = "Thinking about the summary of this session first.";
    const answer = "**Landed.** The fix shipped as `0b9f7039..57105685`, and was deployed. I then deleted the stray file.";
    provider.setResponses([fauxAssistantMessage([fauxThinking(thinking), fauxText(answer)])]);
    await session.prompt("summarize");
    await settled;
    const shown = shownAfterEachUpdate(events);
    expect(shown.length).toBeGreaterThan(2);
    // The last commit reaches readers as message_end, so the deltas end before the reply does.
    const last = shown.at(-1);
    expect(last?.[0]?.text).toBe(thinking);
    expect(last?.[1]?.text.length).toBeGreaterThan("**Landed.** ".length);
    // Every intermediate state is a prefix of the final one: no word is missing and no block splits.
    for (const step of shown) {
      expect(step.map((block) => block.index)).toEqual([0, 1].slice(0, step.length));
      expect(thinking.startsWith(step[0]?.text ?? "")).toBe(true);
      expect(answer.startsWith(step[1]?.text ?? "")).toBe(true);
    }
  });

  it("streams the opening words of a reply without reasoning", async () => {
    const { provider, session, events, settled } = await fixture();
    const answer = "Yes. The first words of this reply must reach the browser before the rest of it does.";
    provider.setResponses([fauxAssistantMessage(answer)]);
    await session.prompt("answer");
    await settled;
    const shown = shownAfterEachUpdate(events);
    expect(shown.length).toBeGreaterThan(1);
    for (const step of shown) {
      expect(step).toHaveLength(1);
      expect(answer.startsWith(step[0]?.text ?? "")).toBe(true);
    }
    expect(shown[0]?.[0]?.text).toMatch(/^Yes/);
  });
});
