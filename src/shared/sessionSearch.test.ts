import { describe, expect, it } from "vitest";
import { searchQueryTerms } from "./sessionSearch.js";

describe("session search query terms", () => {
  it.each<[string, string[]]>([
    ["", []],
    ["a\u00a0bcd\tEFG", ["bcd", "efg"]],
    ["Deploy DEPLOY retry deploy", ["deploy", "retry"]],
    ['"cold store" retry', ["cold store", "retry"]],
    ['"say ""hi"" now"', ['say "hi" now']],
    ['ab""cd', ["abcd"]],
    ['retry "un closed', ["retry", "un closed"]],
    ['ab"c d', ["abc d"]],
    ['"""abc', ['"abc']],
    ['"   "', ["   "]],
    ["😊😊", []],
    ["😊😊😊", ["😊😊😊"]],
    ["İİ", []],
    ["İİİ", ["i\u0307i\u0307i\u0307"]],
  ])("parses %j into %j", (query, terms) => {
    expect(searchQueryTerms(query)).toEqual(terms);
  });
});
