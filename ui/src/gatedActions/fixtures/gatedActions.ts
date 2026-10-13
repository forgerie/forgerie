import type { GatedAction, GatedActionEntry } from "../gatedActionsModel";

/** The fixtures' clock. */
export const GATED_NOW = 1791502400000;
const MIN = 60_000;
/** Ids as the hook makes them: `g:<conversation>:<tool task>`. */
const PUSH_ID = "g:21:184";

export const PUSH_ENTRY: GatedActionEntry = {
  id: PUSH_ID, by: "child build", tool: "bash", category: "force-push",
  description: "Force-push feat/run-export to origin",
  command: "git push --force-with-lease origin feat/run-export",
};
export const PUSH: GatedAction = {
  id: PUSH_ID, conversationId: 21, by: "child build", tool: "bash", args: { command: "git push --force-with-lease origin feat/run-export" },
  category: "force-push", description: PUSH_ENTRY.description, requestedAt: GATED_NOW - 2 * MIN, state: { kind: "waiting" },
};
/** What the approve route answers: Forgerie runs it now, and the outcome comes on a later read. */
export const PUSH_RUNNING: GatedAction = { ...PUSH, state: { kind: "approved" } };
/** The tool's whole JSON result, as the server saves it. */
export const PUSH_RAN: GatedAction = {
  ...PUSH, state: {
    kind: "ran", at: GATED_NOW - MIN,
    result: {
      content: [{
        type: "text", text: [
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
      }],
      details: { exitCode: 0 }, diagnostics: [],
    },
  },
};
/** A tool that reported an error: the server saves its whole result as JSON in `error`. */
export const PUSH_FAILED: GatedAction = {
  ...PUSH, state: {
    kind: "failed", at: GATED_NOW - MIN,
    error: JSON.stringify({
      content: [{
        type: "text", text: [
          "! [rejected]        feat/run-export -> feat/run-export (stale info)",
          "error: failed to push some refs to 'github.com:simonwjackson/forgerie.git'",
          "hint: The remote branch moved since you last fetched it. Fetch, check the new commits, and push again.",
        ].join("\n"),
      }],
      isError: true, details: { exitCode: 1 }, diagnostics: [],
    }),
  },
};
/** Forgerie restarted after it committed to run the call: it may have run, and it never runs again. */
export const PUSH_UNKNOWN: GatedAction = {
  ...PUSH, state: {
    kind: "failed", at: GATED_NOW - MIN,
    error: "Unknown outcome: the approved action was interrupted and may have run. It will not be run again. Check its effects before requesting another action.",
  },
};
export const PUSH_REFUSED: GatedAction = { ...PUSH, state: { kind: "refused" } };

/** A shell call long enough to wrap several times, with the part that matters at its end. */
const RESET_COMMAND = "git -C /home/simon/code/forgerie/.worktrees/run-export stash list && git -C /home/simon/code/forgerie/.worktrees/run-export reset --hard origin/main && git -C /home/simon/code/forgerie/.worktrees/run-export clean -fdx";
export const RESET_ENTRY: GatedActionEntry = {
  id: "g:1:97", by: "parent", tool: "bash", category: "destroy-local",
  description: "Discard uncommitted changes in the export worktree", command: RESET_COMMAND,
};
export const RESET: GatedAction = {
  id: "g:1:97", conversationId: 1, by: "parent", tool: "bash", args: { command: RESET_COMMAND },
  category: "destroy-local", description: RESET_ENTRY.description, requestedAt: GATED_NOW - 6 * MIN, state: { kind: "waiting" },
};

/** A call that is not a shell command: the entry shows the tool and its arguments as JSON; the record holds them whole. */
const REPLY_ARGS = {
  messageId: "msg-88231", recipient: "j.okafor",
  text: "Yes, it ships in the original box with the charger and the S Pen. The screen protector is the factory one, and there is a small mark on the hinge, shown in photo 6.",
};
export const REPLY_ENTRY: GatedActionEntry = {
  id: "g:34:12", by: "child listings", tool: "ebay_seller_message_reply", category: "messages",
  description: "Reply to a buyer's question about the Fold 8 listing",
  command: `ebay_seller_message_reply ${JSON.stringify(REPLY_ARGS)}`,
};
export const REPLY: GatedAction = {
  id: "g:34:12", conversationId: 34, by: "child listings", tool: "ebay_seller_message_reply", args: REPLY_ARGS,
  category: "messages", description: REPLY_ENTRY.description, requestedAt: GATED_NOW - 9 * MIN, state: { kind: "waiting" },
};
