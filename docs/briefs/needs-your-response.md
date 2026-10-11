# Needs your response

## Contract

The sidebar separates output that the user has not seen from a request that the user must answer. Opening a session clears only unread output. Delivered chat replies, submitted answers, and dismissed forms resolve response requests.

`end_turn({ awaiting: "nothing" | "reply" })` ends a hosted run. The agent writes its final text first and calls the tool alone. `ask_user` ends a run with a question form. Both tools are model-only, so codemode cannot hide the declaration inside a script.

`end_turn` refuses a call whose own message has no visible text. Thinking does not count, because the user never sees it, and text in an earlier message of the run came before tool calls, so it is narration. The first refusal goes back to the model as a tool error and allows one corrective retry. A second consecutive silent ending stops the run with a visible failure and records no completion declaration. The recovery budget comes from the active transcript, not a runtime counter. New input, a new run, or intervening tool work starts a fresh budget. Without this rule a model could put its answer only in thinking and still mark the session Needs your response, with nothing to respond to.

The declaration is not part of the transcript. The browser projection (`src/server/browserMessageProjection.ts`) drops `end_turn` calls, successful results, and ordinary live tool events from history pages, previews, the stream snapshot, and the event stream. Failed results remain visible in history, previews, and live events. The response events record the declaration, and the sidebar shows it. Paging keeps raw positions, so a page can hold fewer messages than `total - start` suggests.

A hosted run starts by recording a versioned response event in Pi's session file. If the agent ends without a declaration, the session needs a response. This is the user's chosen conservative default. Old turns without this event remain legacy turns. No release-date cutoff or text classifier is used.

## Ownership

| Fact | Source |
| --- | --- |
| Response declarations and open questions | Events on the active Pi session branch. |
| Answers accepted through the browser | Answer events on that same branch. |
| Delivered chat and answer messages | Pi message entries on that same branch. |
| Streaming and extension dialogs | Live daemon runtime. |
| Unread output | The existing daemon unread catalog and its guarded read acknowledgement. |

`SessionAsks` validates questions and answers, reads the branch projection, and appends events. It owns no map of pending questions. Reloading a runtime rebuilds the form from the transcript. Branch navigation selects that branch's requests. Compaction does not erase them because the projection reads branch entries, not trimmed model context.

The response projection is pure. A leaf-id memo avoids refolding the whole branch for every streaming token. It is a disposable cache, not an authority.

Accepted form answers are recorded before delivery. On runtime reload, answer events without a corresponding custom answer message are delivered again. This is at-least-once delivery after a crash, not an exactly-once guarantee. Superseding a question set appends one replacement event, not a close followed by an open that can partially fail.

A chat reply accepted for queueing closes its form but does not clear the response request until Pi records the actual user message. A background notification never counts as a user answer.

## Catalog checkpoints

The machine catalog reads bounded metadata windows rather than entire transcripts. The daemon appends compact response checkpoints in the same Pi session file at run boundaries, question transitions, declarations, and successful tree navigation. The checkpoint is calculated from the branch and contains no question body. Catalogs read it without loading a runtime. Runtime status and forms always use the branch events, not the checkpoint.

This avoids a second persistent status database and preserves catalog performance. An external writer that appends more than the catalog window after the last checkpoint can hide the checkpoint. Hosted runs refresh it at settlement. Unfinished crash recovery and terminal-only writers are not a guarantee of this protocol.

## Priority

Archived sessions stay archived. A question form or a live extension dialog takes priority because the user can answer it now. Errors retain their error category. Active work stays Working. Otherwise a response request takes priority over Unread, followed by Open.

The internal `blocked` category identifier stays stable for existing preferences and styles. Its user-visible label is `Needs your response`. No extra sidebar category is added.

## Limits

The classification is deterministic; model compliance is not. A missing declaration intentionally creates a false alarm instead of hiding a possible question. A declared completion can still be wrong. The system does not classify prose or ask another model to judge intent.

The tool belongs to hosted Forgerie sessions. It does not change the separate terminal Pi profile. Browser read acknowledgements remain separate from conversation intent because reading is a user action, not a conversation-tree edit.

A session daemon restart is required to load the new tool registry. It interrupts active runs. Build and test before restarting, and restart only when runs are idle.
