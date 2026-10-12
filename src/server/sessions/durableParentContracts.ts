import type { SessionTreeSnapshot } from "../../shared/apiTypes.js";
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
