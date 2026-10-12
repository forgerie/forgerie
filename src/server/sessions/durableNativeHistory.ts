import type { Context } from "@earendil-works/chord";
import type { SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { DurableEntryTarget, DurableSessionHandle } from "./durableSessionAddress.js";

export interface DurableNativeHistory {
  tree(context: Context): Promise<SessionTreeSnapshot>;
  resolve(entryId: string, context: Context): Promise<DurableEntryTarget>;
  fork(
    entryId: string,
    position: "before" | "at",
    newSessionId: string,
    context: Context,
  ): Promise<{ handle: DurableSessionHandle; selectedText?: string }>;
  select(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string },
    context: Context,
  ): Promise<{
    handle: DurableSessionHandle;
    cancelled: boolean;
    editorText?: string;
  }>;
}
