import { ErrorBoundary } from "./ErrorBoundary";
import { AlertCard } from "./AlertCard";

export const name = "Error boundary";
export const note = "A failure kept in its own place. Caught shows the fallback; React also logs the error to the console";

function Throws(): never {
  throw new Error("The reading has no providers.");
}

export default function Caught() {
  return <ErrorBoundary onError={() => {}} fallback={(message) => <AlertCard label="Meters stopped" title="Meters stopped">{message}</AlertCard>}>
    <Throws />
  </ErrorBoundary>;
}
export function Clear() {
  return <ErrorBoundary fallback={(message) => <AlertCard label="Stopped" title="Stopped">{message}</AlertCard>}>
    <p>Everything inside drew.</p>
  </ErrorBoundary>;
}
