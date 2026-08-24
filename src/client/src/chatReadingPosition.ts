import { CHAT_SCROLL_BOTTOM_THRESHOLD, isNearScrollBottom } from "./chatScrollPosition";
import type { ChatLine, ChatPart } from "./components/shared";

export interface ChatReadingIdentity {
  readonly machineId: string;
  readonly cwd: string;
  readonly sessionId: string;
}

export interface ChatAnchorReadingPosition {
  readonly kind: "anchor";
  readonly anchorId: string;
  readonly offset: number;
}

export interface ChatReadingViewport {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom">;
}

export interface ChatReadingAnchor {
  readonly dataset: {
    readonly scrollAnchorId?: string | undefined;
    readonly scrollAnchorAliases?: string | undefined;
  };
  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom">;
}

export interface ChatReadingPositionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ChatReadingPositionSaveResult = "saved" | "skipped";
export type ChatReadingPositionRestoreResult =
  | { readonly status: "bottom" | "restored" | "skipped" }
  | { readonly status: "missing"; readonly position: ChatAnchorReadingPosition };

const STORAGE_PREFIX = "forgerie.chat-reading-position.v1:";

const browserSessionStorage: ChatReadingPositionStorage = {
  getItem(key: string): string | null {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(key);
  },
};

/** Keeps one anchor-relative transcript position per session in this browser window. */
export class SessionStorageChatReadingPositionStore {
  constructor(private readonly storage: ChatReadingPositionStorage = browserSessionStorage) {}

  remember(
    identity: ChatReadingIdentity,
    scroller: ChatReadingViewport | undefined,
    anchors: readonly ChatReadingAnchor[],
  ): ChatReadingPositionSaveResult {
    if (!validIdentity(identity) || scroller === undefined || !hasUsableReadingViewport(scroller)) return "skipped";
    try {
      if (isNearScrollBottom(scroller, CHAT_SCROLL_BOTTOM_THRESHOLD)) {
        this.storage.removeItem(chatReadingPositionStorageKey(identity));
        return "saved";
      }
      const anchor = findVisibleReadingAnchor(scroller, anchors);
      if (anchor === undefined) return "skipped";
      const position = captureReadingPosition(scroller, anchor);
      this.storage.setItem(chatReadingPositionStorageKey(identity), JSON.stringify(position));
      return "saved";
    } catch {
      return "skipped";
    }
  }

  read(identity: ChatReadingIdentity): ChatAnchorReadingPosition | undefined {
    if (!validIdentity(identity)) return undefined;
    try {
      const raw = this.storage.getItem(chatReadingPositionStorageKey(identity));
      if (raw === null || raw === "") return undefined;
      const parsed: unknown = JSON.parse(raw);
      return isChatAnchorReadingPosition(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  forget(identity: ChatReadingIdentity): void {
    if (!validIdentity(identity)) return;
    try {
      this.storage.removeItem(chatReadingPositionStorageKey(identity));
    } catch {
      // Storage failure must not stop transcript navigation.
    }
  }

  restore(
    position: ChatAnchorReadingPosition,
    scroller: ChatReadingViewport | undefined,
    anchors: readonly ChatReadingAnchor[],
    options: { readonly fallbackToBottom?: boolean | undefined } = {},
  ): ChatReadingPositionRestoreResult {
    if (scroller === undefined || !hasUsableReadingViewport(scroller)) return { status: "skipped" };
    const matches = anchors.filter((candidate) => readingAnchorMatches(position.anchorId, candidate));
    const anchor = liveBashAnchor(position.anchorId) ? matches.at(-1) : matches[0];
    if (anchor === undefined) {
      if (options.fallbackToBottom === false) return { status: "missing", position };
      scroller.scrollTop = scroller.scrollHeight;
      return { status: "bottom" };
    }
    const currentOffset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += currentOffset - position.offset;
    return { status: "restored" };
  }
}

export function chatReadingPositionStorageKey(identity: ChatReadingIdentity): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(JSON.stringify([identity.machineId, identity.cwd, identity.sessionId]))}`;
}

export function captureReadingPosition(scroller: ChatReadingViewport, anchor: ChatReadingAnchor): ChatAnchorReadingPosition {
  return {
    kind: "anchor",
    anchorId: anchor.dataset.scrollAnchorId ?? "",
    offset: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
  };
}

export function findVisibleReadingAnchor<Anchor extends ChatReadingAnchor>(
  scroller: ChatReadingViewport,
  anchors: readonly Anchor[],
): Anchor | undefined {
  const scrollerRect = scroller.getBoundingClientRect();
  let nearestAbove: Anchor | undefined;
  let nearestAboveOffset = Number.NEGATIVE_INFINITY;
  let nearestBelow: Anchor | undefined;
  let nearestBelowOffset = Number.POSITIVE_INFINITY;

  for (const anchor of anchors) {
    if (anchor.dataset.scrollAnchorId === undefined || anchor.dataset.scrollAnchorId === "") continue;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= rect.top || rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;
    const offset = rect.top - scrollerRect.top;
    if (offset <= 0 && offset >= nearestAboveOffset) {
      nearestAbove = anchor;
      nearestAboveOffset = offset;
    } else if (offset > 0 && offset < nearestBelowOffset) {
      nearestBelow = anchor;
      nearestBelowOffset = offset;
    }
  }

  return nearestAbove ?? nearestBelow;
}

export function hasUsableReadingViewport(viewport: Pick<ChatReadingViewport, "clientHeight" | "scrollHeight">): boolean {
  return viewport.clientHeight > 0 && viewport.scrollHeight > 0;
}

/** Stable identity for lines whose live and hydrated forms can be matched without array indexes. */
export function chatLineReadingAnchorToken(message: ChatLine): string | undefined {
  for (const part of message.parts) {
    if ((part.type === "toolCall" || part.type === "toolExecution" || part.type === "toolResult" || part.type === "skillRead")
      && part.toolCallId !== undefined
      && part.toolCallId !== "") return `tool:${encodeURIComponent(part.toolCallId)}`;
    if (part.type === "askUserRecord") return `ask:${encodeURIComponent(part.outcome.askId)}`;
  }
  if (message.role === "user") return `user:${messageFingerprint(message)}`;
  if (message.role === "bash") {
    const commandHash = hashText(bashCommandText(message));
    return message.meta?.timestamp === undefined
      ? `bash:${commandHash}`
      : `bash:${commandHash}:${encodeURIComponent(message.meta.timestamp)}`;
  }
  return undefined;
}

function messageFingerprint(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const content = message.promptText === undefined
    ? message.parts.map(readingPartText).join("\u001f")
    : boundedFingerprintText(message.promptText);
  return `${timestamp === undefined ? "" : `${encodeURIComponent(timestamp)}:`}${hashText(content)}`;
}

function readingPartText(part: ChatPart): string {
  if (part.type === "text" || part.type === "thinking") return `${part.type}:${boundedFingerprintText(part.text)}`;
  if (part.type === "image") return `image:${part.mimeType}:${boundedFingerprintText(part.data)}`;
  if (part.type === "skillInvocation") return `skill:${part.name}:${part.location}:${boundedFingerprintText(part.content)}`;
  if (part.type === "skillRead") return `skill-read:${part.name}:${part.path}`;
  if (part.type === "processNotification") return `process:${part.processName}:${part.kind}:${boundedFingerprintText(part.rawContent)}`;
  return part.type;
}

function bashCommandText(message: ChatLine): string {
  const text = message.parts.find((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")?.text ?? "";
  return text.split("\n").find((line) => line.startsWith("$ ")) ?? "";
}

function boundedFingerprintText(value: string): string {
  if (value.length <= 512) return value;
  return `${String(value.length)}:${value.slice(0, 256)}:${value.slice(-256)}`;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function readingAnchorMatches(savedId: string, candidate: ChatReadingAnchor): boolean {
  const ids = [candidate.dataset.scrollAnchorId, ...readingAnchorAliases(candidate.dataset.scrollAnchorAliases)];
  return ids.some((candidateId) => candidateId === savedId
    || (liveBashAnchor(savedId) && candidateId?.startsWith(`${savedId}:`) === true));
}

function readingAnchorAliases(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value !== "") : [];
  } catch {
    return [];
  }
}

function liveBashAnchor(anchorId: string): boolean {
  const parts = anchorId.split(":");
  return parts.length === 3 && parts[1] === "bash" && parts[2] !== "";
}

function validIdentity(identity: ChatReadingIdentity): boolean {
  return identity.sessionId !== "";
}

function isChatAnchorReadingPosition(value: unknown): value is ChatAnchorReadingPosition {
  if (typeof value !== "object" || value === null) return false;
  return Reflect.get(value, "kind") === "anchor"
    && typeof Reflect.get(value, "anchorId") === "string"
    && Reflect.get(value, "anchorId") !== ""
    && typeof Reflect.get(value, "offset") === "number"
    && Number.isFinite(Reflect.get(value, "offset"));
}
