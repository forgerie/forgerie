import { FindBar } from "../ui/FindBar";
import { formatCount } from "./searchModel";
import type { MatchBarView } from "./found";

const OFF_BRANCH = "This match is on another branch.";

/**
 * Above the message box of a session opened from a search hit: which match
 * the thread shows, and the way to the previous and next ones. For an
 * off-branch hit it says why the history tree has not opened yet.
 */
export function MatchBar({ view, onStep, onRetry, onClose }: {
  view: MatchBarView;
  onStep: (delta: 1 | -1) => void; onRetry: () => void; onClose: () => void;
}) {
  const close = { label: "Close matches", onPress: onClose };
  const name = "Search matches";
  switch (view.type) {
    case "loading": return <FindBar name={name} label="Finding matches…" close={close} />;
    case "failed": return <FindBar name={name} label="Could not load the matches." detail={view.message}
      action={{ label: "Retry", onPress: onRetry }} close={close} />;
    case "treeFailed": return <FindBar name={name} label="Could not open the history tree." detail={view.message}
      action={{ label: "Retry", onPress: onRetry }} close={close} />;
    case "waiting": return <FindBar name={name} label={OFF_BRANCH} detail="The history tree opens when the session is idle." close={close} />;
    case "missing": return <FindBar name={name} label="This passage is no longer in the session."
      detail="The session changed after the search index read it." action={{ label: "Retry", onPress: onRetry }} close={close} />;
    case "ready": {
      const alone = view.total < 2;
      return <FindBar name={name} label={`Match ${formatCount(view.current + 1)} of ${formatCount(view.total)}`}
        detail={view.missing ? "This message is not in the loaded conversation." : undefined}
        previous={{ label: "Previous match", onPress: () => onStep(-1), disabled: alone }}
        next={{ label: "Next match", onPress: () => onStep(1), disabled: alone }} close={close} />;
    }
  }
}
