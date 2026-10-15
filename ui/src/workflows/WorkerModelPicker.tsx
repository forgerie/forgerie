import { useRef, useState } from "react";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../ui/ModelPicker";
import { TextButton } from "../ui/TextButton";
import { thinkingLevelsFor } from "../newSession";
import type { SessionModel } from "../contracts";
import { modelName, modelOf, modelText, parseModel } from "./workflowRoute";

/** What a worker without a model runs on: its agent file's model, else the session's. */
export function defaultModelLabel(agent: string | undefined): string {
  return agent === undefined ? "Session's model" : `${agent}'s model`;
}

/** The session's models, for a worker's picker: the list as last read (for names), and a read for the picker to make. */
export interface WorkerModels {
  known: readonly SessionModel[];
  list: (signal: AbortSignal) => Promise<SessionModel[]>;
}

/**
 * Shape: one worker's model, in the composer's picker with the session's list. Without a model, the worker runs on
 * its agent file's model, else the session's. A model that differs from `reset.to` offers a way back to it.
 * `onChange` may reject: the picker then stays open and says why.
 */
export function WorkerModelPicker({ worker, agent, model, reset, models, disabled = false, onChange }: {
  worker: string;
  /** The agent file the worker runs as. Without a model, the worker runs on that file's model. */
  agent?: string | undefined;
  model: string | undefined;
  /** Where the way back leads, such as the model the agent proposed (undefined: the session's), and its words. */
  reset?: { to: string | undefined; label: string } | undefined;
  models: WorkerModels;
  disabled?: boolean;
  onChange: (model: string | undefined) => void | Promise<void>;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<PickerOpen>();
  const spec = parseModel(model);
  const current = modelOf(model, models.known);
  const binding: ModelBinding = {
    model: current, thinkingLevel: spec?.level, disabled, emptyLabel: defaultModelLabel(agent),
    listModels: models.list, listThinkingLevels: async () => thinkingLevelsFor(current),
    onModel: async (provider, id) => { await onChange(modelText({ provider, id, level: spec?.level })); },
    onThinkingLevel: async (level) => { if (spec !== undefined) await onChange(modelText({ ...spec, level })); },
    thinking: current !== undefined,
  };
  const edited = reset !== undefined && model !== reset.to;
  return <>
    <span ref={anchor} aria-label={`${worker}'s model`} role="group">
      <ModelPicker binding={binding} anchor={anchor} open={open} onOpenChange={setOpen} minWidthRem={18} />
    </span>
    {edited && !disabled && <TextButton label={reset.label} title={`Back to ${reset.to === undefined ? defaultModelLabel(agent) : modelName(reset.to, models.known)}`}
      onPress={() => { void Promise.resolve(onChange(reset.to)).catch(() => undefined); }} />}
  </>;
}
