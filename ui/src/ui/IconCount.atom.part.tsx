import { FlagIcon } from "lucide-react";
import { IconCount } from "./IconCount";

export const name = "Icon count";
export const note = "A quiet count beside a small icon, as a readout in a row";

export default function Flagged() {
  return <IconCount icon={<FlagIcon aria-hidden />} count={2} label="2 flagged decisions" />;
}
export function Many() {
  return <IconCount icon={<FlagIcon aria-hidden />} count={14} label="14 flagged decisions" />;
}
