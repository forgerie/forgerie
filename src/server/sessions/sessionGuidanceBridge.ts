import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { normalizeSessionGuidanceIds } from "../../shared/sessionGuidance.js";
import { restoreSessionGuidance, sessionGuidancePromptBlock } from "./sessionGuidance.js";

export interface SessionGuidanceSlot {
  replace(activeIds: readonly string[]): void;
  snapshot(): string[];
  dispose(): void;
}

export function createSessionGuidanceSlot(): SessionGuidanceSlot {
  let activeIds: string[] = [];
  return {
    replace(nextActiveIds) {
      activeIds = normalizeSessionGuidanceIds(nextActiveIds);
    },
    snapshot() {
      return [...activeIds];
    },
    dispose() {
      activeIds = [];
    },
  };
}

export function createSessionGuidanceBridgeHandlers(slot: SessionGuidanceSlot) {
  return {
    sessionStart(getEntries: () => readonly unknown[]) {
      slot.replace([]);
      slot.replace(restoreSessionGuidance(getEntries()));
    },
    beforeAgentStart(systemPrompt: string): { systemPrompt: string } | undefined {
      const block = sessionGuidancePromptBlock(slot.snapshot());
      if (block === undefined) return undefined;
      return { systemPrompt: `${systemPrompt}\n\n${block}` };
    },
    sessionShutdown() {
      slot.replace([]);
    },
  };
}

export function createSessionGuidanceBridgeExtension(slot: SessionGuidanceSlot): InlineExtension {
  return {
    name: "forgerie-session-guidance-bridge",
    hidden: true,
    factory(pi: ExtensionAPI) {
      const handlers = createSessionGuidanceBridgeHandlers(slot);
      pi.on("session_start", (_event, context) => {
        handlers.sessionStart(() => context.sessionManager.getEntries());
      });
      pi.on("before_agent_start", (event) => handlers.beforeAgentStart(event.systemPrompt));
      pi.on("session_shutdown", () => {
        handlers.sessionShutdown();
      });
    },
  };
}
