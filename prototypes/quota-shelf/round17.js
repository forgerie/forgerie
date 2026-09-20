/* Round 17: the Codex group, every state.
 *
 * Codex is the clean case. One meter per account, a stated window length, no
 * boolean, no money — so nothing in the row varies except the thing under
 * test: how many accounts the group holds, what they hold, whether they agree
 * with each other, and when they come back.
 *
 * Every state is one Codex group. The lane is round 15's `pool`, imported, so
 * what fails here fails in the real row.
 *
 * The states are grouped by the question they answer, and inside a group only
 * one fact moves. Three of them are deliberate duplicates: 95/0/0 beside
 * 32/32/32, 100/0 beside 50/50 beside 75/25, and the three routing states.
 * Each set pools to the same number, so each set should render the same row.
 * Whether that is acceptable is the whole decision. */

(() => {
  const { NOW } = window.QUOTA_FIXTURE;

  const DAY = 86_400_000;

  /* One Codex account: a seven-day window, a level, and a return. */
  const account = (percent, resetsInDays, routed = false) => ({
    provider: "Codex",
    providerId: "codex",
    email: "account",
    routed,
    state: routed ? "routed" : "standby",
    lanes: [{
      id: "seven_day",
      name: "7 d",
      windowMs: 7 * DAY,
      remainingPercent: percent,
      remainingAmount: null,
      limitAmount: null,
      resetsAtMs: NOW + resetsInDays * DAY,
      metered: true,
      blocked: false,
      blockedUntilMs: null,
      lastBlockedMs: null,
      history: null,
    }],
  });

  /* By default the fullest account is the one in use, which is what the
     router actually does. States that test routing say otherwise. */
  const group = (...accounts) => {
    if (!accounts.some((candidate) => candidate.routed)) {
      const best = accounts.reduce((high, candidate) =>
        candidate.lanes[0].remainingPercent > high.lanes[0].remainingPercent ? candidate : high);
      best.routed = true;
      best.state = "routed";
    }
    return { provider: "Codex", accounts };
  };

  const HOUR_IN_DAYS = 1 / 24;

  const STATES = [
    { band: "how many accounts", caption: "one", group: group(account(95, 6)) },
    { caption: "two", group: group(account(80, 5), account(64, 4)) },
    { caption: "three", group: group(account(90, 6), account(70, 4.5), account(55, 3)) },
    { caption: "four", group: group(account(90, 6), account(75, 5), account(60, 3.5), account(45, 2)) },
    {
      caption: "six",
      group: group(account(95, 6.5), account(85, 5.5), account(70, 4.5), account(55, 3.5), account(40, 2.5), account(25, 1.5)),
    },

    { band: "what the group holds · three accounts", caption: "all full", group: group(account(100, 6.9), account(100, 6.9), account(100, 6.9)) },
    { caption: "all high", group: group(account(92, 5), account(88, 5), account(85, 5)) },
    { caption: "all mid", group: group(account(50, 3.5), account(50, 3.5), account(50, 3.5)) },
    { caption: "all low · danger band", group: group(account(12, 2), account(9, 2), account(6, 2)) },
    { caption: "all empty", group: group(account(0, 3), account(0, 2), account(0, 1)) },

    { band: "when the accounts disagree", caption: "two · 100 and 0", group: group(account(100, 4.5), account(0, 4.5)) },
    { caption: "two · 50 and 50", group: group(account(50, 4.5), account(50, 4.5)) },
    { caption: "two · 75 and 25", group: group(account(75, 4.5), account(25, 4.5)) },
    { caption: "three · 95, 0, 0 · the live Codex group", group: group(account(95, 6), account(0, 4), account(0, 2.7)) },
    { caption: "three · 32, 32, 32", group: group(account(32, 6), account(32, 4), account(32, 2.7)) },
    { caption: "three · 100, 0, 0", group: group(account(100, 6), account(0, 4), account(0, 2.7)) },

    { band: "the pace · one account", caption: "well ahead · spent almost nothing", group: group(account(100, 1)) },
    { caption: "exactly on pace", group: group(account(50, 3.5)) },
    { caption: "behind · the shortfall hatches", group: group(account(30, 5)) },
    { caption: "far behind · nearly all hatch", group: group(account(10, 6.5)) },

    { band: "when they come back", caption: "all together", group: group(account(60, 4), account(40, 4), account(20, 4)) },
    { caption: "staggered · 6d, 4d, 2d", group: group(account(60, 6), account(40, 4), account(20, 2)) },
    { caption: "one returns within the hour", group: group(account(60, 6), account(40, 4), account(20, HOUR_IN_DAYS)) },
    { caption: "one just reset, two nearly done", group: group(account(100, 7), account(8, 0.5), account(5, 0.4)) },

    { band: "which account is in use", caption: "the fullest is in use", group: group(account(90, 5, true), account(20, 3), account(10, 2)) },
    { caption: "the emptiest is in use", group: group(account(90, 5), account(20, 3), account(10, 2, true)) },
    { caption: "none is in use", group: { provider: "Codex", accounts: [account(90, 5), account(20, 3), account(10, 2)] } },

    { band: "one account only", caption: "full", group: group(account(100, 7)) },
    { caption: "empty", group: group(account(0, 2)) },
  ];

  /* The states where pooling either hides something or changes nothing, shown
     against the two arrangements that keep the accounts apart. */
  const COMPARE = [
    "three · 95, 0, 0 · the live Codex group",
    "three · 32, 32, 32",
    "two · 100 and 0",
    "two · 50 and 50",
    "the emptiest is in use",
    "six",
    "all empty",
  ].map((caption) => STATES.find((state) => state.caption === caption));

  window.QUOTA_ROUND17 = { STATES, COMPARE, NOW };
})();
