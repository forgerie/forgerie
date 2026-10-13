import { AlertCard } from "../ui/AlertCard";

/**
 * Shape: the gated actions could not be read, said in the dock under the cards it concerns, so a short
 * dock still shows the first card's choices. The cards come from the transcript, so one may already be decided; Retry
 * reads them again.
 */
export function GatedActionsReadProblem({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <AlertCard tone="warn" label="Gated actions could not be read" title="Gated actions could not be read" actions={[{ label: "Retry", onPress: onRetry }]}>
    <p>{error} The cards above come from the transcript, so one of them may already be decided.</p>
  </AlertCard>;
}
