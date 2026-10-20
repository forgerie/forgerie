import { describe, expect, it } from "vitest";
import hljs from "./codeGrammars";
import { codeLanguageName } from "./codeLanguageNames";
import { codeFenceTag, composerCodeLanguage } from "./composerCodeLanguage";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

describe("lightweight code language registry", () => {
  it("recognizes every full-build grammar and alias, including mixed case", () => {
    for (const id of hljs.listLanguages()) {
      for (const label of [id, ...(hljs.getLanguage(id)?.aliases ?? [])]) {
        const name = hljs.getLanguage(label)?.name ?? "";
        expect(codeLanguageName(label), label).toBe(name);
        expect(codeLanguageName(label.toUpperCase()), label).toBe(name);
      }
    }
  });

  it("keeps the composer's grammar choice for every supported label", () => {
    for (const id of hljs.listLanguages()) {
      for (const label of [id, ...(hljs.getLanguage(id)?.aliases ?? [])]) {
        // Preserve the existing info-string parser too (for example c# parses as c).
        const tag = codeFenceTag(label)!;
        const known = hljs.getLanguage(tag);
        const expected = known ? LanguageDescription.matchLanguageName(languages, tag, false)
          ?? LanguageDescription.matchLanguageName(languages, known.name ?? "", false) : null;
        expect(composerCodeLanguage(tag), label).toBe(expected);
      }
    }
  });

  it.each(["", "javascript-extra", "not-a-language", "constructor", "__proto__", "toString"])("does not guess a grammar for %j", (label) => {
    expect(codeLanguageName(label)).toBeUndefined();
    expect(composerCodeLanguage(label)).toBeNull();
  });
});
