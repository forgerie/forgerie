/* Round 18: the tokens you are about to lose.
 *
 * A quota window is use-it-or-lose-it. Whatever is left at the reset instant
 * is gone, and the accounts reset at different hours on different days, so
 * there is no single moment to watch.
 *
 * The split pace cut already carries this fact exactly, and it has since
 * round 13. The cut sits at the share of the window still to run. The fill
 * sits at the share of the allowance still unspent. So:
 *
 *     fill beyond the cut  =  what you will lose if you keep this rate
 *     cut beyond the fill  =  what you must not spend to reach the reset
 *
 * The first quantity is not an approximation of the loss. It is the loss. If
 * nothing is spent from here, the fill holds still while the cut walks left,
 * so the overshoot grows on its own, and at the reset instant it equals
 * everything left in the lane.
 *
 * What the shelf does today is mark only the second case. The shortfall
 * hatches in amber; the surplus is drawn as ordinary fill and says nothing.
 * This round marks the first case five ways.
 *
 * What pace still cannot say, and no mark here fixes:
 *   - which of two lanes expires first in wall-clock time. Two lanes with the
 *     same overshoot and different window lengths draw the same picture, and
 *     only one countdown fits in the row.
 *   - whether the surplus is still reachable. Past some point the remaining
 *     time is too short to spend the remaining allowance at any rate, and the
 *     loss is already locked in. The lane cannot know that rate. */

(() => {
  const { laneEl } = window.QUOTA_ROUND15;

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const NOW = window.QUOTA_FIXTURE.NOW;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const meter = (id, name, windowMs, percent, leftMs) => ({
    id,
    name,
    windowMs,
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

  /* A seven-day allowance holding 70 %, walked toward its reset. Nothing is
     spent between steps: only the clock moves, and the overshoot grows. */
  const WEEK = 7 * DAY;
  const WALK = [0.9, 0.65, 0.45, 0.28, 0.12, 0.03].map((share) => ({
    share,
    lane: meter("seven_day", "7 d", WEEK, 70, share * WEEK),
    // The overshoot, stated in the caption so the drawing can be checked
    // against the arithmetic rather than trusted.
    loss: Math.max(0, Math.round(70 - share * 100)),
  }));

  /* Four steps of the same walk, for the treatment comparison. */
  const STEPS = [0.65, 0.45, 0.28, 0.06].map((share) => meter("seven_day", "7 d", WEEK, 70, share * WEEK));

  /* One lane with a surplus over a lane with a shortfall, so a treatment has
     to stay distinguishable from the hatch it sits beside. */
  const PAIR = [
    meter("five_hour", "5 h", 5 * HOUR, 80, 0.2 * 5 * HOUR),
    meter("seven_day", "7 d", WEEK, 25, 0.7 * WEEK),
  ];

  const TREATMENTS = {
    none: "none · today, the surplus is ordinary fill",
    ghost: "ghost · the surplus in the lane's own hue, half present",
    void: "void · the surplus drawn as an outline",
    cap: "cap · the surplus keeps its hue, its far end takes an amber cap",
    solid: "solid · the surplus is amber and solid",
    hatch: "hatch · the surplus hatched against the shortfall's angle",
  };

  const stack = (lanes, now = NOW) => {
    const box = el("span", "w-stack");
    for (const lane of lanes) box.append(laneEl(lane, now));
    return box;
  };

  /** One shelf row carrying nothing but a lane stack, for the ladders. */
  function bareRow(lanes, tag = "CL") {
    const row = el("div", "r-row");
    row.append(el("span", "r-tag", tag));
    const lanes_ = el("span", "r-lanes");
    lanes_.append(stack(lanes));
    row.append(lanes_);
    row.append(el("span", "r-val", `${Math.round(lanes[0].remainingPercent)}%`));
    row.append(el("span", "r-tm", ""));
    return row;
  }

  /* The shelf, with one account about to throw most of a five-hour window
     away: 92 % unspent and forty minutes left to spend it in. */
  const account = (provider, lanes, routed) => ({
    provider,
    providerId: provider.toLowerCase(),
    email: "account",
    routed,
    state: routed ? "routed" : "standby",
    lanes,
  });

  const SHELF = [
    account("Claude", [
      meter("five_hour", "5 h", 5 * HOUR, 92, 40 * MIN),
      meter("seven_day", "7 d", WEEK, 96, 6.5 * DAY),
      meter("seven_day_fable", "Fable", WEEK, 38, 6.5 * DAY),
    ], true),
    account("Codex", [meter("seven_day", "7 d", WEEK, 95, 6 * DAY)], true),
    account("Codex", [meter("seven_day", "7 d", WEEK, 0, 2.7 * DAY)], false),
    account("OpenRouter", [{
      ...meter("openrouter_credits", "Credits", null, 16.3, 0),
      resetsAtMs: null,
      remainingAmount: 1.63,
      limitAmount: 10,
    }], true),
  ];

  window.QUOTA_ROUND18 = { WALK, STEPS, PAIR, TREATMENTS, SHELF, bareRow, NOW };
})();
