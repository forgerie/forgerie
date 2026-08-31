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
  /** Width at which the "3 / 20" position readout can stay beside the pager arrows. */
  PAGE_LABEL_MIN_WIDTH: 360,
  /** Share of the container the tool may eat, per structure. The rest keeps transcript visible. */
  SHARE_SHEET: 0.62,
  SHARE_PAGED: 0.66,
  SHARE_STRIP: 0.82,
  /** The tool never renders shorter than one question line plus a submit row. */
  MIN_HEIGHT: 96,
};

/**
 * Controls the tool owns, in the order they may leave the surface.
 *
 * Order matters and is deliberate. `submit` and `options` never overflow: a
 * question you cannot answer or send is not a smaller product, it is a broken
 * one. Everything after them degrades to one extra tap, never to absence.
 */
export const CONTROL_PRIORITY = ["submit", "options", "freeText", "skip", "attach", "draftPeek"];

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
 * Decide the whole layout from container width, container height, and the set.
 *
 * Height decides structure, because height is what runs out when the on-screen
 * keyboard opens. Width decides content, because width is what decides how much
 * of a row is readable. The two are read independently on purpose: a 1280x170
 * strip is not a smaller 420x400 column, it is a different shape, and it can
 * afford things the column cannot.
 */
export function plan(width, height, model) {
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

  const inline = [];
  const overflow = [];
  const place = (control, condition) => {
    (condition ? inline : overflow).push(control);
  };

  place("submit", true);
  place("options", true);
  // Inside a capped reading column, width is never plentiful enough to pay for
  // a text field beside the options in a strip. It opens full size from the
  // overflow menu instead, which is one tap, not one fewer capability.
  place("freeText", structure !== "strip");
  // Skip is navigation, so it exists only while questions arrive one at a time.
  // With the whole set on screen, leaving a question alone is already the skip
  // and the submit label reports the count, so an explicit control would name a
  // capability that has no target. It is not overflowed here, it is absent,
  // which is the one case where absence is honest rather than a smaller product.
  if (paged) place("skip", width >= THRESHOLDS.SKIP_INLINE_MIN_WIDTH);
  place("attach", structure === "sheet" && width >= THRESHOLDS.SKIP_INLINE_MIN_WIDTH);
  place("draftPeek", structure === "sheet");

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
    pageLabel: width >= THRESHOLDS.PAGE_LABEL_MIN_WIDTH,
    inline,
    overflow,
  };
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
