import type { ReactNode } from "react";
import type { PullLink } from "../pullRequests/pullRequestApi";
import type { WorktreeCommand } from "../ui/WorktreeActions";
import type { WorktreeInfo } from "../worktrees/worktreeApi";
/** The chat's own active worktree and what its Land and Discard do. */
export interface OwnWorktree { info: WorktreeInfo; onCommand: (command: WorktreeCommand) => void }
/** Draws the chat's header menu, with its related worktrees after its own. */
export type RelatedWorkRenderer = (work: { ref: { id: string; cwd: string }; busy: boolean; links: readonly PullLink[]; onAsk: (text: string) => void; own?: OwnWorktree | undefined }) => ReactNode;
