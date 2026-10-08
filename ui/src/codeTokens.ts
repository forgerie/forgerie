import { tagHighlighter, tags } from "@lezer/highlight";

/**
 * Lezer tags onto the five code colours the theme already gives chat code
 * blocks, so a diff, a draft's code block, and a transcript code block colour
 * the same word the same way.
 */
export const codeHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom, tags.self, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword], class: "tok-keyword" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape, tags.attributeValue, tags.character, tags.url], class: "tok-string" },
  { tag: [tags.number, tags.integer, tags.float, tags.unit, tags.color], class: "tok-number" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.meta, tags.processingInstruction], class: "tok-comment" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName, tags.heading, tags.function(tags.variableName), tags.function(tags.propertyName),
    tags.definition(tags.function(tags.variableName)), tags.macroName, tags.attributeName], class: "tok-title" },
]);
