import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

export const PROMPT_DIFF_ANNOTATION_LIMITS = {
  annotations: 16,
  linesPerAnnotation: 200,
  pathChars: 1024,
  commentChars: 4096,
  lineChars: 4096,
  totalChars: 64 * 1024,
} as const;

const lineNumber = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const lineText = Type.String({ maxLength: PROMPT_DIFF_ANNOTATION_LIMITS.lineChars, pattern: "^[^\\n\\r\\u0000]*(?![\\s\\S])" });

const DiffAnnotationLineSchema = Type.Union([
  Type.Object({ kind: Type.Literal("context"), oldLineNumber: lineNumber, newLineNumber: lineNumber, text: lineText }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("add"), newLineNumber: lineNumber, text: lineText }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("remove"), oldLineNumber: lineNumber, text: lineText }, { additionalProperties: false }),
]);

export const PromptDiffAnnotationsSchema = Type.Array(Type.Object({
  // Paths describe captured code; they never authorize filesystem reads.
  path: Type.String({
    minLength: 1,
    maxLength: PROMPT_DIFF_ANNOTATION_LIMITS.pathChars,
    pattern: "^(?![A-Za-z]:)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/\\\\\\u0000-\\u001f\\u007f]+(?:/[^/\\\\\\u0000-\\u001f\\u007f]+)*(?![\\s\\S])",
  }),
  staged: Type.Boolean(),
  comment: Type.String({ minLength: 1, maxLength: PROMPT_DIFF_ANNOTATION_LIMITS.commentChars, pattern: "\\S" }),
  lines: Type.Array(DiffAnnotationLineSchema, { minItems: 1, maxItems: PROMPT_DIFF_ANNOTATION_LIMITS.linesPerAnnotation }),
}, { additionalProperties: false }), { maxItems: PROMPT_DIFF_ANNOTATION_LIMITS.annotations });

export type PromptDiffAnnotation = Static<typeof PromptDiffAnnotationsSchema>[number];

/** Validate the entire batch before any prompt or session mutation occurs. */
export function parsePromptDiffAnnotations(value: unknown): PromptDiffAnnotation[] {
  if (value === undefined) return [];
  if (!Check(PromptDiffAnnotationsSchema, value)) throw new Error("Invalid diffAnnotations: expected bounded paths, comments, and positioned diff lines.");
  let total = 0;
  for (const annotation of value) {
    total += annotation.path.length + annotation.comment.length;
    let previousOld = 0;
    let previousNew = 0;
    for (const line of annotation.lines) {
      total += line.text.length;
      if ("oldLineNumber" in line) {
        if (line.oldLineNumber <= previousOld) throw new Error("Invalid diffAnnotations: old line numbers must increase.");
        previousOld = line.oldLineNumber;
      }
      if ("newLineNumber" in line) {
        if (line.newLineNumber <= previousNew) throw new Error("Invalid diffAnnotations: new line numbers must increase.");
        previousNew = line.newLineNumber;
      }
    }
    if (total > PROMPT_DIFF_ANNOTATION_LIMITS.totalChars) throw new Error("Invalid diffAnnotations: combined content exceeds 65536 characters.");
  }
  return value;
}
