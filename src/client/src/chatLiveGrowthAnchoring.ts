export interface LiveGrowthAnchorMeasurement {
  readonly id: string;
  /** Anchor top minus scroller top. Zero is the viewport's reading edge. */
  readonly offset: number;
}

/**
 * The nearest expanded-ledger end the reader has already scrolled past.
 *
 * An end still below the viewport is safe: appending inside that ledger grows
 * below what the reader sees. An end at or above the reading edge is the gap --
 * new rows before it would shove everything the reader is looking at down.
 */
export function selectLiveGrowthAnchor(
  measurements: readonly LiveGrowthAnchorMeasurement[],
): LiveGrowthAnchorMeasurement | undefined {
  let selected: LiveGrowthAnchorMeasurement | undefined;
  for (const measurement of measurements) {
    if (measurement.offset > 0) continue;
    if (selected === undefined || measurement.offset > selected.offset) selected = measurement;
  }
  return selected;
}

/** Scroll correction that leaves the expanded ledger's end at its old offset. */
export function scrollDeltaForLiveGrowth(currentOffset: number, previousOffset: number): number {
  return currentOffset - previousOffset;
}
