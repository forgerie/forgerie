import { useState } from "react";
import { SuggestionModelField } from "./SuggestionModelField";
import type { SuggestionModel } from "./suggestionsApi";
import { MODELS } from "./fixtures/suggestions";

export const name = "Backlog suggestion model field";
export const note = "The model a suggestion's File and act starts on: a global default, a project override, else the chat's model";

function Field({ initial, fallback, hint }: { initial: SuggestionModel | undefined; fallback: string; hint: string }) {
  const [value, setValue] = useState(initial);
  return <SuggestionModelField label="Background model" value={value} fallback={fallback} hint={hint} knownModels={MODELS} listModels={async () => MODELS} onChange={setValue} />;
}
export default function Unset() {
  return <Field initial={undefined} fallback="The chat's model" hint="File and act starts its background session on this model. Unset, the session uses the model of the chat it came from." />;
}
export function Chosen() {
  return <Field initial={{ modelSpec: "anthropic/claude-haiku-4-5", thinkingLevel: "low" }} fallback="The chat's model"
    hint="File and act starts its background session on this model. Unset, the session uses the model of the chat it came from." />;
}
export function ProjectUnset() {
  return <Field initial={undefined} fallback="The global default, Claude Haiku 4.5" hint="This project's suggestions start on this model. Unset, they use the global default." />;
}
