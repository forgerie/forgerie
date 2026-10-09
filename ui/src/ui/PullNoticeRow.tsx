import { useState } from "react";
import { MessagePrimitive } from "@assistant-ui/react";
import { GitMergeIcon, GitPullRequestIcon } from "lucide-react";
import { noticeSentence, type PullNotice } from "../pullRequests/pullNotice";
import "./pullRequest.css";

/**
 * A pull request event in the thread: one line, like the history summary,
 * because it reports something that happened rather than a reply. The full
 * text the agent read opens below it on request.
 */
export function PullNoticeRow({ notice }: { notice: PullNotice }) {
  const [open, setOpen] = useState(false);
  const Icon = notice.kind === "merged" ? GitMergeIcon : GitPullRequestIcon;
  return <MessagePrimitive.Root className="message pr-notice-row" data-role="system" data-notice={notice.kind}>
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="pr-notice-line">
        <Icon aria-hidden size={15} className="pr-notice-icon" />
        <span>{noticeSentence(notice)}</span>
      </summary>
      {open && <pre className="pr-notice-text" tabIndex={0} aria-label="What the agent read">{notice.text}</pre>}
    </details>
  </MessagePrimitive.Root>;
}
