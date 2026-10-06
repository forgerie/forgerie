---
name: ask-user
description: "You MUST use this before high-stakes architectural decisions, irreversible changes, or when requirements are ambiguous. Runs a decision handshake with the ask_user tool: gather evidence, present structured options, collect the user's explicit choice, then proceed."
---

# Ask user

A decision gate. Use `ask_user` to get the user's explicit choice when the next
step is one of these:

- It changes architecture, schema, an API contract, deployment, or security.
- It is costly to undo: a large refactor, a migration, a destructive edit, or
  a production-facing change.
- Requirements or success criteria are unclear, conflicting, or missing.
- Several valid options exist and the trade-off is the user's preference.
- An assumption you are about to make would change the implementation.

When the user already chose for this exact trade-off, proceed on that choice.

## Handshake

1. **Gather evidence.** Read the code, docs, and tool output first, so the user
   decides on facts. A question that reading could answer is not a decision.
2. **Ask.** Call `ask_user` alone and last. It ends the run; the answers come
   back as a follow-up message.
   - `question`: one concrete decision, such as "Which cache should the first
     release use?"
   - `detail`: a short neutral summary of the current state, the constraints,
     the trade-offs, and your recommendation.
   - `options`: 2–5 short, outcome-named choices. Put each trade-off in the
     option's `detail`. The browser adds a Custom choice itself.
   - `multiple: true` only when the choices are independent of each other.
   - Several entries in `questions` only for independent decisions at the same
     boundary. A decision whose options depend on another answer waits for a
     later call.
3. **Commit.** Restate the decision in one sentence, say what you do next, and
   do it.

## Question budget

One `ask_user` call per decision boundary. A second call is for an unclear,
skipped, or cancelled answer only: narrow it to your recommendation, "Choose
another option", and "Stop for now". After that, a high-stakes boundary stops
and is reported as blocked; an ambiguous-only boundary where the user said
"your call" proceeds on the most reversible option, with its assumptions
stated. Ask again only when new evidence changes the trade-off.
