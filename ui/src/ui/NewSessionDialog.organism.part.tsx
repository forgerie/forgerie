import { useState } from "react";
import { NewSessionDialog } from "./NewSessionDialog";
import { FixtureRuntime } from "./fixtures/runtime";
import type { MentionSource } from "../mentionSource";
import type { ModelBinding } from "./ModelPicker";

export const name = "New session";
export const note = "Existing new-session controls with the ephemeral retention choice; no network reads";
const mentions: MentionSource = { key: "new-session-part", files: async () => [], models: async () => ({ groups: [], hidden: 0, thinking: {} }) };
const model: ModelBinding = { model: { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5" }, thinkingLevel: "high", disabled: false,
  listModels: async () => [], listThinkingLevels: async () => ["high"], onModel: async () => undefined, onThinkingLevel: async () => undefined };
function Scenario({ initial = false }: { initial?: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  return <FixtureRuntime draft="Check the deployment logs without keeping this chat.">
    <NewSessionDialog ephemeral={{ enabled, onToggle: () => setEnabled(value => !value) }}
      destination={<button type="button" className="ns-chip">forgerie</button>} model={model} mentions={mentions}
      commands={{ catalog: { type: "ready", commands: [] }, onRetry: () => {} }} rapidfire={false} phase={{ type: "ready" }}
      onRapidfire={() => {}} onDiscard={() => {}} onClose={() => {}} />
  </FixtureRuntime>;
}
export default function Persistent() { return <Scenario />; }
export function Ephemeral() { return <Scenario initial />; }
