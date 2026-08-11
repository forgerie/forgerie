import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

const SESSION_NAME_TIMEOUT_MS = 10_000;
const SESSION_NAME_MAX_INPUT_CHARS = 4_000;
const SESSION_NAME_MAX_LENGTH = 60;
const SESSION_NAME_MAX_WORDS = 4;
const FALLBACK_FILLER_WORDS = new Set([
  "a", "an", "about", "can", "check", "could", "explore", "fix", "help", "i", "implement", "investigate", "me", "my", "now", "our", "please", "the", "to", "understand", "update", "we", "with", "would", "you", "your",
]);
const RELAY_HANDOFF_FIRST_LINE = /^Relay\s+"([^"\n]+)"\s+leg\s+(\d+)\s+begins now\.?\s*(?:\n|$)/;
const SKILL_COMMAND = /^\/skill:([a-z0-9][a-z0-9_-]*)\s*$/i;

export function deterministicSessionName(firstMessage: unknown): string | undefined {
  if (typeof firstMessage !== "string") return undefined;

  const input = firstMessage.trimStart();
  return skillCommandSessionName(input) ?? relayHandoffSessionName(input);
}

export async function generateShortSessionName<TApi extends Api>(streamFn: StreamFn, model: Model<TApi>, firstMessage: string, cancellationSignal?: AbortSignal): Promise<string | undefined> {
  const stream = await streamFn(
    model,
    {
      systemPrompt: "Generate a 1-4 word retrieval label for a coding-agent chat session. Maximize signal per word. Return only the label, with no quotes or punctuation wrapper.",
      messages: [{
        role: "user",
        content: `Label this request for recognition in a session list. Prefer specific names and compact noun phrases. Keep products, components, files, errors, or decisions that distinguish it. Omit framing and generic task verbs such as understand, explore, investigate, help, fix, update, and implement. Prefer 2-3 words when they remain clear; use 1 for a distinctive standalone term and 4 only when needed.\n\nRequest:\n${truncateInput(firstMessage)}`,
        timestamp: Date.now(),
      }],
    },
    {
      maxTokens: 24,
      reasoning: "minimal",
      signal: titleGenerationSignal(cancellationSignal),
    },
  );

  let streamedText = "";
  let finalMessage: AssistantMessage | undefined;
  for await (const event of stream) {
    if (event.type === "text_delta") streamedText += event.delta;
    if (event.type === "done") finalMessage = event.message;
    if (event.type === "error") return undefined;
  }

  return cleanSessionName(finalMessage === undefined ? streamedText : textFromAssistant(finalMessage));
}

export function fallbackSessionName(firstMessage: unknown): string | undefined {
  if (typeof firstMessage !== "string") return undefined;

  return cleanSessionName(firstMessage
    .replace(/<skill name="[^"]+" location="[^"]+">[\s\S]*?<\/skill>/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#[\](){}<>]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[,;:!?\x27"“”‘’]+|[,;:!?\x27"“”‘’]+$/g, ""))
    .filter((word) => word !== "" && !FALLBACK_FILLER_WORDS.has(word.toLocaleLowerCase("en-US")))
    .slice(0, SESSION_NAME_MAX_WORDS)
    .join(" "));
}

export function cleanSessionName(value: string): string | undefined {
  const title = (value.split("\n", 1)[0] ?? "")
    .replace(/^\s*(title|session title)\s*:\s*/i, "")
    .replace(/^\s*["'`]+|["'`.]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title === "" || title.split(" ").length > SESSION_NAME_MAX_WORDS) return undefined;
  return title.slice(0, SESSION_NAME_MAX_LENGTH).trim();
}

function skillCommandSessionName(firstMessage: string): string | undefined {
  const skillName = SKILL_COMMAND.exec(firstMessage)?.[1];
  if (skillName === undefined) return undefined;

  const words = skillName
    .replace(/^se-/, "")
    .split(/[-_]+/)
    .filter((word) => word !== "")
    .slice(0, SESSION_NAME_MAX_WORDS)
    .map((word) => `${word[0]?.toLocaleUpperCase("en-US") ?? ""}${word.slice(1)}`);
  return cleanSessionName(words.join(" "));
}

function relayHandoffSessionName(firstMessage: string): string | undefined {
  const match = RELAY_HANDOFF_FIRST_LINE.exec(firstMessage);
  if (match === null) return undefined;

  const relayName = match[1]?.replace(/\s+/g, " ").trim();
  const legNumber = match[2];
  if (relayName === undefined || relayName === "" || legNumber === undefined) return undefined;

  return cleanSessionName(formatRelaySessionName(relayName, legNumber));
}

function formatRelaySessionName(relayName: string, legNumber: string): string {
  const prefix = "Relay ";
  const suffix = ` leg ${legNumber}`;
  const maxRelayNameLength = Math.max(1, SESSION_NAME_MAX_LENGTH - prefix.length - suffix.length);
  const displayedRelayName = truncateRelayName(relayName, maxRelayNameLength);
  return `${prefix}${displayedRelayName}${suffix}`;
}

function truncateRelayName(relayName: string, maxLength: number): string {
  if (relayName.length <= maxLength) return relayName;
  const truncated = relayName.slice(0, maxLength).replace(/[\s._-]+$/g, "").trim();
  return truncated === "" ? relayName.slice(0, maxLength).trim() : truncated;
}

function titleGenerationSignal(cancellationSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(SESSION_NAME_TIMEOUT_MS);
  return cancellationSignal === undefined ? timeoutSignal : AbortSignal.any([cancellationSignal, timeoutSignal]);
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function truncateInput(value: string): string {
  return value.length <= SESSION_NAME_MAX_INPUT_CHARS ? value : `${value.slice(0, SESSION_NAME_MAX_INPUT_CHARS)}…`;
}
