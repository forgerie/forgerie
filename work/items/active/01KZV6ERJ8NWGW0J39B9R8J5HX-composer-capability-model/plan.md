---
id: 01KZV6ERJ8NWGW0J39B9R8J5HX
title: Give the composer a capability model both surfaces share
status: active
---

# Give the composer a capability model both surfaces share

## Why

The composer is a core component. It now serves the chat and the new-session
modal, but it serves them through accumulated boolean flags: `surface`,
`submissionAvailable`, `sendAvailable`, `runtimeControlsAvailable`,
`canArchive`, `sessionLabel`, `chromeSummoned`. Each new host adds another
flag, and a control appears or disappears as a side effect of a field being
absent rather than because a host declared it.

That produced two defects:

- The modal cannot offer model, thinking level, or guidance, because those read
  a live session's `status`. They vanished silently.
- The modal wraps the composer in form chrome, so it does not look like the
  composer at all.

## Shape

One idea: **a host declares what it can do, and supplies the state each control
needs.** The composer renders exactly the declared controls.

```ts
interface ComposerCapabilities {
  model?: ComposerModelCapability;        // choose model + thinking level
  guidance?: ComposerGuidanceCapability;  // toggle guidance entries
  attachments?: boolean;
  stop?: ComposerStopCapability;          // only where work can run
  archive?: ComposerArchiveCapability;
  newSession?: ComposerNewSessionCapability;
  contextUsage?: ContextUsage;
  context?: readonly ComposerContextChip[]; // session identity, or destination
}
```

Both hosts build this value:

- Chat builds it from the live `SessionStatus`.
- The modal builds it from its own pre-session selection and its destination.

A control is present because a host declared it, never because a field happened
to be set. `surface`, `canArchive`, and `sessionLabel` are deleted.

## Slices

1. **Capability model.** Replace the flag set with `ComposerCapabilities`.
   Chat and modal both build one. No visible change to chat.
2. **Context chips.** The composer row carries host chips in one slot. Chat puts
   session identity there. The modal puts destination there.
3. **Island-only modal.** Delete the `Destination` and `First prompt` headings,
   the scroll wrapper, and the footer. The modal is the composer plus its
   destination chip. Escape and the backdrop close it.
4. **Pre-session model and thinking.** The modal selects a model and thinking
   level before a session exists, and holds them as its own state.
5. **Creation carries the choice.** `startSession` accepts model, thinking
   level, and guidance ids; the server applies them when opening the session.
6. **Pre-session guidance.** The modal offers guidance entries and passes the
   chosen ids into creation.

## Progress

Slice 1 is written on `feat/composer-capability-model`, not yet committed:

- `src/client/src/composerCapabilities.ts` declares the model.
- `PromptEditor` renders every control from `capabilities`. `surface`,
  `canArchive`, `sessionLabel`, `contextUsage`, `availableThinkingLevels`,
  `onStop`, `onSelectModel`, `onSelectThinking`, `onSetGuidance`,
  `onArchiveAndNext`, and `onNewSession` are deleted.
- `PiWebApp` builds `sessionComposerCapabilities` and
  `openingComposerCapabilities`, replacing two 25-property call sites.
- `NewSessionComposer` builds `composerCapabilities`, stating the destination
  as a context chip that carries its own Change/Choose action.
- `PromptEditor.capabilities.test.ts` states the new contract.

All non-test code typechecks. 22 typecheck errors remain, all in tests that
still set the deleted properties:

`PromptEditor.runtimeControls`, `PromptEditor.guidance`,
`PromptEditor.modelThinking`, `PromptEditor.summonedChrome`,
`PromptEditor.actions`, `PromptEditor.reveal`, `PromptEditor.preSession`,
`PromptEditor.escape`, `PiWebApp.guidance`, `PiWebApp.chatOpening`.

Next: migrate those tests, then run the whole suite and commit slice 1.

## Gates

- Every slice keeps the whole suite green and lands as one commit.
- Chat behaviour is unchanged through slices 1 to 3.
- A control offered on one surface is offered on the other whenever the host
  can supply its state.
- No control renders as a side effect of an absent field.
