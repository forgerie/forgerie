import { useMemo, useState } from "react";
import { createPullRequestApi, type PullLink } from "../pullRequests/pullRequestApi";
import { useSessionPulls } from "../pullRequests/useSessionPull";
import { PullRequestReview } from "../ui/PullRequestReview";
import type { Fetch } from "../newSession";
export function RelatedPulls({ request, target, links, onClose, onAsk }: {
  request: Fetch; target: { id: string; cwd: string }; links: readonly PullLink[]; onClose: () => void; onAsk: (text: string) => void;
}) {
  const api = useMemo(() => createPullRequestApi(request), [request]);
  const catalog = useMemo(() => links.filter((link) => link.session.cwd === target.cwd), [links, target.cwd]);
  const pull = useSessionPulls(api, target, catalog);
  const [selected, setSelected] = useState<number>();
  return <PullRequestReview load={pull.load} selected={selected} onSelect={setSelected} reading={pull.reading} notice={pull.notice} writing={pull.writing} now={Date.now()}
    onRefresh={pull.refresh} onWatch={(number, enabled) => { void pull.setWatch(number, enabled); }} onLink={pull.linkNumber}
    onUnlink={(number) => { void pull.unlink(number); }} onMerge={(number) => { void pull.merge(number, "rebase"); }} onClose={onClose} onAsk={onAsk} />;
}
