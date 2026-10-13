import { LoadingLines } from "./LoadingLines";

export const name = "Loading lines";
export const note = "A first read in progress: pulsing bars and what is being read";

export default function Reading() {
  return <LoadingLines label="Reading triggers…" />;
}
