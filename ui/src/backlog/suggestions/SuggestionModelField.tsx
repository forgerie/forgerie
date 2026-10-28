import { chainReferenceOf } from "../../modelChoice";
import { useRef, useState } from "react";
import type { SessionModel } from "../../contracts";
import { thinkingLevelsFor } from "../../newSession";
import { SettingsField } from "../../ui/settings/SettingsField";
import { ModelPicker, type PickerOpen } from "../../ui/ModelPicker";
import { TextButton } from "../../ui/TextButton";
import type { SuggestionModel } from "./suggestionsApi";
import { modelFromSpec, specOf } from "./suggestionsModel";

/** A model field's inputs as a settings page passes them. */
export interface SuggestionModelChoice {
  value: SuggestionModel | undefined; known: readonly SessionModel[]; list: (signal: AbortSignal) => Promise<SessionModel[]>;
  /** What an unset field means, in a few words for the trigger, such as "The global default". */
  fallback: string;
  /** The same, in full for the hint, such as "the global default, Claude Haiku 4.5". */
  fallbackDetail?: string | undefined;
  onChange: (value: SuggestionModel | undefined) => void;
}

/**
 * Shape: the model a backlog suggestion's File and act starts its background session on, in the composer's model
 * list. Unset, it falls back, and the trigger and the hint say to what: the global default, else the chat's model.
 */
export function SuggestionModelField({ label, value, fallback, hint, knownModels = [], listModels, disabled = false, onChange }: {
  label: string;
  value: SuggestionModel | undefined;
  /** What an unset field means, in the trigger's words, such as "The chat's model". */
  fallback: string;
  hint: string;
  knownModels?: readonly SessionModel[];
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  disabled?: boolean;
  onChange: (value: SuggestionModel | undefined) => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<PickerOpen>();
  const model = modelFromSpec(value?.modelSpec, knownModels);
  // A spec without a provider names a model chain.
  const chain = chainReferenceOf(value?.modelSpec)?.name;
  return <SettingsField label={label} hint={hint} hintTone="readable">
    <span ref={anchor}>
      <ModelPicker anchor={anchor} open={open} onOpenChange={setOpen} minWidthRem={18} binding={{
        model, thinkingLevel: value?.thinkingLevel, disabled, emptyLabel: fallback, thinking: model !== undefined || chain !== undefined, listModels,
        listThinkingLevels: async () => thinkingLevelsFor(model),
        onModel: async (provider, id) => { onChange({ modelSpec: `${provider}/${id}`, ...(value?.thinkingLevel ? { thinkingLevel: value.thinkingLevel } : {}) }); },
        onThinkingLevel: async (level) => { onChange({ modelSpec: chain ?? specOf(model), thinkingLevel: level }); },
        chain: { current: chain, onChoose: async (name) => { onChange({ modelSpec: name, ...(value?.thinkingLevel ? { thinkingLevel: value.thinkingLevel } : {}) }); } },
      }} />
    </span>
    {value?.modelSpec !== undefined && !disabled ? <TextButton label={`Use ${fallback.charAt(0).toLowerCase()}${fallback.slice(1)}`} onPress={() => onChange(undefined)} /> : null}
  </SettingsField>;
}
