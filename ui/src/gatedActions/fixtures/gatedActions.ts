import type { GatedAction, GatedEntry } from "../gatedActionsModel";

/** The fixtures' clock. */
export const GATED_NOW = 1791502400000;
const MIN = 60_000;

export const PUSH_ENTRY: GatedEntry = {
  id: "g-1", by: "build", tool: "bash", category: "force-push",
  description: "Force-push feat/run-export to origin",
  preview: "git push --force-with-lease origin feat/run-export",
};
export const PUSH: GatedAction = {
  id: "g-1", conversationId: "c-build", by: "build", tool: "bash", args: { command: "git push --force-with-lease origin feat/run-export" },
  category: "force-push", description: PUSH_ENTRY.description, requestedAt: GATED_NOW - 2 * MIN, state: { kind: "waiting" },
};
export const PUSH_RUNNING: GatedAction = { ...PUSH, state: { kind: "approved" } };
export const PUSH_RAN: GatedAction = {
  ...PUSH, state: {
    kind: "ran", at: GATED_NOW - MIN,
    result: [
      "Enumerating objects: 23, done.",
      "Counting objects: 100% (23/23), done.",
      "Delta compression using up to 16 threads",
      "Compressing objects: 100% (12/12), done.",
      "Writing objects: 100% (13/13), 4.18 KiB | 4.18 MiB/s, done.",
      "Total 13 (delta 9), reused 0 (delta 0), pack-reused 0",
      "remote: Resolving deltas: 100% (9/9), completed with 8 local objects.",
      "To github.com:simonwjackson/forgerie.git",
      " + 3f9c2e1...8a7b6d4 feat/run-export -> feat/run-export (forced update)",
    ].join("\n"),
  },
};
export const PUSH_FAILED: GatedAction = {
  ...PUSH, state: {
    kind: "failed", at: GATED_NOW - MIN,
    error: [
      "! [rejected]        feat/run-export -> feat/run-export (stale info)",
      "error: failed to push some refs to 'github.com:simonwjackson/forgerie.git'",
      "hint: The remote branch moved since you last fetched it. Fetch, check the new commits, and push again.",
    ].join("\n"),
  },
};
export const PUSH_REFUSED: GatedAction = { ...PUSH, state: { kind: "refused", at: GATED_NOW - MIN } };

/** A shell call long enough to wrap several times, with the part that matters at its end. */
export const RESET_ENTRY: GatedEntry = {
  id: "g-2", by: "parent", tool: "bash", category: "destroy-local",
  description: "Discard uncommitted changes in the export worktree",
  preview: "git -C /home/simon/code/forgerie/.worktrees/run-export stash list && git -C /home/simon/code/forgerie/.worktrees/run-export reset --hard origin/main && git -C /home/simon/code/forgerie/.worktrees/run-export clean -fdx",
};
export const RESET: GatedAction = {
  id: "g-2", conversationId: "c-parent", by: "parent", tool: "bash", args: { command: RESET_ENTRY.preview },
  category: "destroy-local", description: RESET_ENTRY.description, requestedAt: GATED_NOW - 6 * MIN, state: { kind: "waiting" },
};

/** A call that is not a shell command: the preview is a short form, and every argument is one step away. */
export const REPLY_ENTRY: GatedEntry = {
  id: "g-3", by: "listings", tool: "ebay_message_reply", category: "messages",
  description: "Reply to a buyer's question about the Fold 8 listing",
  preview: "ebay_message_reply to j.okafor: “Yes, it ships in the original box with the charger…”",
};
export const REPLY: GatedAction = {
  id: "g-3", conversationId: "c-listings", by: "listings", tool: "ebay_message_reply",
  args: {
    messageId: "msg-88231", recipient: "j.okafor",
    text: "Yes, it ships in the original box with the charger and the S Pen. The screen protector is the factory one, and there is a small mark on the hinge, shown in photo 6.",
  },
  category: "messages", description: REPLY_ENTRY.description, requestedAt: GATED_NOW - 9 * MIN, state: { kind: "waiting" },
};
