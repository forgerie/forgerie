import { useModelChains } from "./modelPrefsApi";
import { ChainWaitStatus } from "./ChainWaitStatus";
import { nextChainEntry, type ChainWaitView } from "./chainWait";

/** Binding: a session's chain wait, with the next model read from the app's chains. */
export function ChainWait({ wait, chain, models, onStop }: ChainWaitView) {
  const chains = useModelChains();
  return <ChainWaitStatus wait={wait} next={nextChainEntry(chains, chain, wait.from)} models={models} onStop={onStop} />;
}
