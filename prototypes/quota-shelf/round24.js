/* Round 24: the two risks, walked.
 *
 * Both are the pace cut, read in opposite directions:
 *
 *   fill beyond the cut   credit that will expire unspent   drawn hollow
 *   cut beyond the fill   spending faster than the window   drawn hatched
 *
 * Neither is a new measurement. The cut sits at the share of the window still
 * to run and the fill at the share of the allowance still unspent, so the gap
 * between them is signed, and its sign is which of the two risks you have.
 *
 * Three walks, each moving one thing and holding everything else still:
 *
 *   losing     the level holds and the clock runs out. Nothing is spent, so
 *              the cut walks left and the overshoot grows unaided until, at
 *              the reset, it is the whole balance.
 *   draining   the clock runs normally and the level falls faster. The fill
 *              crosses the cut and the shortfall opens behind it.
 *   both       one account wasting beside one starving, which is where the
 *              hatch gate has to be justified rather than assumed.
 *
 * The rows are round 23's `reach`: a pooled bar, and a number naming the
 * account a request would land on. */

(() => {
  const { groupRow } = window.QUOTA_ROUND23;

  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const WEEK = 7 * DAY;

  const account = (percent, leftMs, routed = false, now = Date.now()) => ({
    provider: "Codex", providerId: "codex", email: "account", routed,
    available: percent > 0, state: routed ? "routed" : "standby",
    lanes: [{
      id: "seven_day", name: "7 d", windowMs: WEEK, remainingPercent: percent,
      remainingAmount: null, limitAmount: null, resetsAtMs: now + leftMs,
      metered: true, blocked: false, blockedUntilMs: null, lastBlockedMs: null, history: null,
    }],
  });

  const group = (...accounts) => ({ provider: "Codex", accounts });

  /** What the arithmetic says, so the drawing can be checked against it. */
  const surplus = (percent, leftMs) => Math.max(0, percent - (leftMs / WEEK) * 100);
  const shortfall = (percent, leftMs) => Math.max(0, (leftMs / WEEK) * 100 - percent);

  const LEFT = [6 * DAY, 4 * DAY, 2 * DAY, 24 * HOUR, 6 * HOUR, 1 * HOUR];
  const CLOCK = ["6 d", "4 d", "2 d", "24 h", "6 h", "1 h"];

  /* Walk 1 · nothing is spent and the reset approaches. One account holding
     90 %, then the same thing with a spent account beside it. */
  function losing(now, withSpare) {
    return LEFT.map((leftMs, index) => ({
      note: `${CLOCK[index]} left · 90 % unspent · <b>${Math.round(surplus(90, leftMs))} points</b> expire`,
      group: withSpare
        ? group(account(0, 3 * DAY, false, now), account(90, leftMs, true, now))
        : group(account(90, leftMs, true, now)),
    }));
  }

  /* Walk 2 · the clock runs normally and the level falls faster than it.
     The fill starts ahead of the cut and crosses it. */
  const DRAIN = [[95, 6 * DAY], [75, 5.5 * DAY], [55, 5 * DAY], [35, 4.5 * DAY], [15, 4 * DAY], [3, 3.5 * DAY]];

  function draining(now) {
    return DRAIN.map(([percent, leftMs]) => {
      const short = shortfall(percent, leftMs);
      return {
        note: short > 0
          ? `${percent} % left · ${(leftMs / DAY).toFixed(1)} d to run · <b>${Math.round(short)} points</b> short of an even spend`
          : `${percent} % left · ${(leftMs / DAY).toFixed(1)} d to run · on or ahead of an even spend`,
        group: group(account(percent, leftMs, true, now)),
      };
    });
  }

  /* Walk 3 · the account in use is starving while a spare one wastes. The
     hatch is gated off here on purpose: the group can still serve a request,
     so running dry is not the risk. Whether that gate is right is the thing
     to look at. */
  function both(now) {
    return LEFT.map((leftMs, index) => ({
      note: `in use 20 % with 5 d to run · spare 95 % resetting in ${CLOCK[index]}`
        + ` · <b>${Math.round(surplus(95, leftMs) / 2)} points</b> expire`,
      group: group(account(20, 5 * DAY, true, now), account(95, leftMs, false, now)),
    }));
  }

  /* The whole shelf, in the two situations, so the mark is judged in place. */
  function shelves(now, live) {
    const clone = (accounts) => accounts.map((a) => ({ ...a, lanes: a.lanes.map((l) => ({ ...l })) }));
    const wasting = clone(live);
    for (const a of wasting) {
      if (a.providerId !== "codex") continue;
      if (a.lanes[0].remainingPercent > 0) { a.lanes[0].remainingPercent = 88; a.lanes[0].resetsAtMs = now + 5 * HOUR; }
    }
    const drained = clone(live);
    for (const a of drained) {
      if (a.providerId !== "codex") continue;
      a.lanes[0].remainingPercent = a.lanes[0].remainingPercent > 0 ? 9 : 0;
      a.lanes[0].resetsAtMs = now + 5 * DAY;
    }
    return [
      { caption: "as it stands", accounts: live },
      { caption: "Codex holding 88 % with five hours to run", accounts: wasting },
      { caption: "Codex down to 9 % with five days to run", accounts: drained },
    ];
  }

  window.QUOTA_ROUND24 = { losing, draining, both, shelves, groupRow };
})();
