import { CircleAlertIcon, CircleHelpIcon, CirclePauseIcon, HourglassIcon, RotateCcwIcon, TimerResetIcon } from "lucide-react";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Consequence } from "../../ui/Consequence";
import { LaneGrid, type LaneGroup } from "../../ui/LaneGrid";
import { meterBlock } from "./AccountMeters";
import type { RedeemOutcome } from "./redeemReset";
import type { ResetPreview } from "./resetModel";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function joined(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/**
 * Shape: asks before spending one banked reset. The account's refilled bars
 * now and after use the meters' own rules, so a Claude refill with a day left
 * shows the surplus it cannot spend in time. The consequence for the reset
 * date is said in words, because it is the part that differs by provider.
 *
 * `busy` while the router is asked. `problem` is the last answer that was not
 * a spend: a refusal, or an answer no one can read. After an uncertain one,
 * pressing again asks about the same request and spends nothing more.
 */
export function ResetDialog({ preview, busy = false, problem, onUse, onCancel }: {
  preview: ResetPreview; busy?: boolean; problem?: Exclude<RedeemOutcome, { kind: "spent" }> | undefined; onUse: () => void; onCancel: () => void;
}) {
  const groups: LaneGroup[] = [
    { key: "now", name: "Now", blocks: [meterBlock(preview.before, preview.provider, 0)] },
    { key: "after", name: "After", blocks: [meterBlock(preview.after, preview.provider, 1)] },
  ];
  const horizon = preview.horizon;
  const windowName = horizon?.name.toLowerCase() ?? "usage";
  const uncertain = problem?.kind === "uncertain";
  return <ConfirmDialog title={`Use a ${preview.provider} reset?`} icon={<RotateCcwIcon size={16} />} tone="plain"
    confirmLabel={uncertain ? "Check again" : "Use reset"} busyLabel={uncertain ? "Checking…" : "Using reset…"}
    busy={busy} held={preview.hold !== undefined && !uncertain} onConfirm={onUse} onCancel={onCancel}>
    <p><strong>{preview.email}</strong> has {plural(preview.count, "1 reset", `${String(preview.count)} resets`)}.{" "}
      {preview.count === 1 ? `It expires on ${preview.expires}.` : `This uses the one that expires first, on ${preview.expires}.`}</p>
    <LaneGrid groups={groups} captions={false} flush />
    {preview.restarts
      ? <Consequence icon={<TimerResetIcon />}><p>Usage goes back to full, and the {windowName} window starts over now.
        {horizon ? <> The next reset moves from <strong>{horizon.resetsNow}</strong> to <strong>{horizon.resetsAfter}</strong>, a full{" "}
          {horizon.leftAfter} from now.</> : null}</p></Consequence>
      : <Consequence tone="warn" icon={<HourglassIcon />}><p>Usage goes back to full, but the {windowName} reset does not move.
        {horizon ? <> It stays at <strong>{horizon.resetsNow}</strong>, so you have <strong>{horizon.leftAfter}</strong> to use the refill.
          What you do not use by then is lost.</> : null}</p></Consequence>}
    {preview.later.length > 0
      ? <p>{plural(preview.later.length, "1 more stays", `${String(preview.later.length)} more stay`)} banked, expiring {joined(preview.later)}.</p> : null}
    {preview.hold && !problem ? <Consequence icon={<CirclePauseIcon />}><p>{preview.hold}</p></Consequence> : null}
    {problem?.kind === "refused" ? <Consequence tone="warn" icon={<CircleAlertIcon />}><p>{problem.message} Nothing was spent.</p></Consequence> : null}
    {uncertain ? <Consequence tone="warn" icon={<CircleHelpIcon />}><p>{problem.message} The reset may or may not be spent.{" "}
      <strong>Check again</strong> asks about this same request and never spends a second reset.</p></Consequence> : null}
  </ConfirmDialog>;
}
