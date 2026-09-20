/* Round 19: waste across accounts, not inside one.
 *
 * Round 18 answered the single-lane question: the fill beyond the pace cut is
 * exactly what expires, and it grows on its own as the reset approaches. That
 * holds per lane. It does not survive being averaged, and it does not survive
 * being dropped.
 *
 * The multi-account case is the one that matters, because the router spends
 * one account at a time. Every account it is not spending sits still while
 * its own clock runs out, on its own day of the week. Waste is what the bench
 * does by default.
 *
 * Two tests here.
 *
 * 1. Cancellation. One account deep in deficit, one deep in surplus. The
 *    pooled lane averages both and lands exactly on pace, so it draws no mark
 *    of any kind while one account is about to throw away nearly everything.
 *    Pooling cannot report this: the quantity is gone before the lane is
 *    drawn.
 *
 * 2. The walk. Three Codex accounts, one being spent and two idle, stepped
 *    through five moments. The idle accounts hold still while their cuts walk
 *    left, so their overshoots grow untouched. An arrangement passes this
 *    test only if each account keeps its own cut. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const NOW = window.QUOTA_FIXTURE.NOW;
  const WEEK = 7 * DAY;

  const meter = (percent, leftMs) => ({
    id: "seven_day",
    name: "7 d",
    windowMs: WEEK,
    remainingPercent: percent,
    remainingAmount: null,
    limitAmount: null,
    resetsAtMs: NOW + leftMs,
    metered: true,
    blocked: false,
    blockedUntilMs: null,
    lastBlockedMs: null,
    history: null,
  });

  const account = (percent, leftMs, routed = false) => ({
    provider: "Codex",
    providerId: "codex",
    email: "account",
    routed,
    state: routed ? "routed" : "standby",
    lanes: [meter(percent, leftMs)],
  });

  const group = (...accounts) => ({ provider: "Codex", accounts });

  /* Test 1. Account A is starving: 10 % left with 80 % of its window still to
     run. Account B is wasting: 90 % left with 20 % of its window to run. The
     two overshoots are equal and opposite, so the pool's fill and the pool's
     cut both land on 50 and the lane draws as perfectly on pace. */
  const CANCEL = group(
    account(10, 0.8 * WEEK, true),
    account(90, 0.2 * WEEK),
  );

  /* Test 2. One account spent down at a steady rate, two left alone. Each row
     is one moment; nothing about the idle accounts changes except the clock.

     in use   95/6d → 75/5d → 55/4d → 35/3d → 15/2d   roughly on pace
     idle B  100/5d → 100/4d → 100/3d → 100/2d → 100/1d   never touched
     idle C   60/3d →  60/2d →  60/1d →  60/12h →  60/2h  never touched */
  const WALK = [
    { left: "6 d", group: group(account(95, 6 * DAY, true), account(100, 5 * DAY), account(60, 3 * DAY)) },
    { left: "5 d", group: group(account(75, 5 * DAY, true), account(100, 4 * DAY), account(60, 2 * DAY)) },
    { left: "4 d", group: group(account(55, 4 * DAY, true), account(100, 3 * DAY), account(60, 1 * DAY)) },
    { left: "3 d", group: group(account(35, 3 * DAY, true), account(100, 2 * DAY), account(60, 12 * HOUR)) },
    { left: "2 d", group: group(account(15, 2 * DAY, true), account(100, 1 * DAY), account(60, 2 * HOUR)) },
  ];

  /* What the group is about to lose at each step, if nothing changes. The
     numbers are stated so the drawing can be checked rather than trusted. */
  const LOSS = WALK.map(({ group: g }) => g.accounts
    .map((a) => Math.max(0, Math.round(a.lanes[0].remainingPercent - (a.lanes[0].resetsAtMs - NOW) / WEEK * 100)))
    .join(" · "));

  const ARRANGEMENTS = ["today", "nest", "columns", "segments", "lead", "pool"];

  window.QUOTA_ROUND19 = { CANCEL, WALK, LOSS, ARRANGEMENTS, NOW };
})();
