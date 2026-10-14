import { expect, it } from "vitest";
import { closeIssueTitle, issueTitleSearchTerms } from "./fileIssues.js";

it("normalizes Unicode, case and punctuation before comparing titles", () => {
  expect(closeIssueTitle("Ｆｉｘ: PORTAL reconnect!", "portal reconnect")).toBe(true);
  expect(issueTitleSearchTerms("Ｆｉｘ: PORTAL reconnect!")).toEqual(["reconnect"]);
  expect(issueTitleSearchTerms("???")).toEqual([]);
});

it("searches a shared word for every close title, including omitted words and added words", () => {
  const source = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  for (let n = 1; n <= source.length; n++) {
    const words = source.slice(0, n);
    const title = words.join(" ");
    const terms = issueTitleSearchTerms(title);
    for (let mask = 0; mask < 2 ** n; mask++) {
      const subset = words.filter((_, i) => (mask & (1 << i)) !== 0);
      for (let extras = 0; extras <= 4; extras++) {
        const candidate = [...subset, ...Array.from({ length: extras }, (_, i) => `extra${String(i)}`)].join(" ");
        if (closeIssueTitle(title, candidate)) expect(terms.some(term => subset.includes(term)), `${title} vs ${candidate}`).toBe(true);
      }
    }
  }
});

it.each(["Bug: ", "feat: ", "fix: ", "chore: ", "docs: ", "[bug] ", "bug - ", "feat(ui): ", "feat(ui)!: ", "[bug] feat(ui): "])("strips classification prefixes before comparing and searching: %s", prefix => {
  expect(closeIssueTitle(`${prefix}Fix portal`, "Fix portal")).toBe(true);
  expect(closeIssueTitle("Fix portal", `${prefix}Fix portal`)).toBe(true);
  expect(issueTitleSearchTerms(`${prefix}Fix portal`)).toEqual(issueTitleSearchTerms("Fix portal"));
});
it("matches short word sets regardless of order or repetition, without conflating different work", () => {
  expect(closeIssueTitle("Reconnect portal", "Portal reconnect")).toBe(true);
  expect(closeIssueTitle("Portal reconnect", "Reconnect portal portal")).toBe(true);
  expect(closeIssueTitle("Fix portal", "Fix picker")).toBe(false);
});
