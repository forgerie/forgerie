import { Afterword } from "../ui/Afterword";
import type { RecapRequestState } from "./recapModel";

export function RecapRequest({ state }: { state: RecapRequestState }) {
  if (state.kind === "idle") return null;
  return <Afterword kind={state.kind === "writing" ? "working" : "failed"}
    message={state.kind === "writing" ? "Writing a recap of the last 8 messages…" : state.message} />;
}
