import type { ReactNode } from "react";
import type { PullLink } from "../pullRequests/pullRequestApi";
export type RelatedWorkRenderer = (ref: { id: string; cwd: string }, busy: boolean, links: readonly PullLink[], onAsk: (text: string) => void) => ReactNode;
