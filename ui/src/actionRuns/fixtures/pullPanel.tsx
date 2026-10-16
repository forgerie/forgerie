/**
 * The session's pull request panel around the Actions views, for parts that
 * show them in place. Every pull request handler works on local state: tabs
 * select, Watch flips, Unlink removes the pull request, Merge, Ask, and Read
 * again report what they would do, and Close closes the panel until the
 * reader opens it again. Nothing calls GitHub.
 */
import { useState, type ReactNode } from "react";
import type { PullItem } from "../../pullRequests/pullRequestApi";
import { PullRequestReview } from "../../ui/PullRequestReview";
import { fixtureNow } from "./actionRuns";
import { pullItem } from "./pull";

const AT = "2026-10-15T12:00:00.000Z";

export function PullPanel({ actions, below, first = false }: { actions: ReactNode; below?: ((number: number) => ReactNode) | undefined; first?: boolean }) {
  const [items, setItems] = useState<PullItem[]>([pullItem]);
  const [selected, setSelected] = useState<number>();
  const [notice, setNotice] = useState<{ tone: "error" | "done"; text: string }>();
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Open the pull request panel</button>;
  return <PullRequestReview load={{ type: "ready", items }} selected={selected} onSelect={setSelected} reading={new Set()} notice={notice} writing={false} now={fixtureNow}
    onRefresh={() => setNotice({ tone: "done", text: "Read the pull request again." })}
    onAsk={(message) => setNotice({ tone: "done", text: `The message box now holds: ${message.split("\n")[0] ?? ""}` })}
    onWatch={(number, on) => setItems((current) => current.map((item) => item.link.number !== number ? item
      : { ...item, link: { ...item.link, watch: on ? { kind: "watching", since: AT, wakes: 0 } : { kind: "stopped", reason: "Stopped by you.", at: AT } } }))}
    onLink={async (number) => { setNotice({ tone: "error", text: `This preview has no pull request #${String(number)}.` }); return false; }}
    onUnlink={(number) => setItems((current) => current.filter((item) => item.link.number !== number))}
    onMerge={(number) => setNotice({ tone: "done", text: `Merged #${String(number)} (preview).` })}
    onClose={() => setOpen(false)}
    extraView={{ label: "Actions", title: "Workflow runs", tone: "failed", first, content: actions }} belowPull={below} />;
}
