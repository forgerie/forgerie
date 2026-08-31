/**
 * The composer that becomes the ask tool.
 *
 * One input surface. In `draft` mode it is the normal message composer. When a
 * question set opens it morphs in place: same element, same position, new job.
 * There is never a second place to type.
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
        <div class="ct-ask" hidden>
          <div class="ct-head">
            <span class="ct-badge">Answer to continue</span>
            <span class="ct-readout" role="status" aria-live="polite"></span>
          </div>
          <div class="ct-body">
            <div class="ct-prompt">
              <p class="ct-question"></p>
              <p class="ct-detail"></p>
              <button class="ct-detail-btn" type="button" aria-label="Show detail">i</button>
            </div>
            <div class="ct-options" role="group"></div>
            <div class="ct-free">
              <textarea class="ct-free-field" rows="2" maxlength="4000"
                placeholder="Write my own answer"></textarea>
            </div>
          </div>
          <div class="ct-foot">
            <div class="ct-pager">
              <button class="ct-page-prev" type="button" aria-label="Previous question">&lsaquo;</button>
              <span class="ct-page-label"></span>
              <button class="ct-page-next" type="button" aria-label="Next question">&rsaquo;</button>
            </div>
            <span class="ct-draft-chip" hidden>Draft saved</span>
            <button class="ct-skip" type="button">Skip</button>
            <button class="ct-more" type="button" aria-haspopup="menu">More</button>
            <button class="ct-submit ct-primary" type="button">Send answers</button>
          </div>
        </div>

        <div class="ct-draft">
          <textarea class="ct-draft-field" rows="1" placeholder="Message the agent"></textarea>
          <button class="ct-send ct-primary" type="button">Send</button>
        </div>
      </div>

      <div class="ct-sheet" popover="auto">
        <p class="ct-sheet-title"></p>
        <div class="ct-sheet-body"></div>
      </div>
    `;

    this.#root = this.querySelector(".ct");
    this.#draftField = this.querySelector(".ct-draft-field");
    this.#freeField = this.querySelector(".ct-free-field");
    this.#optionsBox = this.querySelector(".ct-options");
    this.#sheet = this.querySelector(".ct-sheet");

    this.querySelector(".ct-page-prev").addEventListener("click", () => { this.#turnPage(-1); });
    this.querySelector(".ct-page-next").addEventListener("click", () => { this.#turnPage(1); });
    this.querySelector(".ct-submit").addEventListener("click", () => { this.#submit(); });
    this.querySelector(".ct-skip").addEventListener("click", () => { this.#turnPage(1, true); });
    this.querySelector(".ct-more").addEventListener("click", (event) => { this.#openOverflow(event); });
    this.querySelector(".ct-detail-btn").addEventListener("click", () => { this.#openDetail(); });
    this.#body = this.querySelector(".ct-body");
    // A capped region that scrolls must say so. Without this the content simply
    // stops at the budget line and reads as clipped, which is the failure the
    // whole exercise is meant to avoid.
    this.#body.addEventListener("scroll", () => { this.#syncScrollHint(); }, { passive: true });
    this.#freeField.addEventListener("input", () => { this.#recordFreeText(); });
    this.#optionsBox.addEventListener("click", (event) => { this.#toggleOption(event); });
    // Delegated so per-question fields survive a rebuild without rebinding.
    this.#optionsBox.addEventListener("input", (event) => { this.#recordBlockText(event); });
  }

  /**
   * Measure the container, never the window. The composer's own slot decides
   * width; the app frame's live height decides structure, which is what makes
   * the keyboard opening a layout input rather than a scroll problem.
   */
  #observe() {
    const slot = this.parentElement ?? this;
    const observer = new ResizeObserver(() => { this.#render(); });
    observer.observe(slot);
    const frame = this.closest(".frame") ?? document.documentElement;
    observer.observe(frame);
  }

  #render() {
    const slot = this.parentElement ?? this;
    const width = Math.round(slot.getBoundingClientRect().width);
    const frame = this.closest(".frame") ?? document.documentElement;
    const height = Math.round(frame.getBoundingClientRect().height);

    this.#root.dataset.mode = this.#mode;
    this.querySelector(".ct-ask").hidden = this.#mode !== "ask";
    this.querySelector(".ct-draft").hidden = this.#mode === "ask";
    if (this.#mode !== "ask") {
      this.#root.style.removeProperty("--ct-budget");
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
    this.#root.style.setProperty("--ct-budget", `${String(layout.heightBudget)}px`);
    this.#root.style.setProperty("--ct-track", `${String(layout.optionTrack)}px`);

    this.#renderQuestions(layout);
    this.#renderStatus(layout);
    this.#syncScrollHint();
    this.#reportPlan(layout, width, height);
  }

  /**
   * Rebuild the question DOM only when the visible set changes. Re-rendering on
   * every resize would drop the caret out of the free-text field mid-rotation.
   */
  #renderQuestions(layout) {
    const visible = layout.paged ? [this.#questions[this.#page]] : this.#questions;
    const signature = `${layout.paged ? String(this.#page) : "all"}:${String(this.#questions.length)}`;
    if (this.#built !== signature) {
      this.#built = signature;
      this.#optionsBox.innerHTML = visible
        .map((question, index) => this.#questionMarkup(question, layout.paged ? this.#page : index))
        .join("");
    }
    this.#syncSelection();

    const head = visible[0];
    this.querySelector(".ct-question").textContent = layout.paged ? head.question : "Questions";
    const detail = this.querySelector(".ct-detail");
    detail.textContent = layout.paged ? (head.detail ?? "") : "";
    detail.hidden = !layout.paged || head.detail === undefined || layout.detail !== "inline";
    this.querySelector(".ct-detail-btn").hidden = !(layout.detail === "popover" && head.detail !== undefined);
    this.#freeField.value = this.#answers.get(this.#currentQuestion().id)?.otherText ?? "";
  }

  #questionMarkup(question, index) {
    const type = question.multiple === true ? "checkbox" : "radio";
    const options = question.options
      .map(
        (option) => `
        <button class="ct-option" type="button" role="${type}" aria-checked="false"
          data-question="${question.id}" data-value="${option.value}"
          data-multiple="${String(question.multiple === true)}">
          <span class="ct-option-label">${escapeHtml(option.label)}</span>
          ${option.detail === undefined ? "" : `<span class="ct-option-detail">${escapeHtml(option.detail)}</span>`}
        </button>`,
      )
      .join("");
    return `
      <section class="ct-question-block" data-question="${question.id}">
        <p class="ct-question-inline"><span class="ct-num">${String(index + 1)}.</span>${escapeHtml(question.question)}</p>
        ${question.detail === undefined ? "" : `<p class="ct-question-detail">${escapeHtml(question.detail)}</p>`}
        <div class="ct-option-band">${options}</div>
        <textarea class="ct-block-free" data-question="${question.id}" rows="1" maxlength="4000"
          placeholder="Write my own answer"></textarea>
      </section>`;
  }

  #syncSelection() {
    for (const button of this.#optionsBox.querySelectorAll(".ct-option")) {
      const chosen = this.#answers.get(button.dataset.question)?.values ?? new Set();
      button.setAttribute("aria-checked", String(chosen.has(button.dataset.value)));
    }
    for (const field of this.#optionsBox.querySelectorAll(".ct-block-free")) {
      if (field === document.activeElement) continue;
      field.value = this.#answers.get(field.dataset.question)?.otherText ?? "";
    }
  }

  #renderStatus(layout) {
    const answered = [...this.#answers.values()].filter(
      (answer) => answer.values.size > 0 || (answer.otherText ?? "") !== "",
    ).length;
    const total = this.#questions.length;
    const readout = this.querySelector(".ct-readout");
    readout.textContent =
      layout.readout === "full"
        ? `${String(answered)} of ${String(total)} answered`
        : layout.readout === "short"
          ? `${String(answered)}/${String(total)}`
          : "";
    this.querySelector(".ct-page-label").textContent = layout.paged
      ? `${String(this.#page + 1)} / ${String(total)}`
      : "";
    this.querySelector(".ct-draft-chip").hidden = this.#stashedDraft === "";
    // Only name the blanks once the user has actually answered something.
    // Labelling an untouched set "Send blank" reads as a warning about a choice
    // nobody has made yet, and the readout beside it already says 0 of 3.
    const blank = total - answered;
    this.querySelector(".ct-submit").textContent =
      blank > 0 && answered > 0 ? `Send (${String(blank)} blank)` : "Send answers";
  }

  #currentQuestion() {
    return this.#questions[this.#plan?.paged === true ? this.#page : 0] ?? this.#questions[0];
  }

  #toggleOption(event) {
    const button = event.target.closest(".ct-option");
    if (button === null) return;
    const id = button.dataset.question;
    const value = button.dataset.value;
    const multiple = button.dataset.multiple === "true";
    const answer = this.#answers.get(id) ?? { values: new Set(), otherText: "" };
    if (multiple) {
      if (answer.values.has(value)) answer.values.delete(value);
      else answer.values.add(value);
    } else {
      answer.values = answer.values.has(value) ? new Set() : new Set([value]);
    }
    this.#answers.set(id, answer);
    this.#syncSelection();
    this.#renderStatus(this.#plan);
  }

  #recordBlockText(event) {
    const field = event.target.closest(".ct-block-free");
    if (field === null) return;
    const answer = this.#answers.get(field.dataset.question) ?? { values: new Set(), otherText: "" };
    answer.otherText = field.value;
    this.#answers.set(field.dataset.question, answer);
    this.#renderStatus(this.#plan);
  }

  #recordFreeText() {
    const id = this.#currentQuestion().id;
    const answer = this.#answers.get(id) ?? { values: new Set(), otherText: "" };
    answer.otherText = this.#freeField.value;
    this.#answers.set(id, answer);
    this.#renderStatus(this.#plan);
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
   * The overflow menu opens in the top layer, not inside the composer. A strip
   * 150px tall cannot contain a usable menu, and does not need to: it only
   * needs to summon one with full-size targets.
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
       <button class="ct-sheet-done ct-primary" type="button">Done</button>`;
    const field = this.#sheet.querySelector(".ct-sheet-field");
    field.value = this.#answers.get(question.id)?.otherText ?? "";
    field.addEventListener("input", () => {
      const answer = this.#answers.get(question.id) ?? { values: new Set(), otherText: "" };
      answer.otherText = field.value;
      this.#answers.set(question.id, answer);
      this.#renderStatus(this.#plan);
    });
    this.#sheet.querySelector(".ct-sheet-done").addEventListener("click", () => { this.#sheet.hidePopover(); });
    field.focus();
  }

  #openDetail() {
    const question = this.#currentQuestion();
    this.querySelector(".ct-sheet-title").textContent = question.question;
    this.querySelector(".ct-sheet-body").innerHTML = `<p class="ct-sheet-text">${escapeHtml(question.detail ?? "")}</p>`;
    this.#sheet.showPopover();
  }

  #syncScrollHint() {
    requestAnimationFrame(() => {
      const box = this.#body;
      const room = box.scrollHeight - box.clientHeight;
      this.#root.dataset.overflowing = String(room > 2);
      this.#root.dataset.atEnd = String(room <= 2 || box.scrollTop >= room - 2);
    });
  }

  #reportPlan(layout, width, height) {
    this.dispatchEvent(
      new CustomEvent("plan-changed", { detail: { plan: layout, width, height }, bubbles: true }),
    );
  }

  #root;
  #body;
  #draftField;
  #freeField;
  #optionsBox;
  #sheet;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (character) => `&#${String(character.charCodeAt(0))};`);
}

customElements.define("composer-takeover", ComposerTakeover);

export { FIXTURES };
