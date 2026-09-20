/* Round 25: both risks, with three accounts on different days.
 *
 * Round 24 walked the two risks but not the case they actually occur in. The
 * draining walk held a single account, and no walk gave a group three
 * accounts resetting on separate days, which is the only shape that matters
 * here: Tuesday, Thursday and Saturday, each with its own balance, none of
 * them failing over because every provider routes pinned.
 *
 * Three things get measured rather than asserted.
 *
 *   waves      three accounts hold credit and reset on different days, so
 *              each one's cut crosses its fill at a different moment and the
 *              hollow grows in steps rather than smoothly.
 *   dilution   the pooled fill is a mean, so one account losing everything
 *              shows as its loss divided by the account count. The cost of a
 *              single bar, stated in points rather than argued about.
 *   starving   three accounts spent faster than their windows, and the mixed
 *              case where only the pinned one is. The hatch is gated off
 *              while any account is ahead, so the mixed case is where the
 *              readout has to carry the warning by itself.
 *
 * Every row is drawn twice: `reach`, which names the fullest usable account,
 * and `pinned`, which names the account the router is actually held to and
 * gives the countdown to the next thing the group loses. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const WEEK = 7 * DAY;

  const account = (percent, leftMs, routed, now) => ({
    provider: "Codex", providerId: "codex", email: "account", routed,
    available: percent > 0, state: routed ? "routed" : "standby",
    lanes: [{
      id: "seven_day", name: "7 d", windowMs: WEEK, remainingPercent: percent,
      remainingAmount: null, limitAmount: null, resetsAtMs: now + leftMs,
      metered: true, blocked: false, blockedUntilMs: null, lastBlockedMs: null, history: null,
    }],
  });

  const group = (...accounts) => ({ provider: "Codex", accounts });
  const surplus = (percent, leftMs) => Math.max(0, percent - (leftMs / WEEK) * 100);
  const shortfall = (percent, leftMs) => Math.max(0, (leftMs / WEEK) * 100 - percent);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const clock = (ms) => (ms < DAY ? `${Math.round(ms / HOUR)} h` : `${(ms / DAY).toFixed(1)} d`);

  /* Walk 1 · three accounts holding credit, resetting on three different
     days. Nothing is spent; only the clock moves. Each account's cut crosses
     its own fill at its own moment, so the group's hollow grows in waves. */
  function waves(now) {
    // Saturday, Thursday, Tuesday, as at the start of the walk.
    const START = [[40, 6 * DAY, true], [80, 4 * DAY, false], [95, 2 * DAY, false]];
    const STEPS = [0, 12 * HOUR, 24 * HOUR, 36 * HOUR, 42 * HOUR, 47 * HOUR];
    return STEPS.map((elapsed) => {
      const live = START.map(([percent, leftMs, routed]) => [percent, leftMs - elapsed, routed]);
      const each = live.map(([percent, leftMs]) => Math.round(surplus(percent, leftMs)));
      return {
        note: `after ${clock(elapsed) === "0 h" ? "0 h" : clock(elapsed)} · expiring per account `
          + `<b>${each.join(" · ")}</b> · pooled <b>${Math.round(mean(each))}</b>`,
        group: group(...live.map(([percent, leftMs, routed]) => account(percent, leftMs, routed, now))),
      };
    });
  }

  /* Walk 2 · the same account about to lose 89 points, in groups of one, two,
     three and six. The others sit exactly on pace and contribute nothing, so
     the only thing changing is how many ways the loss is divided. */
  function dilution(now) {
    return [1, 2, 3, 6].map((count) => {
      const others = Array.from({ length: count - 1 }, () => account(50, 3.5 * DAY, false, now));
      const loss = surplus(90, 1 * HOUR);
      return {
        note: `${count} account${count === 1 ? "" : "s"} · one losing <b>${Math.round(loss)} points</b>`
          + ` · the bar can show <b>${Math.round(loss / count)}</b>`,
        group: group(account(90, 1 * HOUR, true, now), ...others),
      };
    });
  }

  /* Walk 3 · spending faster than the window, across accounts. The first four
     steps drain every account together; the last two drain only the pinned
     one, which is where the hatch gate switches off. */
  function starving(now) {
    const STEPS = [
      { label: "all three on pace", set: [[75, 5.25 * DAY, true], [70, 4.9 * DAY, false], [80, 5.6 * DAY, false]] },
      { label: "all three a little behind", set: [[55, 5 * DAY, true], [50, 4.5 * DAY, false], [60, 5.5 * DAY, false]] },
      { label: "all three well behind", set: [[30, 5 * DAY, true], [25, 4.5 * DAY, false], [35, 5.5 * DAY, false]] },
      { label: "all three nearly dry", set: [[8, 4.5 * DAY, true], [5, 4 * DAY, false], [11, 5 * DAY, false]] },
      { label: "only the pinned one is behind", set: [[20, 5 * DAY, true], [90, 6 * DAY, false], [70, 4 * DAY, false]] },
      { label: "the pinned one is nearly dry", set: [[4, 5 * DAY, true], [90, 6 * DAY, false], [70, 4 * DAY, false]] },
    ];
    return STEPS.map((step) => {
      const each = step.set.map(([percent, leftMs]) => Math.round(shortfall(percent, leftMs)));
      const ahead = step.set.some(([percent, leftMs]) => surplus(percent, leftMs) > 0);
      return {
        note: `${step.label} · short per account <b>${each.join(" · ")}</b>`
          + ` · ${ahead ? "one is ahead, so no hatch" : "none ahead, so the group hatches"}`,
        group: group(...step.set.map(([percent, leftMs, routed]) => account(percent, leftMs, routed, now))),
      };
    });
  }

  window.QUOTA_ROUND25 = { waves, dilution, starving };
})();
