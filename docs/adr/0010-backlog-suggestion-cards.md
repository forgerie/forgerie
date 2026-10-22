# Capture backlog suggestions in chat cards

Status: accepted, 2026-10-22

Agents use the parent-only, model-only `suggest_backlog` tool when they would say “we should backlog this”. The tool saves an open suggestion with its title, body, why, files, and decisions. It does not file an item, start work, or end the current turn. Children suggest items in their reports; the parent calls the tool.

The user chooses **File** or **File and act** on the card. File writes to the project's resolved Markdown or GitHub backlog. File and act writes the item, then starts a separate session in a fresh worktree and sends its initial prompt from the server. The current chat stays open. The new session can use a cheaper model. Azure sources remain read-only.

This amends [ADR 0002](0002-agents-file-issues-directly.md). `file_issue` remains available to the parent when the user explicitly asks to file now. Its duplicate search, `agent-filed` label, and issue decision remain unchanged. Suggestion cards do not restore the old GitHub-only `propose_issue` tool or its routes.

## Considered options

- Keep direct filing for every follow-up: no user click, but agents can fill the backlog with work the user did not choose.
- Leave suggestions only in chat text: no new state, but follow-ups and their context get lost.
- Require a card for explicit filing requests too: one filing surface, but the user must approve work they already asked to file.
- Start work in the current chat: no extra session, but follow-up work interrupts the main task and uses its model.

## Consequences

Follow-up work needs a user click. Open suggestions remain until filed or dismissed, including after chat archive. The server must keep durable suggestions, request receipts, context, and recovery state. The model must write enough context for a later session; the server does not copy the whole chat.

File and act uses another session, a worktree, and model quota. A cheaper default reduces cost, but it does not make background work free. GitHub creation and local receipt writes cannot be atomic, so an uncertain GitHub result requires inspection rather than an automatic retry. Markdown filing needs a Git project and a main checkout on its default branch.
