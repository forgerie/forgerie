// Dev-only, network-free preview of model chains in a session and in another picker: the real thread, composer,
// model picker, wait line, and switch line, on fixtures. ?scenario= chain | wait | running | long | trigger. Nothing reaches Pi.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { SessionModel } from "../src/contracts";
import type { TranscriptMessage } from "../src/transcript";
import { useThreadMessages } from "../src/useThreadMessages";
import { Thread } from "../src/ui/Thread";
import { SessionFrame } from "../src/ui/SessionFrame";
import type { SystemArtifactView } from "../src/ui/Messages";
import type { ModelBinding } from "../src/ui/ModelPicker";
import { ModelPrefsContext } from "../src/models/modelPrefsApi";
import { chainPrefs, chainPrefsSource } from "../src/models/fixtures/chainPrefs";
import { CHAINS, LONG_NAME, MODELS } from "../src/models/fixtures/chains";
import { ChainSwitchLine } from "../src/models/ChainSwitchLine";
import { ChainWaitStatus } from "../src/models/ChainWaitStatus";
import { TriggerForm } from "../src/triggers/TriggerForm";
import { draftOf, type TriggerDraft } from "../src/triggers/triggerDraft";
import { HOST_ZONE, nightly } from "../src/triggers/fixtures/triggers";
import { draftScenario, folders, projectLabel, ZONES } from "../src/triggers/fixtures/scenario";
import "../src/ui/theme.css";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "chain";
const NOW = Date.UTC(2026, 9, 28, 14, 0, 0);
const LONG_MODEL: SessionModel = { provider: "nightly-provider", id: "regression-triage-with-the-cheapest-model-that-still-reads-diffs",
  name: "Regression triage with the cheapest model that still reads diffs (preview)", reasoning: true };
const models = scenario === "long" ? [...MODELS, LONG_MODEL] : MODELS;
const chains = scenario === "long" ? { ...CHAINS, [LONG_NAME]: ["nightly-provider/regression-triage-with-the-cheapest-model-that-still-reads-diffs", "openai/gpt-5"] } : CHAINS;
const source = chainPrefsSource(chainPrefs(chains));

const say = (id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage => ({ id, role, parts: [{ type: "text", text }] });
const messages: TranscriptMessage[] = [
  say("u1", "user", "Port the settings page to the shared store. Keep every setting's behaviour."),
  say("a1", "assistant", "I'll read the page and its API first, then move one setting at a time, with a test for each."),
  { id: "n1", role: "system", parts: [{ type: "text", text: "Switched." }],
    chainSwitch: { from: "anthropic/claude-opus-5-5:high", to: "openai/gpt-5", error: "429 Too Many Requests: rate limit reached for claude-opus-5-5 in organization org-7Kq. Try again in 58s." } },
  say("a2", "assistant", "Picking up where the last model stopped: the theme setting reads from the store now. Next is the language setting."),
];

function Session() {
  const chain = scenario === "long" ? LONG_NAME : "worker";
  const active = scenario === "long" ? LONG_MODEL : MODELS[2];
  const [state, setState] = useState<{ chain: string | undefined; model: SessionModel | undefined }>({ chain, model: active });
  const running = scenario === "running";
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages(messages, running), isRunning: running, onNew: async () => {}, onCancel: async () => {} });
  const artifact = useMemo<SystemArtifactView>(() => (custom) => {
    const notice = (custom as { chainSwitch?: TranscriptMessage["chainSwitch"] } | undefined)?.chainSwitch;
    return notice ? <ChainSwitchLine notice={notice} models={models} /> : undefined;
  }, []);
  const binding: ModelBinding = {
    model: state.model, thinkingLevel: "high", disabled: false, cycle: true,
    listModels: async () => models, listThinkingLevels: async () => ["off", "low", "medium", "high"],
    onModel: async (provider, id) => setState({ chain: undefined, model: models.find((item) => item.provider === provider && item.id === id) }),
    onThinkingLevel: async () => {},
    chain: { current: state.chain, onChoose: async (name) => setState({ chain: name, model: undefined }) },
    context: { type: "known", percent: 38, high: false },
  };
  const waiting = scenario === "wait" || scenario === "running" || scenario === "long";
  const wait = { from: scenario === "long" ? "nightly-provider/regression-triage-with-the-cheapest-model-that-still-reads-diffs" : "anthropic/claude-opus-5-5:high",
    error: "429 Too Many Requests: rate limit reached. Try again in 42s.", until: NOW + 42_000 };
  return <AssistantRuntimeProvider runtime={runtime}>
    <SessionFrame name="Settings on the shared store">
      <Thread systemArtifact={artifact} model={binding} shell={{ availability: { type: "ready" }, onRun: async () => {} }}
        beforeComposer={waiting ? <ChainWaitStatus wait={wait} next="openai/gpt-5" models={models} now={NOW} onStop={running ? undefined : () => {}} /> : undefined} />
    </SessionFrame>
  </AssistantRuntimeProvider>;
}

function Trigger() {
  const [draft, setDraft] = useState<TriggerDraft>({ ...draftOf(nightly), model: "worker", thinkingLevel: "medium" });
  const { workflows } = draftScenario(draft);
  return <SessionFrame name="Nightly backlog refinement">
    <TriggerForm draft={draft} onDraft={setDraft} problems={{}} disabled={false} hostZone={HOST_ZONE}
      timezones={ZONES} projectName={projectLabel} projects={folders} workflows={workflows} listModels={async () => models} locale="en-US" />
  </SessionFrame>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root");
createRoot(root).render(<ModelPrefsContext.Provider value={source}>{scenario === "trigger" ? <Trigger /> : <Session />}</ModelPrefsContext.Provider>);
