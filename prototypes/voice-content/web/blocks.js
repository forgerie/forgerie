// PROTOTYPE block bodies. Content rendering only. Each variant owns its layout.

import { el } from "./dom.js";

export const CONTENT_KINDS = new Set(["say", "files", "table", "diff", "error", "question", "answer", "prompt"]);

export function isContent(block) {
  return CONTENT_KINDS.has(block.kind);
}

/** Short and kind-based on purpose: the rail is 4 characters wide, not a title. */
export function blockLabel(block) {
  switch (block.kind) {
    case "prompt":
      return "you";
    case "tool":
      return block.name;
    case "table":
      return "table";
    case "diff":
      return "diff";
    case "files":
      return "files";
    case "error":
      return "error";
    case "question":
      return "choice";
    case "answer":
      return "answer";
    default:
      return "note";
  }
}

export function blockBody(block, { onAnswer } = {}) {
  switch (block.kind) {
    case "prompt":
    case "say":
      return el("p", { class: "prose", text: block.text });

    case "tool":
      return el(
        "div",
        { class: "tool" },
        el("span", { class: "tool-name", text: block.name }),
        el("code", { class: "tool-target", text: block.target }),
        block.meta ? el("span", { class: "tool-meta", text: block.meta }) : undefined,
      );

    case "files":
      return el(
        "div",
        { class: "stack" },
        block.title ? el("div", { class: "block-title", text: block.title }) : undefined,
        el(
          "ul",
          { class: "files" },
          ...(block.items ?? []).map((item) =>
            el("li", {}, el("code", { text: item.path }), item.note ? el("span", { class: "note", text: item.note }) : undefined),
          ),
        ),
      );

    case "table":
      return el(
        "div",
        { class: "stack" },
        block.title ? el("div", { class: "block-title", text: block.title }) : undefined,
        el(
        "div",
        { class: "table-scroll" },
        el(
        "table",
        { class: "grid" },
        el("thead", {}, el("tr", {}, ...(block.columns ?? []).map((column) => el("th", { text: column })))),
        el(
          "tbody",
          {},
          ...(block.rows ?? []).map((row) =>
            el("tr", {}, ...row.map((cell) => el("td", { class: cellClass(cell), text: cell }))),
          ),
        ),
        ),
        ),
      );

    case "diff":
      return el(
        "div",
        { class: "diff" },
        el("div", { class: "diff-file", text: block.file }),
        el(
          "pre",
          {},
          ...(block.hunks ?? []).map((hunk) =>
            el("span", { class: `hunk hunk-${hunk.sign === "+" ? "add" : hunk.sign === "-" ? "cut" : "same"}` }, `${hunk.sign}${hunk.text}\n`),
          ),
        ),
      );

    case "error":
      return el(
        "div",
        { class: "stack" },
        block.title ? el("div", { class: "block-title", text: block.title }) : undefined,
        el("pre", { class: "error", text: block.text }),
      );

    case "question":
      return el(
        "div",
        { class: "choice" },
        el("p", { class: "prose", text: block.text }),
        el(
          "div",
          { class: "options" },
          ...(block.options ?? []).map((option) =>
            el(
              "button",
              { class: "option", type: "button", onclick: () => onAnswer?.(option.id) },
              el("span", { class: "option-label", text: option.label }),
              option.detail ? el("span", { class: "option-detail", text: option.detail }) : undefined,
            ),
          ),
        ),
      );

    case "answer":
      return el(
        "div",
        { class: "answer" },
        el("p", { class: "prose lead", text: block.text }),
        el("ul", { class: "bullets" }, ...(block.bullets ?? []).map((bullet) => el("li", { text: bullet }))),
      );

    default:
      return el("p", { class: "prose", text: block.text ?? "" });
  }
}

function cellClass(cell) {
  const value = String(cell).toLowerCase();
  if (value === "pass") return "cell pass";
  if (value === "fail") return "cell fail";
  return "cell";
}
