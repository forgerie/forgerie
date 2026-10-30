import type { UserInput } from "@earendil-works/pi-durable";

export function mergeAutomatedContent(first: UserInput, next: UserInput): UserInput {
  if (typeof first === "string" && typeof next === "string") return `${first}\n\n${next}`;
  return [...(typeof first === "string" ? [{ type: "text" as const, text: first }] : first),
    { type: "text", text: "\n\n" }, ...(typeof next === "string" ? [{ type: "text" as const, text: next }] : next)];
}
