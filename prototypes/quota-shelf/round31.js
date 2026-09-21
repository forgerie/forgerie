/* Round 31: bare lanes, and one countdown.
 *
 * Round 30 proved that a rate derived from this payload adds nothing to the
 * geometry, because it is made of the same two numbers the pace cut is. So
 * the drawing already holds both risks: a hatch is running dry early, a
 * hollow is credit about to expire.
 *
 * What the drawing cannot hold is hours. The gap is a share of a window, so a
 * five-hour lane and a seven-day lane two thirds through are the same
 * picture. That is the one fact worth a column, and this round asks which
 * moment it should name.
 *
 *   loss   the next time the group throws credit away. Falls back to the
 *          soonest reset when nothing is at risk.
 *   dry    the moment the pinned account runs out at the rate it is going.
 *          Blank when it will not run out before its window turns over.
 *   next   whichever of the three comes first -- running dry, losing credit,
 *          or a plain reset -- with the colour saying which kind it is:
 *          red for dry, amber for a loss, grey for a reset.
 *
 * `next` is the only one that never leaves the column empty and never names
 * a moment that is not the soonest thing about to happen. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const WEEK = 7 * DAY;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  /* --------------------------------------------------------- one account */

  const at = (percent, leftMs, pinned = false, windowMs = WEEK) => ({
    percent: clamp(percent),
    leftMs,
    windowMs,
    pinned,
    pace: windowMs ? clamp((leftMs / windowMs) * 100) : null,
    get surplus() { return this.pace === null ? 0 : Math.max(0, this.percent - this.pace); },
  });

  /**
   * When this account runs out at the rate it has been spent, or null.
   *
   * Reported only once the shortfall is worth a colour. Any account spending
   * a hair above an even rate runs out fractionally early, so a bare
   * comparison against the reset called a healthy 90 % row an emergency. The
   * bands are round 29's, and nothing is claimed until a tenth of the window
   * has run, because before that the rate is not yet a measurement.
   */
  function dryIn(account) {
    if (!account.windowMs || account.percent <= 0) return null;
    const elapsed = account.windowMs - account.leftMs;
    const used = 100 - account.percent;
    if (elapsed <= 0 || used <= 0) return null;
    if (elapsed / account.windowMs < 0.1) return null;
    const runway = elapsed * (account.percent / used);
    const ratio = runway / account.leftMs;
    if (ratio >= 0.85) return null;
    return { ms: runway, tone: ratio < 0.5 ? "danger" : "warn" };
  }

  const AT_RISK = 10;
  const risky = (accounts) => accounts.filter((a) => a.surplus >= AT_RISK).sort((a, b) => a.leftMs - b.leftMs);

  const pinnedOf = (accounts) => {
    const held = accounts.filter((a) => a.percent > 0);
    return accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
  };

  const soonestReset = (accounts) => {
    const held = accounts.filter((a) => a.percent > 0);
    return Math.min(...(held.length > 0 ? held : accounts).map((a) => a.leftMs));
  };

  /* ------------------------------------------------------------ the row */

  const run = (cls, from, to) => {
    const node = el("i", cls);
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0.6, to - from)}%`;
    return node;
  };

  function draw(box, account) {
    box.style.setProperty("--fill", `${account.percent}%`);
    if (account.pace === null) {
      box.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return;
    }
    box.style.setProperty("--pace", `${account.pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (account.percent > account.pace) box.append(el("i", "w-fill right"));
    if (account.percent < account.pace && account.percent > 0) box.append(el("i", "w-hatch"));
    if (account.surplus >= 0.5) {
      box.append(run("b-void", Math.max(0, account.percent - account.surplus), account.percent));
    }
  }

  function nest(accounts) {
    const stack = el("span", "b-nest");
    for (const account of [...accounts].sort((a, b) => a.leftMs - b.leftMs)) {
      const line = el("span", `b-line${account.pinned ? " pinned" : ""}`);
      const lane = el("span", "b-lane w-lane hue1 tone-ok");
      draw(lane, account);
      line.append(lane);
      stack.append(line);
    }
    return stack;
  }

  const CLOCKS = {
    loss(accounts) {
      const queue = risky(accounts);
      return queue.length > 0
        ? { ms: queue[0].leftMs, tone: "warn" }
        : { ms: soonestReset(accounts), tone: "ok" };
    },
    dry(accounts) {
      return dryIn(pinnedOf(accounts)) ?? { ms: Infinity, tone: "ok" };
    },
    /* The soonest thing that is going to happen, whatever kind it is. */
    next(accounts) {
      const events = [];
      const dry = dryIn(pinnedOf(accounts));
      if (dry !== null) events.push(dry);
      const queue = risky(accounts);
      if (queue.length > 0) events.push({ ms: queue[0].leftMs, tone: "warn" });
      events.push({ ms: soonestReset(accounts), tone: "ok" });
      return events.reduce((first, event) => (event.ms < first.ms ? event : first));
    },
  };

  function row(accounts, clock, tagText = "CO") {
    const node = el("div", `r-row${clock === null ? " v-bare" : ""}`);
    node.append(el("span", "r-tag", tagText));
    const lanes = el("span", "r-lanes");
    lanes.append(nest(accounts));
    node.append(lanes);
    if (clock !== null) {
      const state = CLOCKS[clock](accounts);
      node.append(el("span", `r-tm tone-${state.tone}`, span(state.ms)));
    }
    return node;
  }

  /* ------------------------------------------------- the live shelf shape */

  /** The live payload's accounts, flattened to one drawable line per meter. */
  function liveLines(accounts) {
    const out = [];
    for (const account of accounts) {
      for (const lane of account.lanes) {
        if (lane.metered === false) continue;
        const leftMs = lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - Date.now();
        out.push({
          ...at(lane.remainingPercent, Number.isFinite(leftMs) ? leftMs : WEEK, account.routed, lane.windowMs),
          hue: lane.id,
          real: Number.isFinite(leftMs),
        });
      }
    }
    return out;
  }

  const HUE = {
    five_hour: 0, antigravity_claude: 0,
    seven_day: 1, antigravity_gpt_oss: 1, openrouter_credits: 1,
    seven_day_fable: 2,
  };

  function liveRow(group, clock) {
    const lines = liveLines(group.accounts);
    const node = el("div", `r-row${clock === null ? " v-bare" : ""}`);
    node.append(el("span", "r-tag", group.tag));

    const lanes = el("span", "r-lanes");
    const dots = el("span", "r-dots");
    for (const account of group.accounts) {
      for (const lane of account.lanes) {
        if (lane.metered !== false) continue;
        dots.append(el("i", `w-bool${lane.blocked ? " off" : ""}`));
      }
    }
    if (dots.childElementCount > 0) lanes.append(dots);

    const stack = el("span", "b-nest");
    for (const line of [...lines].sort((a, b) => a.leftMs - b.leftMs)) {
      const wrap = el("span", `b-line${line.pinned ? " pinned" : ""}`);
      const lane = el("span", `b-lane w-lane hue${HUE[line.hue] ?? 1} tone-ok`);
      draw(lane, line);
      wrap.append(lane);
      stack.append(wrap);
    }
    lanes.append(stack);
    node.append(lanes);

    if (clock !== null) {
      const timed = lines.filter((line) => line.real);
      const state = timed.length > 0 ? CLOCKS[clock](timed) : { ms: Infinity, tone: "ok" };
      node.append(el("span", `r-tm tone-${state.tone}`, span(state.ms)));
    }
    return node;
  }

  const STATES = [
    { caption: "your live Codex group · 86 % pinned, two spent",
      accounts: [at(0, 4.19 * DAY), at(86, 5.72 * DAY, true), at(0, 2.11 * DAY)] },
    { caption: "<b>two queued</b> · 78 expiring in 12 h, 71 in 24 h",
      accounts: [at(40, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)] },
    { caption: "<b>cancellation</b> · one starving, one wasting",
      accounts: [at(10, 5.6 * DAY, true), at(90, 1.4 * DAY)] },
    { caption: "burning it down · lasts a day, resets in five",
      accounts: [at(20, 5 * DAY, true), at(60, 4 * DAY), at(0, 2 * DAY)] },
    { caption: "<b>both</b> · pinned dry in hours, a spare losing credit in 12 h",
      accounts: [at(6, 5 * DAY, true), at(85, 12 * HOUR), at(0, 2 * DAY)] },
    { caption: "six accounts, three queued · 8 h, 30 h, 4 d",
      accounts: [at(40, 6 * DAY, true), at(85, 8 * HOUR), at(70, 30 * HOUR), at(78, 4 * DAY), at(0, 1 * DAY), at(20, 2 * DAY)] },
    { caption: "control · steady, nothing at risk",
      accounts: [at(90, 6.5 * DAY, true), at(85, 6 * DAY), at(80, 5.5 * DAY)] },
  ];

  const CLOCK_NAMES = ["loss", "dry", "next"];

  window.QUOTA_ROUND31 = { STATES, CLOCK_NAMES, row, liveRow };
})();
