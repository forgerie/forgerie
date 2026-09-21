/* Round 33: solid doom across three providers with three different clocks.
 *
 * Round 32 chose `solid` on five Codex accounts, and leaned on a property
 * Codex happens to have: every account shares one seven-day window, so the
 * pace cut is a clock and time left maps straight onto a fixed horizon.
 *
 * Claude breaks that inside a single row. One account carries a five-hour
 * meter, a seven-day meter and a Fable meter, so three window lengths stack
 * in the same row. A three-day horizon then glows on every five-hour lane
 * for its whole life -- five hours is always "soon" against three days --
 * and the ramp becomes a light that never goes out.
 *
 * The fix is to stop measuring the deadline and start measuring whether the
 * credit can still be spent. To lose nothing you must burn the surplus in
 * the time that is left:
 *
 *     needed = surplus / timeLeft
 *     natural = 100 / window
 *     excess  = needed / natural = fill / pace
 *
 * So the intensity is fill divided by pace: how many times the window's own
 * natural rate you would have to sustain to waste nothing. It is unit-free,
 * identical in meaning on a five-hour lane and a seven-day one, and it is
 * made of the two numbers the lane already draws.
 *
 * It also corrects round 32. There a sliver going in six hours looked far
 * more urgent than a fortune going in forty-eight. By rate they are 3.9x and
 * 3.2x natural -- near enough the same emergency, because the fortune is so
 * much larger. Sooner is not the same as worse.
 *
 * Antigravity states no window length at all. No window means no pace, no
 * excess and no doom, so its lanes can never carry this mark. `infer` shows
 * what the row looks like once a window is assumed, which is the argument
 * for teaching the router to learn one from observed reset intervals. */

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

  /* ------------------------------------------------------------ the ramps */

  const HORIZON = 3 * DAY;
  /** Round 32's ramp. Measures the deadline, so a short window never cools. */
  const byClock = (lane) => 1 - Math.sqrt(unit(lane.leftMs / HORIZON));

  /**
   * The rate you would have to sustain to waste nothing, over the window's
   * own natural rate. Capped at eight times, which is already hopeless.
   */
  const CAP = 8;
  const byRate = (lane) => {
    if (!lane.windowMs || lane.pace <= 0) return 0;
    const excess = lane.percent / lane.pace;
    if (excess <= 1) return 0;
    return unit(Math.log(excess) / Math.log(CAP));
  };

  const RAMPS = { clock: byClock, rate: byRate };

  /* ------------------------------------------------------------- one lane */

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

  function draw(box, spec, ramp) {
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

    const void_ = el("i", "d-void");
    void_.style.left = `${spec.percent - spec.surplus}%`;
    void_.style.width = `${Math.max(0.8, spec.surplus)}%`;
    void_.style.background = `rgba(224, 158, 62, ${(RAMPS[ramp](spec) * 0.92).toFixed(3)})`;
    box.append(void_);
  }

  /* -------------------------------------------------------------- one row */

  function row(group, ramp, { inferAntigravity = false } = {}) {
    const node = el("div", "r-row v-bare");
    node.append(el("span", "r-tag", group.tag));
    const lanes = el("span", "r-lanes");

    if (group.booleans?.length) {
      const dots = el("span", "r-dots");
      for (const on of group.booleans) dots.append(el("i", `w-bool${on ? "" : " off"}`));
      lanes.append(dots);
    }

    const stack = el("span", "d-nest");
    const specs = group.lanes.map((spec) => {
      if (!inferAntigravity || spec.windowMs !== null) return spec;
      return lane(spec.hue, spec.percent, spec.leftMs, spec.assumed);
    });
    for (const spec of [...specs].sort((a, b) => a.leftMs - b.leftMs)) {
      const line = el("span", `d-line${spec.pinned ? " pinned" : ""}`);
      const bar = el("span", `d-lane w-lane hue${HUE[spec.hue] ?? 1} tone-ok`);
      draw(bar, spec, ramp);
      line.append(bar);
      stack.append(line);
    }
    lanes.append(stack);
    node.append(lanes);
    return node;
  }

  /* -------------------------------------------------------------- the data */

  /** Antigravity lanes: a reset instant, but no window length behind it. */
  const anLane = (hue, percent, leftMs, assumed) =>
    Object.assign(lane(hue, percent, leftMs, null), { assumed });

  const CLAUDE = {
    tag: "CL",
    lanes: [
      lane("five", 85, 1 * HOUR, FIVE),
      lane("week", 60, 2 * DAY, WEEK),
      lane("fable", 40, 5 * DAY, WEEK),
      lane("five", 20, 4 * HOUR, FIVE),
      lane("week", 90, 12 * HOUR, WEEK),
      lane("fable", 72, 36 * HOUR, WEEK),
    ],
  };

  const ANTIGRAVITY = {
    tag: "AN",
    booleans: [true, false],
    lanes: [
      anLane("anc", 78, 3 * HOUR, FIVE),
      anLane("ang", 44, 3 * HOUR, FIVE),
      anLane("anc", 12, 20 * HOUR, DAY),
      anLane("ang", 92, 20 * HOUR, DAY),
    ],
  };

  const CODEX = {
    tag: "CO",
    lanes: [
      lane("week", 78, 6 * HOUR, WEEK),
      lane("week", 64, 24 * HOUR, WEEK),
      lane("week", 71, 48 * HOUR, WEEK),
      Object.assign(lane("week", 52, 5 * DAY, WEEK), { pinned: true }),
      lane("week", 30, 6.4 * DAY, WEEK),
    ],
  };

  /** Every lane of the shelf, with what each ramp makes of it. */
  const READINGS = [
    ["CL", "five-hour", 85, 1 * HOUR, FIVE],
    ["CL", "five-hour", 20, 4 * HOUR, FIVE],
    ["CL", "seven-day", 90, 12 * HOUR, WEEK],
    ["CL", "seven-day", 60, 2 * DAY, WEEK],
    ["CO", "seven-day", 78, 6 * HOUR, WEEK],
    ["CO", "seven-day", 64, 24 * HOUR, WEEK],
    ["CO", "seven-day", 71, 48 * HOUR, WEEK],
    ["CO", "seven-day", 52, 5 * DAY, WEEK],
  ].map(([tag, meter, percent, leftMs, windowMs]) => {
    const spec = lane("week", percent, leftMs, windowMs);
    return {
      tag, meter, percent, leftMs,
      pace: spec.pace,
      excess: spec.pace > 0 ? spec.percent / spec.pace : Infinity,
      clock: byClock(spec),
      rate: byRate(spec),
    };
  });

  window.QUOTA_ROUND33 = { row, CLAUDE, ANTIGRAVITY, CODEX, READINGS, lane, anLane };
})();
