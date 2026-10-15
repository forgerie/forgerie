import { SettingsField } from "../ui/settings/SettingsField";
import { ValueList } from "../ui/ValueList";

/**
 * Shape: the bot logins a GitHub backlog trusts while it lists only trusted authors. Text from a listed bot reaches
 * the agent; other outside authors stay hidden. One box per bot, each with a Remove named for it.
 */
export function TrustedBotsField({ bots, problems, limit, disabled, onChange }: {
  /** The draft, one entry per box as typed. A blank box is one the reader has not filled yet. */
  bots: readonly string[];
  /** One entry per box: its problem, or undefined. */
  problems: readonly (string | undefined)[];
  /** The most bots one project lists. Add bot turns off at this count, and the hint says why. */
  limit: number;
  disabled: boolean;
  onChange: (bots: string[]) => void;
}) {
  const full = bots.length >= limit;
  return <SettingsField label="Trusted bots" hintTone="readable" hint={bots.length === 0 ? undefined
    : `Text from these bots reaches the agent. Other outside authors stay hidden.${full ? ` A project lists at most ${String(limit)} bots.` : ""}`}>
    <ValueList values={bots} problems={problems} limit={limit} disabled={disabled} onChange={onChange} placeholder="name[bot]"
      itemLabel={(index) => `Trusted bot ${String(index + 1)}`} removeLabel={(login) => `Remove ${login || "blank row"}`} addLabel="Add bot"
      empty="No bots listed. Their comments reach the agent as hidden text." />
  </SettingsField>;
}
