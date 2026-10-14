import { Type, type Static } from "typebox";

export const FileIssueInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 256, pattern: "\\S" }),
  body: Type.String({ maxLength: 65_000 }),
  labels: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 50, pattern: "\\S" }), { maxItems: 20 })),
  duplicates: Type.Array(Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }), { minItems: 1, maxItems: 20, description: "The search queries you already ran over open and closed issues." }),
  notDuplicateOf: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 100, uniqueItems: true, description: "Matching issue numbers you checked and determined are different work." })),
}, { additionalProperties: false });
export type FileIssueInput = Static<typeof FileIssueInputSchema>;
const IssueMatchSchema = Type.Object({ number: Type.Integer({ minimum: 1 }), title: Type.String(), state: Type.Union([Type.Literal("open"), Type.Literal("closed")]), url: Type.String() });
export const FileIssueResultSchema = Type.Union([
  Type.Object({ state: Type.Literal("duplicate"), repo: Type.String(), matches: Type.Array(IssueMatchSchema) }),
  Type.Object({ state: Type.Literal("created"), repo: Type.String(), number: Type.Integer({ minimum: 1 }), title: Type.String(), url: Type.String(), agentFiled: Type.Boolean(), labelWarning: Type.Optional(Type.String()) }),
]);
export type FileIssueResult = Static<typeof FileIssueResultSchema>;

const CLASSIFICATION_PREFIX = /^(?:(?:bug|feat|fix|chore|docs)(?:\([^()\r\n]+\))?!?(?:\s*:|[ \t]+[-–—])\s*|\[(?:bug|feat|fix|chore|docs)\]\s*)+/u;
const titleWords = (title: string) => title.normalize("NFKC").toLowerCase().trim().replace(CLASSIFICATION_PREFIX, "").match(/[\p{L}\p{N}]+/gu) ?? [];
/** Search enough title words to intersect every possible close match. Prefer longer, less broad words. */
export function issueTitleSearchTerms(title: string): string[] {
  const words = [...new Set(titleWords(title))];
  // Dice >= 0.8 requires at least ceil(2*n/3) shared words; our rule also requires three.
  // Searching n - minimumShared + 1 words guarantees at least one appears in a close match.
  const minimumShared = Math.min(words.length, Math.max(3, Math.ceil(2 * words.length / 3)));
  return words.sort((a, b) => b.length - a.length).slice(0, words.length - minimumShared + 1);
}

/** Equal word sets after classification prefixes, or Dice >= 0.8 with at least three shared words. */
export function closeIssueTitle(left: string, right: string): boolean {
  const a = titleWords(left); const b = titleWords(right);
  if (a.length === 0 || b.length === 0) return false;
  const x = new Set(a); const y = new Set(b);
  const shared = [...x].filter(word => y.has(word)).length;
  if (shared === x.size && shared === y.size) return true;
  return shared >= 3 && 2 * shared / (x.size + y.size) >= 0.8;
}
