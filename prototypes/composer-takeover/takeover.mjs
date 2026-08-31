/**
 * The composer that becomes the ask tool.
 *
 * One input surface. In `draft` mode it is the normal message composer. When a
 * question set opens it morphs in place: same element, same position, new job.
 * There is never a second place to type.
 *
 * The markup deliberately mirrors the shipped AskUserCard: a card, an uppercase
 * accent heading, fieldsets with legends, real radio and checkbox inputs, a
 * per-question free-text field. Nothing here is a new visual language. The only
 * thing being proposed is where the card lives and how it survives a small
 * container.
 *
 * Layout is not decided here. Every structural choice comes from `plan()`, and
 * this file only applies the result as data attributes so CSS can respond. That
 * keeps the policy testable and keeps the DOM stable enough that a caret in a
 * textarea survives a fold, a rotate, and the keyboard opening.
 */

import { FIXTURES, plan, summarize } from "./plan.mjs";

const OVERFLOW_LABELS = {
  freeText: "Write my own answer",
  skip: "Leave this unanswered",
  attach: "Attach a file",
  draftPeek: "Show my saved draft",
};

export class ComposerTakeover extends HTMLElement {
  #mode = "draft";
  #questions = [];
  #answers = new Map();
  #page = 0;
  #stashedDraft = "";
  #plan = undefined;
  #built = "";

  connectedCallback() {
    this.#buildFrame();
    this.#observe();
    this.#render();
  }

  /** Open a question set. The half-typed message is stashed, never dropped. */
  open(questions) {
    this.#stashedDraft = this.#draftField.value;
    this.#questions = questions;
    this.#answers = new Map();
    this.#page = 0;
    this.#mode = "ask";
    this.#built = "";
    this.#render();
  }

  /** Close the ask and hand the composer back with the draft intact. */
  close() {
    this.#mode = "draft";
    this.#questions = [];
    this.#draftField.value = this.#stashedDraft;
    this.#stashedDraft = "";
    this.#render();
    this.dispatchEvent(new CustomEvent("ask-closed", { bubbles: true }));
  }

  get mode() {
    return this.#mode;
  }

  #buildFrame() {
    this.innerHTML = `
      <div class="ct" data-mode="draft">
        <section class="ct-card" hidden aria-labelledby="ct-heading">
          <header class="ct-head">
            <h2 id="ct-heading">Questions</h2>
            <span class="ct-status" role="status" aria-live="polite" aria-atomic="true"></span>
          </header>
          <div class="ct-body">
            <div class="ct-questions"></div>
          </div>
          <footer class="ct-foot">
            <div class="ct-pager">
              <button class="ct-page-prev" type="button" aria-label="Previous question">&lsaquo;</button>
              <span class="ct-page-label"></span>
              <button class="ct-page-next" type="button" aria-label="Next question">&rsaquo;</button>
            </div>
            <span class="ct-draft-chip" hidden>Draft saved</span>
            <button class="ct-skip" type="button">Skip</button>
            <button class="ct-more" type="button" aria-haspopup="menu">More</button>
            <button class="ct-submit" type="button">Send answers</button>
          </footer>
        </section>

        <div class="ct-draft">
          <textarea class="ct-draft-field" rows="1" placeholder="Message the agent"></textarea>
          <button class="ct-send" type="button">Send</button>
        </div>
      </div>

      <div class="ct-sheet" popover="auto">
        <p class="ct-sheet-title"></p>
        <div class="ct-sheet-body"></div>
      </div>
    `;

    this.#column = this.parentElement?.querySelector(".column-probe") ?? undefined;
    this.#root = this.querySelector(".ct");
    this.#card = this.querySelector(".ct-card");
    this.#body = this.querySelector(".ct-body");
    this.#questionsBox = this.querySelector(".ct-questions");
    this.#draftField = this.querySelector(".ct-draft-field");
    this.#sheet = this.querySelector(".ct-sheet");

    this.querySelector(".ct-page-prev").addEventListener("click", () => { this.#turnPage(-1); });
    this.querySelector(".ct-page-next").addEventListener("click", () => { this.#turnPage(1); });
    this.querySelector(".ct-submit").addEventListener("click", () => { this.#submit(); });
    this.querySelector(".ct-skip").addEventListener("click", () => { this.#turnPage(1, true); });
    this.querySelector(".ct-more").addEventListener("click", () => { this.#openOverflow(); });

    // A capped region that scrolls must say so, or content stopping at the
    // budget line reads as clipped.
    this.#body.addEventListener("scroll", () => { this.#syncScrollHint(); }, { passive: true });
    // Delegated, so per-question controls survive a rebuild without rebinding.
    this.#questionsBox.addEventListener("change", () => { this.#recordSelection(); });
    this.#questionsBox.addEventListener("input", (event) => { this.#recordBlockText(event); });
    this.#questionsBox.addEventListener("click", (event) => { this.#maybeOpenDetail(event); });
  }

  /**
   * Measure the container, never the window.
   *
   * Width comes from the column probe, which carries the app's reading measure
   * and nothing else. Measuring the card instead would feed the layout back
   * into its own input, because the plan changes the card's padding. Height
   * comes from the frame, which is what shrinks when the keyboard opens.
   */
  #observe() {
    const observer = new ResizeObserver(() => { this.#render(); });
    observer.observe(this.#column ?? this.parentElement ?? this);
    observer.observe(this.closest(".frame") ?? document.documentElement);
  }

  #render() {
    const column = this.#column ?? this.parentElement ?? this;
    const width = Math.round(column.getBoundingClientRect().width);
    const frame = this.closest(".frame") ?? document.documentElement;
    const height = Math.round(frame.getBoundingClientRect().height);

    this.#root.dataset.mode = this.#mode;
    this.#card.hidden = this.#mode !== "ask";
    this.querySelector(".ct-draft").hidden = this.#mode === "ask";
    if (this.#mode !== "ask") {
      this.#card.style.removeProperty("--ct-budget");
      this.#reportPlan(undefined, width, height);
      return;
    }

    const model = summarize(this.#questions);
    const layout = plan(width, height, model);
    this.#plan = layout;

    this.#root.dataset.structure = layout.structure;
    this.#root.dataset.options = layout.options;
    this.#root.dataset.prompt = layout.promptPlacement;
    this.#root.dataset.readout = layout.readout;
    this.#root.dataset.detail = layout.detail;
    this.#root.dataset.paged = String(layout.paged);
    this.#root.dataset.pageLabel = String(layout.pageLabel);
    for (const control of ["freeText", "skip", "attach", "draftPeek"]) {
      this.#root.dataset[`inline${control[0].toUpperCase()}${control.slice(1)}`] = String(
        layout.inline.includes(control),
      );
    }
    this.#root.dataset.hasOverflow = String(layout.overflow.length > 0);
    this.#card.style.setProperty("--ct-budget", `${String(layout.heightBudget)}px`);
    this.#card.style.setProperty("--ct-track", `${String(layout.optionTrack)}px`);

    this.#renderQuestions(layout);
    this.#renderStatus(layout);
    this.#syncScrollHint();
    this.#reportPlan(layout, width, height);
  }

  /**
   * Rebuild the question DOM only when the visible set changes. Re-rendering on
   * every resize would drop the caret out of a free-text field mid-rotation.
   */
  #renderQuestions(layout) {
    const signature = `${layout.paged ? String(this.#page) : "all"}:${String(this.#questions.length)}`;
    if (this.#built === signature) {
      this.#markAnswered();
      return;
    }
    this.#built = signature;
    const visible = layout.paged ? [this.#questions[this.#page]] : this.#questions;
    this.#questionsBox.innerHTML = visible
      .map((question, index) => this.#questionMarkup(question, layout.paged ? this.#page : index))
      .join("");
    this.#restoreAnswers();
  }

  #questionMarkup(question, index) {
    const type = question.multiple === true ? "checkbox" : "radio";
    const options = question.options
      .map(
        (option) => `
        <label class="option">
          <input type="${type}" name="ask-${question.id}" value="${option.value}">
          <span class="option-copy">
            <span class="option-label">${escapeHtml(option.label)}</span>
            ${option.detail === undefined ? "" : `<span class="option-detail">${escapeHtml(option.detail)}</span>`}
          </span>
        </label>`,
      )
      .join("");
    const hasDetail = question.detail !== undefined;
    const labelId = `ask-label-${question.id}`;
    // A labelled group rather than fieldset/legend. A legend does not take part
    // in its fieldset's grid, which silently collapsed the wide-strip layout,
    // and its notch cuts a hole in the border used as a row divider. Radio
    // grouping comes from the shared `name`, not from the fieldset.
    return `
      <section class="question" role="group" aria-labelledby="${labelId}" data-question="${question.id}">
        <p class="question-head" id="${labelId}">
          <span class="question-number">${String(index + 1)}.</span>
          <span class="question-text">${escapeHtml(question.question)}</span>
        </p>
        ${hasDetail ? `<p class="question-detail">${escapeHtml(question.detail)}</p>` : ""}
        <button class="question-detail-open${hasDetail ? " has-detail" : ""}" type="button"
          data-detail="${hasDetail ? escapeHtml(question.detail) : ""}">Detail</button>
        <div class="options">${options}</div>
        <div class="other-answer">
          <textarea class="ct-block-free" data-question="${question.id}" rows="1" maxlength="4000"
            placeholder="Write my own answer"></textarea>
        </div>
      </section>`;
  }

  #restoreAnswers() {
    for (const input of this.#questionsBox.querySelectorAll(".option input")) {
      const chosen = this.#answers.get(input.closest(".question").dataset.question)?.values ?? new Set();
      input.checked = chosen.has(input.value);
    }
    for (const field of this.#questionsBox.querySelectorAll(".ct-block-free")) {
      if (field === document.activeElement) continue;
      field.value = this.#answers.get(field.dataset.question)?.otherText ?? "";
    }
    this.#markAnswered();
  }

  /** Native inputs own selection; this only mirrors them into the answer map. */
  #recordSelection() {
    for (const group of this.#questionsBox.querySelectorAll(".question")) {
      const id = group.dataset.question;
      const answer = this.#answers.get(id) ?? { values: new Set(), otherText: "" };
      answer.values = new Set(
        [...group.querySelectorAll(".option input")].filter((input) => input.checked).map((input) => input.value),
      );
      this.#answers.set(id, answer);
    }
    this.#markAnswered();
    this.#renderStatus(this.#plan);
  }

  #recordBlockText(event) {
    const field = event.target.closest(".ct-block-free");
    if (field === null) return;
    const answer = this.#answers.get(field.dataset.question) ?? { values: new Set(), otherText: "" };
    answer.otherText = field.value;
    this.#answers.set(field.dataset.question, answer);
    this.#markAnswered();
    this.#renderStatus(this.#plan);
  }

  #markAnswered() {
    for (const group of this.#questionsBox.querySelectorAll(".question")) {
      group.classList.toggle("answered", this.#isAnswered(group.dataset.question));
    }
  }

  #isAnswered(id) {
    const answer = this.#answers.get(id);
    if (answer === undefined) return false;
    return answer.values.size > 0 || (answer.otherText ?? "") !== "";
  }

  #renderStatus(layout) {
    const answered = this.#questions.filter((question) => this.#isAnswered(question.id)).length;
    const total = this.#questions.length;
    this.querySelector(".ct-status").textContent =
      layout.readout === "full"
        ? `${String(answered)} of ${String(total)} answered`
        : layout.readout === "short"
          ? `${String(answered)}/${String(total)}`
          : "";
    this.querySelector(".ct-page-label").textContent = layout.paged
      ? `${String(this.#page + 1)} / ${String(total)}`
      : "";
    this.querySelector(".ct-draft-chip").hidden = this.#stashedDraft === "";
    // Only name the blanks once something has been answered. Labelling an
    // untouched set "Send blank" warns about a choice nobody has made yet.
    const blank = total - answered;
    this.querySelector(".ct-submit").textContent =
      blank > 0 && answered > 0 ? `Send (${String(blank)} blank)` : "Send answers";
  }

  #currentQuestion() {
    return this.#questions[this.#plan?.paged === true ? this.#page : 0] ?? this.#questions[0];
  }

  /** Advancing past a question without touching it is how a blank answer happens. */
  #turnPage(delta, wrapToEnd = false) {
    const next = this.#page + delta;
    if (next < 0) return;
    if (next >= this.#questions.length) {
      if (wrapToEnd) this.#submit();
      return;
    }
    this.#page = next;
    this.#built = "";
    this.#render();
  }

  #submit() {
    const answers = [...this.#answers.entries()].map(([id, answer]) => ({
      id,
      values: [...answer.values],
      otherText: answer.otherText === "" ? undefined : answer.otherText,
    }));
    this.dispatchEvent(new CustomEvent("ask-submitted", { detail: { answers }, bubbles: true }));
    this.close();
  }

  /**
   * The overflow menu opens in the top layer, not inside the card. A strip 150px
   * tall cannot contain a usable menu and does not need to: it only needs to
   * summon one with full-size targets.
   */
  #openOverflow() {
    const layout = this.#plan;
    if (layout === undefined) return;
    this.querySelector(".ct-sheet-title").textContent = "More";
    this.querySelector(".ct-sheet-body").innerHTML = layout.overflow
      .map((control) => `<button class="ct-sheet-item" type="button" data-control="${control}">${OVERFLOW_LABELS[control]}</button>`)
      .join("");
    for (const item of this.#sheet.querySelectorAll(".ct-sheet-item")) {
      item.addEventListener("click", () => {
        if (item.dataset.control === "freeText") this.#openFreeTextSheet();
        else this.#sheet.hidePopover();
      });
    }
    this.#sheet.showPopover();
  }

  /** Free text never disappears. When it cannot sit inline it opens full size. */
  #openFreeTextSheet() {
    const question = this.#currentQuestion();
    this.querySelector(".ct-sheet-title").textContent = question.question;
    this.querySelector(".ct-sheet-body").innerHTML =
      `<textarea class="ct-sheet-field" rows="4" maxlength="4000" placeholder="Write my own answer"></textarea>
       <button class="ct-sheet-done" type="button">Done</button>`;
    const field = this.#sheet.querySelector(".ct-sheet-field");
    field.value = this.#answers.get(question.id)?.otherText ?? "";
    field.addEventListener("input", () => {
      const answer = this.#answers.get(question.id) ?? { values: new Set(), otherText: "" };
      answer.otherText = field.value;
      this.#answers.set(question.id, answer);
      this.#markAnswered();
      this.#renderStatus(this.#plan);
    });
    this.#sheet.querySelector(".ct-sheet-done").addEventListener("click", () => { this.#sheet.hidePopover(); });
    field.focus();
  }

  #maybeOpenDetail(event) {
    const opener = event.target.closest(".question-detail-open");
    if (opener === null) return;
    this.querySelector(".ct-sheet-title").textContent =
      opener.closest(".question").querySelector(".question-text").textContent ?? "";
    this.querySelector(".ct-sheet-body").innerHTML =
      `<p class="ct-sheet-text">${escapeHtml(opener.dataset.detail ?? "")}</p>`;
    this.#sheet.showPopover();
  }

  #syncScrollHint() {
    requestAnimationFrame(() => {
      const room = this.#body.scrollHeight - this.#body.clientHeight;
      this.#root.dataset.overflowing = String(room > 2);
      this.#root.dataset.atEnd = String(room <= 2 || this.#body.scrollTop >= room - 2);
    });
  }

  #reportPlan(layout, width, height) {
    this.dispatchEvent(
      new CustomEvent("plan-changed", { detail: { plan: layout, width, height }, bubbles: true }),
    );
  }

  #column;
  #root;
  #card;
  #body;
  #questionsBox;
  #draftField;
  #sheet;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (character) => `&#${String(character.charCodeAt(0))};`);
}

customElements.define("composer-takeover", ComposerTakeover);

export { FIXTURES };
