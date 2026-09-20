/* Round 16: every state the pooled row has to survive.
 *
 * Round 15 drew `pool` against one fixture, which showed the idea but not the
 * edges. A pooled row has to answer for four things the fixture never varied:
 * how many accounts it adds up, how many meters it stacks, what the level and
 * the pace do to each other, and what happens when the accounts disagree.
 *
 * The states below are built rather than sampled, so each one isolates a
 * single fact. The row itself is round 15's `pool`, imported, not copied: the
 * comp has to fail where the real code fails.
 *
 * Two states matter more than the rest and sit next to each other on purpose:
 * one account full beside one account empty, and two accounts at half. The
 * pool averages both to 50 %. Those two frames are the price of the idea. */

(() => {
  const { NOW } = window.QUOTA_FIXTURE;
  const { groupRow } = window.QUOTA_ROUND15;

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  const lane = (o) => ({
    windowMs: null,
    remainingPercent: null,
    remainingAmount: null,
    limitAmount: null,
    resetsAtMs: null,
    metered: true,
    blocked: false,
    blockedUntilMs: null,
    lastBlockedMs: null,
    history: null,
    ...o,
  });

  /* The meters, exactly as the router publishes them. */
  const fiveHour = (percent, resetsInHours) =>
    lane({ id: "five_hour", name: "5 h", windowMs: 5 * HOUR, remainingPercent: percent, resetsAtMs: NOW + resetsInHours * HOUR });
  const week = (percent, resetsInDays) =>
    lane({ id: "seven_day", name: "7 d", windowMs: 7 * DAY, remainingPercent: percent, resetsAtMs: NOW + resetsInDays * DAY });
  const fable = (percent, resetsInDays) =>
    lane({ id: "seven_day_fable", name: "Fable", windowMs: 7 * DAY, remainingPercent: percent, resetsAtMs: NOW + resetsInDays * DAY });
  // Antigravity states a reset instant but never a window length, so these
  // lanes can never carry a pace cut.
  const agClaude = (percent, resetsInHours) =>
    lane({ id: "antigravity_claude", name: "Claude", remainingPercent: percent, resetsAtMs: NOW + resetsInHours * HOUR });
  const agGpt = (percent, resetsInHours) =>
    lane({ id: "antigravity_gpt_oss", name: "GPT-OSS", remainingPercent: percent, resetsAtMs: NOW + resetsInHours * HOUR });
  const gemini = (blocked, backInMinutes = 12) =>
    lane({
      id: "antigravity_gemini",
      name: "Gemini",
      metered: false,
      blocked,
      blockedUntilMs: blocked ? NOW + backInMinutes * MIN : null,
      resetsAtMs: NOW + 5 * HOUR,
    });
  const credits = (left, limit) =>
    lane({
      id: "openrouter_credits",
      name: "Credits",
      remainingPercent: (left / limit) * 100,
      remainingAmount: left,
      limitAmount: limit,
      resetsAtMs: null,
    });

  let seq = 0;
  const account = (lanes, routed = false) => ({
    provider: "x",
    providerId: "x",
    email: `account-${(seq += 1)}`,
    routed,
    state: routed ? "routed" : "standby",
    lanes,
  });

  const group = (provider, ...accounts) => ({ provider, accounts });

  /* Each entry is one fact under test. The caption says what changed, never
     what to conclude. */
  const STATES = [
    {
      band: "how many accounts",
      caption: "one account · one meter · ahead of pace",
      group: group("Codex", account([week(95, 6)], true)),
    },
    {
      caption: "two accounts · one seam",
      group: group("Codex", account([week(80, 5)], true), account([week(64, 4)])),
    },
    {
      caption: "three accounts · one in use, two spent · live Codex",
      group: group("Codex", account([week(95, 6)], true), account([week(0, 4)]), account([week(0, 2.7)])),
    },
    {
      caption: "five accounts · four seams",
      group: group("Codex", account([week(90, 6.5)], true), account([week(70, 5)]), account([week(40, 3)]),
        account([week(0, 2)]), account([week(0, 1)])),
    },
    {
      band: "how many meters",
      caption: "one account · three meters · live Claude",
      group: group("Claude", account([fiveHour(85, 0.25), week(96, 6.5), fable(38, 6.5)], true)),
    },
    {
      caption: "two accounts · three meters · a seam per lane",
      group: group("Claude", account([fiveHour(85, 0.25), week(96, 6.5), fable(38, 6.5)], true),
        account([fiveHour(40, 2), week(70, 4), fable(12, 4)])),
    },
    {
      caption: "two accounts · two meters + a boolean · live Antigravity",
      group: group("Antigravity", account([gemini(false), agClaude(3.9, 38), agGpt(3.9, 38)], true),
        account([gemini(true), agClaude(0, 27), agGpt(0, 27)])),
    },
    {
      band: "what the level and the pace do",
      caption: "pool full",
      group: group("Codex", account([week(100, 6.9)], true), account([week(100, 6.9)])),
    },
    {
      caption: "behind pace · the shortfall hatches",
      group: group("Codex", account([week(30, 5)], true), account([week(20, 5)])),
    },
    {
      caption: "pool in the warn band · under 30",
      group: group("Codex", account([week(28, 3)], true), account([week(28, 3)])),
    },
    {
      caption: "pool in the danger band · under 10",
      group: group("Codex", account([week(8, 2)], true), account([week(6, 2)])),
    },
    {
      caption: "every account spent",
      group: group("Codex", account([week(0, 3)]), account([week(0, 1.5)])),
    },
    {
      caption: "no window length · no pace cut possible",
      group: group("Antigravity", account([agClaude(40, 20)], true), account([agClaude(20, 20)])),
    },
    {
      caption: "no reset instant · money instead of a share",
      group: group("OpenRouter", account([credits(1.63, 10)], true), account([credits(7.2, 10)])),
    },
    {
      band: "what the booleans do",
      caption: "every boolean answering",
      group: group("Antigravity", account([gemini(false), agClaude(60, 20)], true), account([gemini(false), agClaude(45, 20)])),
    },
    {
      caption: "one answering, one refusing",
      group: group("Antigravity", account([gemini(false), agClaude(60, 20)], true), account([gemini(true), agClaude(45, 20)])),
    },
    {
      caption: "every boolean refusing",
      group: group("Antigravity", account([gemini(true, 8)], true), account([gemini(true, 40), agClaude(45, 20)])),
    },
    {
      caption: "booleans only · no level to draw",
      group: group("Antigravity", account([gemini(false)], true), account([gemini(true)])),
    },
    {
      band: "when the accounts disagree",
      caption: "one full, one empty · the pool says 50",
      group: group("Codex", account([week(100, 4.5)], true), account([week(0, 4.5)])),
    },
    {
      caption: "both at half · the pool says 50",
      group: group("Codex", account([week(50, 4.5)], true), account([week(50, 4.5)])),
    },
    {
      caption: "one meters Fable, the other does not",
      group: group("Claude", account([fiveHour(70, 1), week(80, 5), fable(30, 5)], true), account([fiveHour(50, 3), week(60, 5)])),
    },
    {
      caption: "one account unmetered, one metered",
      group: group("Antigravity", account([gemini(false)], true), account([gemini(false), agClaude(60, 20), agGpt(55, 20)])),
    },
  ];

  /* ----------------------------------------------------------- the seam ---
   * Round 15 marked each account boundary with a 1 px notch the colour of the
   * panel. On the live Codex group both notches landed on an edge the lane
   * already had — one on the end of the fill, one on the end of the hatch —
   * and disappeared. These are four places to put the same fact. */
  const SEAMS = {
    // What round 15 shipped: a notch cut through the lane itself.
    tick: "tick · a notch through the lane",
    // Above the lane, where no fill or hatch edge can ever land on it.
    riser: "riser · a mark above the lane",
    // Under the lane, as its own broken rule: the seam pattern is readable
    // even where the lane is solid.
    base: "base · a broken rule beneath the lane",
    // The lane is built as one pill per account, so the seam is a real gap of
    // the same kind the pace cut already uses.
    pill: "pill · the lane built as one segment per account",
  };

  function seamRow(state, seam) {
    const row = groupRow(state.group, NOW, "pool");
    row.classList.add(`seam-${seam}`);
    const accounts = state.group.accounts.length;
    for (const node of row.querySelectorAll(".w-lane")) {
      node.style.setProperty("--parts", String(accounts));
      if (seam === "base") {
        const rule = document.createElement("i");
        rule.className = "r-base";
        node.append(rule);
      }
    }
    return row;
  }

  window.QUOTA_ROUND16 = { STATES, SEAMS, seamRow, NOW };
})();
