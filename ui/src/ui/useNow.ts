import { useEffect, useState } from "react";

/**
 * The time, for a countdown to `until`. It ticks once a second only while there is a wait to count, so a view with
 * nothing to count does not render each second. A new `until` restarts the tick at once.
 */
export function useNow(clockNow: () => number, until: number | undefined): number {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    if (until === undefined) return;
    setNow(clockNow());
    const timer = setInterval(() => setNow(clockNow()), 1000);
    return () => clearInterval(timer);
  }, [clockNow, until]);
  return now;
}
