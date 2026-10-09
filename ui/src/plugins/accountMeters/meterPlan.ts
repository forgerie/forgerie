import type { MeterProvider } from "./meterModel";

/**
 * How tall the meters are, in CSS pixels. These mirror the sizes in
 * ui/LaneGrid.css and ui/Shelf.css (--lane-line and its neighbours); change both together.
 */
export const METER_SIZES = { header: 36, padding: 12, line: 18, lineGap: 2, accountGap: 6, providerGap: 10, email: 18 } as const;

/**
 * The most of the room the meters share with the session list that they may
 * take. The room is what the list would have without them: the picker less
 * its header, New session, and footer. A share of the whole picker left the
 * folded landscape list 67px, about one row, because that chrome is fixed.
 * ui/Shelf.css caps the shelf at the same share (max-block-size).
 */
export const METER_SHARE = 0.5;

/** The meters' natural height for these rows. */
export function meterHeight(providers: readonly MeterProvider[], names: boolean): number {
  const size = METER_SIZES;
  let height = size.header + size.padding;
  providers.forEach((provider, providerIndex) => {
    if (providerIndex > 0) height += size.providerGap;
    // A provider with no accounts still prints its name on one line.
    if (provider.accounts.length === 0) { height += size.line; return; }
    provider.accounts.forEach((account, accountIndex) => {
      if (accountIndex > 0) height += size.accountGap;
      const lines = Math.max(1, account.lines.length);
      height += lines * size.line + (lines - 1) * size.lineGap;
      if (names && account.email !== "") height += size.email + size.lineGap;
    });
  });
  return height;
}

/**
 * Whether account addresses fit in the room the session list has.
 *
 * Every account is always drawn; if they do not fit, the meters scroll. The
 * address is the only thing here that costs a whole line per account, and it
 * answers which account rather than whether to act, so it is drawn only when
 * it fits. It stays in each account's hover text and screen-reader words.
 * Unmeasured room (0) draws it: too much in a tall list is untidy, hiding
 * with room to spare loses information.
 */
export function showNames(room: number, providers: readonly MeterProvider[]): boolean {
  return room <= 0 || meterHeight(providers, true) <= Math.floor(room * METER_SHARE);
}
