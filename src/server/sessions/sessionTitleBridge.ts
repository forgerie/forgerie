import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export type SessionTitleBridgeEvent =
  | { type: "intent.accepted"; text: string }
  | { type: "lifecycle.reset" };

export interface SessionTitleBridgeSlot {
  setReceiver(receiver: ((event: SessionTitleBridgeEvent) => void) | undefined, onError?: (error: unknown) => void): void;
  publish(event: SessionTitleBridgeEvent): void;
  dispose(): void;
}

export function createSessionTitleBridgeSlot(): SessionTitleBridgeSlot {
  let receiver: ((event: SessionTitleBridgeEvent) => void) | undefined;
  let errorHandler: ((error: unknown) => void) | undefined;
  return {
    setReceiver(nextReceiver, nextErrorHandler) {
      receiver = nextReceiver;
      errorHandler = nextErrorHandler;
    },
    publish(event) {
      try {
        receiver?.(event);
      } catch (error: unknown) {
        try {
          errorHandler?.(error);
        } catch {
          // Diagnostics must not break Pi's extension lifecycle either.
        }
      }
    },
    dispose() {
      receiver = undefined;
      errorHandler = undefined;
    },
  };
}

export function createSessionTitleBridgeObserver(slot: SessionTitleBridgeSlot) {
  let pendingInputs: string[] = [];
  return {
    observeInput(text: string) {
      pendingInputs.push(text);
      if (pendingInputs.length > 16) pendingInputs = pendingInputs.slice(-16);
    },
    observeAcceptedPrompt(expandedText: string) {
      const acceptedInputIndex = matchingInputIndex(pendingInputs, expandedText);
      const rawText = acceptedInputIndex === -1 ? expandedText : pendingInputs[acceptedInputIndex] ?? expandedText;
      if (acceptedInputIndex !== -1) pendingInputs.splice(0, acceptedInputIndex + 1);
      slot.publish({ type: "intent.accepted", text: rawText });
    },
    reset() {
      pendingInputs = [];
      slot.publish({ type: "lifecycle.reset" });
    },
  };
}

/**
 * Observe Pi's accepted-input boundary without making title policy part of the
 * extension. Forgerie owns the policy and persistence orchestration; this
 * adapter only preserves raw user intent across skill/template expansion.
 */
function matchingInputIndex(pendingInputs: readonly string[], expandedText: string): number {
  const exactMatch = pendingInputs.indexOf(expandedText);
  if (exactMatch !== -1) return exactMatch;

  const expandedSkillName = /^<skill name="([^"]+)"(?:\s|>)/.exec(expandedText)?.[1];
  if (expandedSkillName !== undefined) {
    const skillCommand = new RegExp(`^/skill:${escapeRegex(expandedSkillName)}(?:\\s|$)`);
    const skillMatch = pendingInputs.findIndex((input) => skillCommand.test(input));
    if (skillMatch !== -1) return skillMatch;
  }
  return -1;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSessionTitleBridgeExtension(slot: SessionTitleBridgeSlot): InlineExtension {
  return {
    name: "forgerie-session-title-bridge",
    hidden: true,
    factory(pi: ExtensionAPI) {
      const observer = createSessionTitleBridgeObserver(slot);
      pi.on("input", (event) => { observer.observeInput(event.text); });
      pi.on("before_agent_start", (event) => { observer.observeAcceptedPrompt(event.prompt); });
      pi.on("session_start", () => { observer.reset(); });
      pi.on("session_shutdown", () => { observer.reset(); });
    },
  };
}
