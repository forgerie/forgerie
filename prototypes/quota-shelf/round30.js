/* Round 30: no numbers at all.
 *
 * With the value and the countdown both gone the row is a tag and a stack of
 * lanes, and every fact has to be in the drawing. Two things follow.
 *
 * The lanes get wider. The two trailing columns and their gaps were about
 * 70 px of a 360 px row, so dropping them gives the lanes roughly a third
 * more length to say the same things in.
 *
 * And two facts leave with the numbers:
 *
 *   absolute time   the cut states the share of the window still to run, not
 *                   the hours. Within a group that is enough, because every
 *                   account of a provider shares a window length, so the cuts
 *                   are comparable. Across groups it is not: a five-hour lane
 *                   and a seven-day lane at the same cut mean an hour and a
 *                   day.
 *
 * `dry` was built on a second claim that turned out to be false, and is kept
 * here as the disproof rather than as a candidate.
 *
 * The claim was that fill-against-cut and runway-against-reset ask different
 * questions. They do not, because the rate is derived from the same two
 * numbers the cut is:
 *
 *     runway < timeLeft
 *     (W - L) * r / (100 - r) < L
 *     r * W < 100 * L
 *     r < 100 * L / W
 *     fill < pace                        <- exactly the hatch condition
 *
 * `dry-check.mjs` sweeps 400,599 combinations and finds one disagreement, at
 * fill = pace = 1, which is a rounding tie. So the tick is the hatch drawn
 * twice. No history reaches the shelf, so no rate estimate made from the
 * payload can carry anything the geometry does not already hold.
 *
 * What survives: the runway as a *number*. Hours are the one quantity a mark
 * on a fraction axis cannot express, which is the whole argument for keeping
 * any text on the row at all. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const WEEK = 7 * DAY;

  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));

  const at = (percent, leftMs, pinned = false, windowMs = WEEK) => ({
    percent: clamp(percent),
    leftMs,
    windowMs,
    pinned,
    pace: clamp((leftMs / windowMs) * 100),
    get surplus() { return Math.max(0, this.percent - this.pace); },
  });

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  function lasts(account) {
    if (!account.windowMs) return null;
    const elapsed = account.windowMs - account.leftMs;
    const used = 100 - account.percent;
    if (account.percent <= 0) return 0;
    if (elapsed <= 0 || used <= 0) return Infinity;
    return elapsed * (account.percent / used);
  }

  /** The runway as a share of the window, so it can sit on the same axis. */
  function dryShare(account) {
    const runway = lasts(account);
    if (runway === null || !Number.isFinite(runway)) return null;
    return clamp((runway / account.windowMs) * 100);
  }

  const AT_RISK = 10;
  const risky = (accounts) => accounts.filter((a) => a.surplus >= AT_RISK).sort((a, b) => a.leftMs - b.leftMs);
  const nextLoss = (accounts) => {
    const queue = risky(accounts);
    const held = accounts.filter((a) => a.percent > 0);
    return queue.length > 0
      ? queue[0].leftMs
      : Math.min(...(held.length > 0 ? held : accounts).map((a) => a.leftMs));
  };

  const run = (cls, from, to) => {
    const node = el("i", cls);
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0.6, to - from)}%`;
    return node;
  };

  function draw(box, account, withDry) {
    box.style.setProperty("--fill", `${account.percent}%`);
    box.style.setProperty("--pace", `${account.pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (account.percent > account.pace) box.append(el("i", "w-fill right"));
    if (account.percent < account.pace && account.percent > 0) box.append(el("i", "w-hatch"));
    if (account.surplus >= 0.5) {
      box.append(run("b-void", Math.max(0, account.percent - account.surplus), account.percent));
    }
    if (withDry) {
      const share = dryShare(account);
      if (share !== null && account.percent > 0) {
        const tick = el("i", `b-dry${share < account.pace ? " short" : ""}`);
        tick.style.left = `${share}%`;
        box.append(tick);
      }
    }
  }

  function nest(accounts, withDry) {
    const stack = el("span", "b-nest");
    for (const account of [...accounts].sort((a, b) => a.leftMs - b.leftMs)) {
      const line = el("span", `b-line${account.pinned ? " pinned" : ""}`);
      const lane = el("span", "b-lane w-lane hue1 tone-ok");
      draw(lane, account, withDry);
      line.append(lane);
      stack.append(line);
    }
    return stack;
  }

  const toneOf = (runway, until) => {
    if (runway === null || !Number.isFinite(runway)) return "ok";
    if (runway <= 0) return "dead";
    const ratio = runway / until;
    if (ratio < 0.5) return "danger";
    if (ratio < 0.85) return "warn";
    return "ok";
  };

  /** Round 29's readout, kept only so what the numbers said stays visible. */
  function mixReadout(accounts) {
    const held = accounts.filter((a) => a.percent > 0);
    const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
    const runway = lasts(pin);
    const settled = !pin.windowMs || (pin.windowMs - pin.leftMs) / pin.windowMs >= 0.1;
    return {
      text: runway === null || !Number.isFinite(runway) ? "" : span(runway),
      tone: settled ? toneOf(runway, pin.leftMs) : "ok",
      label: span(nextLoss(accounts)),
    };
  }

  function row(accounts, variant) {
    const node = el("div", `r-row v-${variant}`);
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);

    const lanes = el("span", "r-lanes");
    lanes.append(nest(accounts, variant === "dry"));
    node.append(lanes);

    if (variant === "mix") {
      const state = mixReadout(accounts);
      const value = el("span", `r-val time tone-${state.tone}`);
      value.textContent = state.text;
      const time = el("span", "r-tm");
      time.textContent = state.label;
      node.append(value, time);
    }
    return node;
  }

  const FIVE = 5 * HOUR;

  const STATES = [
    {
      caption: "your live Codex group · 86 % pinned, two spent",
      accounts: [at(0, 4.19 * DAY), at(86, 5.72 * DAY, true), at(0, 2.11 * DAY)],
    },
    {
      caption: "<b>two queued</b> · 78 expiring in 12 h, 71 in 24 h",
      accounts: [at(40, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)],
    },
    {
      caption: "<b>cancellation</b> · one starving, one wasting",
      accounts: [at(10, 5.6 * DAY, true), at(90, 1.4 * DAY)],
    },
    {
      caption: "burning it down · lasts a day, resets in five",
      accounts: [at(20, 5 * DAY, true), at(60, 4 * DAY), at(0, 2 * DAY)],
    },
    {
      caption: "six accounts, three queued · 8 h, 30 h, 4 d",
      accounts: [at(40, 6 * DAY, true), at(85, 8 * HOUR), at(70, 30 * HOUR), at(78, 4 * DAY), at(0, 1 * DAY), at(20, 2 * DAY)],
    },
    {
      caption: "control · steady, nothing at risk",
      accounts: [at(90, 6.5 * DAY, true), at(85, 6 * DAY), at(80, 5.5 * DAY)],
    },
    {
      caption: "<b>the same picture, different clocks</b> · a 7 d lane and a 5 h lane, both a third through",
      accounts: [at(65, 4.6 * DAY, true), at(65, 3.3 * HOUR, false, FIVE)],
    },
  ];

  const VARIANTS = ["mix", "bare", "dry"];

  window.QUOTA_ROUND30 = { STATES, VARIANTS, row };
})();
