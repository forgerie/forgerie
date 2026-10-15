import type { SessionOpenResult } from "./sessionOpen.js";
import type { DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import type { DurableBrowserAttachment } from "./durableParentReadModel.js";
import type { SessionRef, SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { DurableSessionAddress } from "./durableSessionAddress.js";
import type { DurableNativeHistory } from "./durableNativeHistory.js";
import type { DurableParentState } from "./durableParentState.js";

/** Public parent capabilities. Reading these never starts Durable work. */
export interface DurableParentReader {
  readonly durableAddress: DurableSessionAddress;
  readonly nativeHistory: DurableNativeHistory;
  getDurableTree(): Promise<SessionTreeSnapshot>;
}

/** Public success boundaries must flush synchronous SDK mutation intents. */
export interface DurableParentMutations {
  readonly parentState: DurableParentState;
  flushDurableMutations(): Promise<void>;
}

/** Opt-in transport capability while the mixed-store reader is composed at daemon startup. */
export interface DurableBrowserSessionService {
  attachOpenBrowser?(ref: SessionRef, send: (open: SessionOpenResult) => Promise<void>, onFailure: (error: Error) => void): Promise<DurableBrowserAttachment | undefined>;
  attachDurableBrowser(ref: SessionRef, send: (snapshot: DurableBrowserSnapshot) => Promise<void>, onFailure: (error: Error) => void): Promise<DurableBrowserAttachment>;
}
