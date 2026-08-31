/**
 * Layout policy for the composer's ask-takeover state.
 *
 * This is the algorithm, not a description of one. The live prototype and the
 * size ladder both execute it, so an image can never disagree with the code.
 *
 * Everything here is a pure function of the space the composer actually has
 * plus a summary of the question set. No device checks, no user-agent, no
 * orientation. A 711x374 folded landscape phone and a 711x374 pane on a
 * desktop get the same layout, because they are the same shape.
 *
 * The width passed in is the reading column, not the viewport. The app caps
 * that column at 36rem and the composer aligns to it, so the honest width range
 * is roughly 256px on a 320px screen up to 576px on anything wider. Thresholds
 * calibrated against viewport widths were calibrated against a number this
 * layout never sees.
 */

/**
 * Every threshold lives here so the ladder can annotate itself and the eventual
 * unit tests have one place to probe on either side of.
 *
 * All values are guesses until measured against the real composer in the real
 * app. They are calibrated against the acceptance postures in AGENTS.md:
 * 704x783, 932x553, 475x638, 711x374, each also with a keyboard up.
 */
export const THRESHOLDS = {
  /** Below this height one question no longer fits as a comfortable block, so the set pages. */
  SHEET_MIN_HEIGHT: 520,
  /** Below this height even a single question block is too tall; the tool becomes a strip. */
  PAGED_MIN_HEIGHT: 300,
  /** Column width at which options can sit in more than one track. */
  GRID_MIN_WIDTH: 380,
  /** Column track bounds. The longest label sets the track inside these, so long
      labels widen their column instead of forcing every option to a full row. */
  TRACK_MIN: 160,
  TRACK_MAX: 320,
  /** Rough advance width per character at the option font size, in px. */
  TRACK_CH: 8.5,
  /** In a strip, the column width at which the question can sit beside the options. */
  INLINE_PROMPT_MIN_WIDTH: 520,
  /** Column width at which the progress readout can spell itself out. */
  FULL_READOUT_MIN_WIDTH: 380,
  /** Column width at which the readout survives as "3/5" before folding away. */
  SHORT_READOUT_MIN_WIDTH: 240,
  /** Width at which the skip action can sit beside submit rather than in the overflow menu. */
  SKIP_INLINE_MIN_WIDTH: 380,
  /** Width at which the context chips can sit in the header. */
  CONTEXT_CHIPS_MIN_WIDTH: 420,
  /** Card chrome either side of the footer row, plus the gap between controls. */
  FOOTER_CHROME: 32,
  FOOTER_GAP: 10,
  /** Share of the container the tool may eat, per structure. The rest keeps transcript visible. */
  SHARE_SHEET: 0.62,
  SHARE_PAGED: 0.66,
  SHARE_STRIP: 0.82,
  /** The tool never renders shorter than one question line plus a submit row. */
  MIN_HEIGHT: 96,
};

/**
 * The footer's controls, in the order their groups leave the surface.
 *
 * Taking the composer over means inheriting the composer's whole rail, not just
 * its Send button. Everything the host declares in ComposerCapabilities is still
 * declared while a question is open, so hiding it would take a capability away
 * from the user for the duration of the ask rather than adapting to the space.
 *
 * Costs are rough inline widths in px, used to fit the row. They are guesses
 * until measured, and they only decide ordering, never whether something exists.
 *
 * Groups move whole. Half a session menu is worse than none of it, and a pager
 * missing its forward arrow is worse than no pager.
 */
export const FOOTER_CONTROLS = [
  { id: "submit", group: "commit", cost: 132, label: "Send answers" },
  // Two costs: with the "3 / 20" readout beside the arrows, and without it.
  { id: "pager", group: "page", cost: 134, costWithoutLabel: 98, label: "Move between questions" },
  { id: "stop", group: "interrupt", cost: 42, label: "Stop" },
  { id: "dictate", group: "answer", cost: 42, label: "Dictate an answer" },
  { id: "attach", group: "answer", cost: 42, label: "Attach a file" },
  { id: "skip", group: "defer", cost: 64, label: "Leave this unanswered" },
  { id: "tree", group: "session", cost: 42, label: "Session tree" },
  { id: "archive", group: "session", cost: 42, label: "Archive and next" },
  { id: "newSession", group: "session", cost: 42, label: "New session" },
  { id: "rapidfire", group: "session", cost: 42, label: "Rapidfire" },
  { id: "dismiss", group: "session", cost: 42, label: "Close" },
];

/**
 * Which group gives up its place first.
 *
 * `commit` and `page` are pinned: a question you cannot send, or cannot page
 * away from, is broken rather than adapted. `interrupt` outranks the answer
 * aids because stopping runaway work matters more than dictating into it.
 * `session` goes first because a menu is a natural home for it.
 */
export const GROUP_DROP_ORDER = ["session", "defer", "answer", "interrupt"];
export const PINNED_GROUPS = ["commit", "page"];

/**
 * Controls that an open ask genuinely has no target for.
 *
 * Slash commands, queue, and steer all act on a free-form draft that takeover
 * has already ruled out, so they are absent rather than overflowed. This is the
 * same reasoning that removes Skip when there is nothing to page to: absence is
 * honest only when the capability has nothing to act on.
 */
export const NOT_APPLICABLE_WHILE_ASKING = ["commands", "queue", "steer"];

/**
 * Reduce a question set to the few facts that change layout.
 *
 * Option count deliberately does not appear: options always scroll inside their
 * own band, so twelve of them cost the same structure as three.
 */
export function summarize(questions) {
  let longestOptionLabel = 0;
  let hasDetail = false;
  for (const question of questions) {
    if (question.detail !== undefined) hasDetail = true;
    for (const option of question.options) {
      if (option.label.length > longestOptionLabel) longestOptionLabel = option.label.length;
      if (option.detail !== undefined) hasDetail = true;
    }
  }
  return { questionCount: questions.length, longestOptionLabel, hasDetail };
}

/**
 * The capability set a chat session declares, mirroring ComposerCapabilities.
 *
 * Every one of these is still declared while a question is open: the session can
 * still be archived, the tree can still be walked, an answer can still be
 * dictated or carry a file. Only the controls that act on a free-form draft lose
 * their target, and those are named in NOT_APPLICABLE_WHILE_ASKING.
 */
export const CHAT_CAPABILITIES = {
  stop: false,
  dictate: true,
  attach: true,
  tree: true,
  archive: true,
  newSession: true,
  rapidfire: true,
  dismiss: false,
  contextUsage: { usedPercent: 61 },
  chips: [{ id: "cwd", label: "forgerie" }, { id: "branch", kind: "branch", label: "main" }],
};

/**
 * Decide the whole layout from container width, container height, and the set.
 *
 * Height decides structure, because height is what runs out when the on-screen
 * keyboard opens. Width decides content, because width is what decides how much
 * of a row is readable. The two are read independently on purpose: a 1280x170
 * strip is not a smaller 420x400 column, it is a different shape, and it can
 * afford things the column cannot.
 */
export function plan(width, height, model, capabilities = {}) {
  const structure =
    height >= THRESHOLDS.SHEET_MIN_HEIGHT ? "sheet" : height >= THRESHOLDS.PAGED_MIN_HEIGHT ? "paged" : "strip";

  const share =
    structure === "sheet"
      ? THRESHOLDS.SHARE_SHEET
      : structure === "paged"
        ? THRESHOLDS.SHARE_PAGED
        : THRESHOLDS.SHARE_STRIP;

  // A cap, not a height. A single short question still renders short; the tool
  // only grows to the budget when it has content that needs the room.
  const heightBudget = Math.max(THRESHOLDS.MIN_HEIGHT, Math.round(height * share));

  // Width buys columns. Gating this on label length was a mistake the ladder
  // caught: at 932x300 a long label forced every option to a full-width row, so
  // two options ate the whole height while 900px of width sat empty. The track
  // grows with the label instead, and auto-fit decides the column count.
  const options = structure === "strip" ? "inline" : width >= THRESHOLDS.GRID_MIN_WIDTH ? "grid" : "rows";
  const optionTrack = Math.round(
    Math.min(THRESHOLDS.TRACK_MAX, Math.max(THRESHOLDS.TRACK_MIN, model.longestOptionLabel * THRESHOLDS.TRACK_CH)),
  );

  // Rule: reflow spends the plentiful axis. A strip is starved of height and
  // rich in width, so the question text moves out of the vertical stack and
  // into the room beside the options.
  const promptPlacement =
    structure === "strip" && width >= THRESHOLDS.INLINE_PROMPT_MIN_WIDTH ? "inline" : "block";

  // A readout is information, not capability, so it yields first: full phrase,
  // then a counter, then it folds into the pager label and nowhere else.
  const readout =
    width >= THRESHOLDS.FULL_READOUT_MIN_WIDTH
      ? "full"
      : width >= THRESHOLDS.SHORT_READOUT_MIN_WIDTH
        ? "short"
        : "pager";

  // One question at a time whenever the whole set cannot be seen at once.
  const paged = structure !== "sheet" && model.questionCount > 1;

  const footer = fitFooter(width, { ...capabilities, paged });
  const inline = [...footer.inline];
  const overflow = [...footer.overflow];

  // Free text is a field in the body, not a button in the row, so it answers to
  // height rather than to the footer's width budget. Inside a capped reading
  // column no width buys it a place beside the options in a strip; it opens full
  // size from the overflow menu instead. One tap, not one fewer capability.
  if (structure === "strip") overflow.unshift("freeText");
  else inline.push("freeText");

  return {
    structure,
    heightBudget,
    options,
    optionTrack,
    promptPlacement,
    readout,
    // Question detail is prose. When it cannot sit under the question it opens
    // at window level, unclipped, rather than being cropped by a short tool.
    detail: structure === "strip" ? "popover" : "inline",
    paged,
    pageLabel: footer.pageLabel,
    // Readouts yield before any control does. The context chips go first, then
    // the answered count shortens, then it leaves. None of them is a capability.
    contextChips: width >= THRESHOLDS.CONTEXT_CHIPS_MIN_WIDTH && structure !== "strip",
    contextUsage: capabilities.contextUsage !== undefined,
    droppedGroups: footer.droppedGroups,
    inline,
    overflow,
  };
}

/**
 * Fit the footer row, dropping whole groups from the tail until it fits.
 *
 * Deliberately not a measurement of the real DOM. A layout that measures itself
 * and then resizes itself on the result oscillates; this decides from the
 * container width alone, and the CSS keeps a wrapping row as the safety net for
 * the case where even the pinned controls do not fit.
 */
export function fitFooter(width, context) {
  const present = FOOTER_CONTROLS.filter((control) => isPresent(control, context));
  const budget = width - THRESHOLDS.FOOTER_CHROME;
  const droppedGroups = [];

  const costOf = (control, pageLabel) =>
    control.costWithoutLabel !== undefined && !pageLabel ? control.costWithoutLabel : control.cost;
  const totalOf = (controls, pageLabel) =>
    controls.reduce((sum, control) => sum + costOf(control, pageLabel), 0) +
    Math.max(0, controls.length - 1) * THRESHOLDS.FOOTER_GAP;

  let kept = present;
  // The position readout goes before any control does. It is information, and
  // the arrows carry the whole capability without it; dropping a control first
  // would trade a capability for a number.
  let pageLabel = totalOf(kept, true) <= budget;

  for (const group of GROUP_DROP_ORDER) {
    if (totalOf(kept, pageLabel) <= budget) break;
    if (!kept.some((control) => control.group === group)) continue;
    // One more control from the tail would be cheaper, but it would also split a
    // group. A session menu missing two of its five entries reads as a bug.
    kept = kept.filter((control) => control.group !== group);
    droppedGroups.push(group);
  }

  // Once the row fits again, the readout comes back if it can be afforded.
  if (!pageLabel && totalOf(kept, true) <= budget) pageLabel = true;

  const keptIds = new Set(kept.map((control) => control.id));
  return {
    inline: present.filter((control) => keptIds.has(control.id)).map((control) => control.id),
    overflow: present.filter((control) => !keptIds.has(control.id)).map((control) => control.id),
    droppedGroups,
    pageLabel,
  };
}

function isPresent(control, context) {
  if (control.id === "pager") return context.paged === true;
  if (control.id === "skip") return context.paged === true;
  if (control.id === "submit") return true;
  // Everything else is a declared host capability. The composer renders a
  // control because a host declared it, never because a field happened to be set.
  return context[control.id] !== undefined && context[control.id] !== false;
}

/**
 * Fixtures. `many` is the honest worst case the ask contract allows:
 * 20 questions, 12 options each, which is what the tool must survive at
 * 711x184 with a keyboard up.
 */
export const FIXTURES = {
  single: [
    {
      id: "takeover",
      question: "While a question is pending, does the composer take over completely?",
      detail: "Takeover means no free-form send and no slash commands until the answers go out.",
      options: [
        { value: "takeover", label: "Yes, it takes over", detail: "One surface, no ambiguity." },
        { value: "coexist", label: "No, allow both" },
      ],
    },
  ],
  few: [
    {
      id: "scope",
      question: "Which surface should morph first?",
      options: [
        { value: "composer", label: "Bottom composer" },
        { value: "card", label: "Transcript card" },
        { value: "both", label: "Both at once" },
      ],
    },
    {
      id: "draft",
      question: "What happens to a half-typed message when a question arrives?",
      detail: "The draft is browser-local and has never been sent to the daemon.",
      options: [
        { value: "stash", label: "Stash it, restore after answering" },
        { value: "keep", label: "Keep it visible under the question" },
        { value: "discard", label: "Discard it" },
      ],
    },
    {
      id: "skip",
      question: "How does someone leave a question unanswered?",
      options: [
        { value: "blank", label: "Submit with blanks" },
        { value: "explicit", label: "An explicit skip control" },
        { value: "both", label: "Both" },
      ],
      multiple: true,
    },
  ],
  many: buildManyQuestions(),
};

function buildManyQuestions() {
  const questions = [];
  for (let index = 0; index < 20; index += 1) {
    const options = [];
    for (let option = 0; option < 12; option += 1) {
      options.push({ value: `q${String(index)}-o${String(option)}`, label: `Option ${String(option + 1)}` });
    }
    questions.push({
      id: `q${String(index)}`,
      question: `Worst-case question ${String(index + 1)} of 20, with all twelve options the contract allows.`,
      detail: index % 3 === 0 ? "Some questions carry a detail line, which is prose and must stay reachable." : undefined,
      options,
      multiple: index % 4 === 0,
    });
  }
  return questions;
}
