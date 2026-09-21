/* Round 34: three fixes, and a boolean lane that scales to a hundred.
 *
 * 1. The doomed credit is solid amber at every distance. Round 33 ramped it
 *    from an outline up to a filled bar, so a real loss three days out was
 *    drawn as an empty box. Intensity moves to colour instead: the bar stays
 *    solid and travels from amber #d29922 to red #f85149 as the rate needed
 *    to save the credit climbs. That keeps the existing vocabulary, where
 *    amber and red are the only saturated marks and both mean a problem.
 *
 * 2. Accounts are grouped. Claude stacks three meters per account, so six
 *    lanes in a row were one undifferentiated block. Lanes inside an account
 *    keep their 4 px gap and accounts are separated by 9 px, which costs
 *    5 px per extra account and is measured on the page.
 *
 * 3. The lanes start at the same x on every row. Antigravity's Gemini dots
 *    used to sit before the stack and pushed its bars right, so no row lined
 *    up with any other. The booleans become a lane of their own: one strip
 *    across the same track, divided into one segment per account, red where
 *    blocked.
 *
 *    The strip is the same rule at every count. Segments are `flex: 1`, so
 *    two accounts give two fat blocks and a hundred give a dense band of
 *    2.5 px ticks with the blocked ones showing red. Nothing switches
 *    representation at a threshold, and the row never grows sideways. */

(() => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const FIVE = 5 * HOUR;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));
  const unit = (value) => Math.max(0, Math.min(1, value));

  /* ---------------------------------------------------- the doom, in hue */

  const WARN = [210, 153, 34];
  const DANGER = [248, 81, 73];
  /** Solid at every distance. Only the hue moves. */
  const doomColour = (near) => {
    const mix = WARN.map((from, index) => Math.round(from + (DANGER[index] - from) * near));
    return `rgb(${mix.join(", ")})`;
  };

  const CAP = 8;
  /** Times the window's own natural rate you must sustain to waste nothing. */
  const byRate = (spec) => {
    if (!spec.windowMs || spec.pace <= 0) return 0;
    const excess = spec.percent / spec.pace;
    return excess <= 1 ? 0 : unit(Math.log(excess) / Math.log(CAP));
  };

  const lane = (hue, percent, leftMs, windowMs) => ({
    hue,
    percent: clamp(percent),
    leftMs,
    windowMs,
    pace: windowMs ? clamp((leftMs / windowMs) * 100) : null,
    get surplus() { return this.pace === null ? 0 : Math.max(0, this.percent - this.pace); },
  });

  const AT_RISK = 8;
  const HUE = { five: 0, week: 1, fable: 2, anc: 0, ang: 1, credits: 1 };

  function draw(box, spec) {
    box.style.setProperty("--fill", `${spec.percent}%`);
    if (spec.pace === null) {
      box.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return;
    }
    box.style.setProperty("--pace", `${spec.pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (spec.percent > spec.pace) box.append(el("i", "w-fill right"));
    if (spec.percent < spec.pace && spec.percent > 0) box.append(el("i", "w-hatch"));
    if (spec.surplus < AT_RISK) return;

    const doom = el("i", "k-doom");
    doom.style.left = `${spec.percent - spec.surplus}%`;
    doom.style.width = `${Math.max(0.8, spec.surplus)}%`;
    doom.style.background = doomColour(byRate(spec));
    box.append(doom);
  }

  /**
   * One strip, one segment per boolean account, red where blocked.
   *
   * Segments flex, so the strip is the full track at any count and the row
   * never grows sideways. Two accounts are fat blocks; a hundred are ticks.
   */
  function booleanLane(states) {
    const strip = el("span", "k-lane k-strip");
    if (states.length > 40) strip.classList.add("dense");
    for (const on of states) strip.append(el("i", `k-seg${on ? "" : " off"}`));
    return strip;
  }

  /* -------------------------------------------------------------- one row */

  function row(group) {
    const node = el("div", "k-row");
    node.append(el("span", "k-tag", group.tag));

    const stack = el("span", "k-stack");
    for (const account of group.accounts) {
      const block = el("span", `k-acct${account.pinned ? " pinned" : ""}`);
      for (const spec of [...account.lanes].sort((a, b) => a.leftMs - b.leftMs)) {
        const line = el("span", "k-line");
        const bar = el("span", `k-lane w-lane hue${HUE[spec.hue] ?? 1} tone-ok`);
        draw(bar, spec);
        line.append(bar);
        block.append(line);
      }
      stack.append(block);
    }
    if (group.booleans?.length) {
      const block = el("span", "k-acct");
      const line = el("span", "k-line");
      line.append(booleanLane(group.booleans));
      block.append(line);
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  /* -------------------------------------------------------------- the data */

  const acct = (lanes, pinned = false) => ({ lanes, pinned });

  const CLAUDE = {
    tag: "CL",
    accounts: [
      acct([lane("five", 85, 1 * HOUR, FIVE), lane("week", 60, 2 * DAY, WEEK), lane("fable", 40, 5 * DAY, WEEK)], true),
      acct([lane("five", 20, 4 * HOUR, FIVE), lane("week", 90, 12 * HOUR, WEEK), lane("fable", 72, 36 * HOUR, WEEK)]),
    ],
  };

  const ANTIGRAVITY = {
    tag: "AN",
    booleans: [true, false],
    accounts: [
      acct([lane("anc", 78, 3 * HOUR, null), lane("ang", 44, 3 * HOUR, null)], true),
      acct([lane("anc", 12, 20 * HOUR, null), lane("ang", 92, 20 * HOUR, null)]),
    ],
  };

  const CODEX = {
    tag: "CO",
    accounts: [
      acct([lane("week", 78, 6 * HOUR, WEEK)]),
      acct([lane("week", 64, 24 * HOUR, WEEK)]),
      acct([lane("week", 71, 48 * HOUR, WEEK)]),
      acct([lane("week", 52, 5 * DAY, WEEK)], true),
      acct([lane("week", 30, 6.4 * DAY, WEEK)]),
    ],
  };

  /** The strip at four counts, to show it never changes rule or width. */
  const scatter = (count, blocked) => {
    const states = Array.from({ length: count }, () => true);
    for (const index of blocked) states[index % count] = false;
    return states;
  };
  const STRIPS = [
    { count: 2, states: scatter(2, [1]) },
    { count: 8, states: scatter(8, [2, 5]) },
    { count: 27, states: scatter(27, [3, 9, 10, 20]) },
    { count: 100, states: scatter(100, [4, 5, 17, 40, 41, 42, 63, 88, 99]) },
  ];

  /** The doom ramp, solid at every step. */
  const RAMP = [1, 1.4, 2, 3, 4.5, 8].map((excess) => ({
    excess,
    near: unit(Math.log(Math.max(excess, 1.0001)) / Math.log(CAP)),
  }));

  window.QUOTA_ROUND34 = { row, booleanLane, CLAUDE, ANTIGRAVITY, CODEX, STRIPS, RAMP, doomColour };
})();
