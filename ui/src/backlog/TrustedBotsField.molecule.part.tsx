import { useState } from "react";
import { TrustedBotsField } from "./TrustedBotsField";
import { trustedBotProblems, TRUSTED_BOT_LIMIT } from "./backlogSettingsModel";

export const name = "TrustedBotsField";
export const note = "The bot logins a GitHub backlog trusts while it lists only trusted authors: one box per bot, each with its Remove";
export const composition = { default: [{ part: "src/ui/ValueList.molecule.part.tsx", state: "default" }] };

function Stateful({ rows, disabled = false }: { rows: string[]; disabled?: boolean }) {
  const [bots, setBots] = useState(rows);
  return <TrustedBotsField bots={bots} problems={trustedBotProblems(bots)} limit={TRUSTED_BOT_LIMIT} disabled={disabled} onChange={setBots} />;
}
const listed = ["coderabbitai[bot]", "sourcery-ai[bot]", "copilot-pull-request-reviewer[bot]"];
export default function Empty() { return <Stateful rows={[]} />; }
export function Listed() { return <Stateful rows={listed} />; }
export function Problems() { return <Stateful rows={["coderabbitai[bot]", "coderabbit", "CodeRabbitAI[bot]", ""]} />; }
/** At the limit, Add bot is off and the hint says why. */
export function Full() { return <Stateful rows={Array.from({ length: TRUSTED_BOT_LIMIT }, (_, index) => `review-helper-${String(index + 1)}[bot]`)} />; }
export function Saving() { return <Stateful rows={listed} disabled />; }
