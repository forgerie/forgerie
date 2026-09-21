/* Round 29: nested rows, and the percentage replaced by time.
 *
 * A level answers "how much is left" and then leaves you to do the division.
 * A duration answers the question you actually have. And once the readout is
 * a duration, both risks become one comparison anyone can make without
 * reading a bar at all:
 *
 *     lasts longer than it takes to reset   ->  credit will expire unspent
 *     lasts less  than it takes to reset    ->  will run dry early
 *
 * The burn rate needs no history. A window states its own length and its own
 * reset, so the elapsed part is known, and the share already spent over that
 * elapsed part is the rate:
 *
 *     elapsed = window - timeLeft
 *     lasts   = elapsed * remaining / used
 *
 * "Remaining" is ambiguous, so three readings of it are drawn:
 *
 *   reset   no number at all. One countdown, to the next thing the group
 *           loses. The lines carry everything else.
 *   pin     how long the pinned account lasts at its own rate, beside when
 *           that account resets. What you are spending, and its deadline.
 *   group   how long the whole provider lasts if you are willing to re-pin,
 *           beside the next moment the group loses something.
 *
 * Antigravity states no window length, so no rate can be derived from it and
 * its runway is blank rather than invented. */

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

  /** How long this account lasts at the rate it has been spent so far. */
  function lasts(account) {
    if (!account.windowMs) return null;
    const elapsed = account.windowMs - account.leftMs;
    const used = 100 - account.percent;
    if (account.percent <= 0) return 0;
    if (elapsed <= 0 || used <= 0) return Infinity;
    return elapsed * (account.percent / used);
  }

  /** The rate the work is actually being done at: the pinned account's. */
  function spendRate(accounts) {
    const held = accounts.filter((a) => a.percent > 0);
    const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
    if (!pin.windowMs) return null;
    const elapsed = pin.windowMs - pin.leftMs;
    const used = 100 - pin.percent;
    return elapsed > 0 && used > 0 ? used / elapsed : 0;
  }

  /**
   * How long the whole provider lasts if re-pinning is on the table.
   *
   * Only one account is ever being spent, so the group's rate is the pinned
   * account's rate, not the sum of every account's. Summing them counted the
   * historical burn of accounts that are already empty and cannot be spent
   * again, which made a healthy group read as thirty-one hours.
   */
  function groupLasts(accounts) {
    const credit = accounts.reduce((sum, a) => sum + (a.windowMs ? a.percent : 0), 0);
    if (credit <= 0) return 0;
    const rate = spendRate(accounts);
    return rate === null || rate <= 0 ? Infinity : credit / rate;
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

  function draw(box, account) {
    box.style.setProperty("--fill", `${account.percent}%`);
    box.style.setProperty("--pace", `${account.pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (account.percent > account.pace) box.append(el("i", "w-fill right"));
    if (account.percent < account.pace && account.percent > 0) box.append(el("i", "w-hatch"));
    if (account.surplus >= 0.5) {
      box.append(run("b-void", Math.max(0, account.percent - account.surplus), account.percent));
    }
  }

  /** One line per account, soonest reset at the top. */
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

  /**
   * Short runway against a long wait is the drain; the reverse is waste.
   *
   * The bands are wide on purpose. A runway is a ratio of two small numbers
   * early in a window, so a rate read a few hours in swings hard, and a
   * threshold at parity turned a marginal shortfall into an amber row. The
   * tone is also withheld until a tenth of the window has run, because
   * before that the rate is not yet a measurement.
   */
  function toneFor(runwayMs, untilMs, settled = true) {
    if (runwayMs === null || !Number.isFinite(runwayMs)) return "ok";
    if (runwayMs <= 0) return "dead";
    if (!settled) return "ok";
    const ratio = runwayMs / untilMs;
    if (ratio < 0.5) return "danger";
    if (ratio < 0.85) return "warn";
    return "ok";
  }

  /** A rate is only a measurement once enough of the window has run. */
  const settledFor = (account) =>
    !account.windowMs || (account.windowMs - account.leftMs) / account.windowMs >= 0.1;

  const READOUTS = {
    reset(accounts) {
      return { text: "", tone: "ok", label: span(nextLoss(accounts)) };
    },
    pin(accounts) {
      const held = accounts.filter((a) => a.percent > 0);
      const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
      const runway = lasts(pin);
      return {
        text: runway === null || !Number.isFinite(runway) ? "" : span(runway),
        tone: toneFor(runway, pin.leftMs, settledFor(pin)),
        label: span(pin.leftMs),
      };
    },
    group(accounts) {
      const held = accounts.filter((a) => a.percent > 0);
      const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
      const runway = groupLasts(accounts);
      const until = nextLoss(accounts);
      return {
        text: Number.isFinite(runway) ? span(runway) : "",
        tone: toneFor(runway, until, settledFor(pin)),
        label: span(until),
      };
    },

    /* `pin` loses the waste deadline because its countdown belongs to the
       pinned account; `group` loses the drain because its number is the whole
       provider. Taking one slot from each keeps both: how long you last, and
       when the group next throws something away. */
    mix(accounts) {
      const held = accounts.filter((a) => a.percent > 0);
      const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
      const runway = lasts(pin);
      return {
        text: runway === null || !Number.isFinite(runway) ? "" : span(runway),
        tone: toneFor(runway, pin.leftMs, settledFor(pin)),
        label: span(nextLoss(accounts)),
      };
    },
  };

  function row(accounts, readout) {
    const node = el("div", "r-row");
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);

    const lanes = el("span", "r-lanes");
    lanes.append(nest(accounts));
    node.append(lanes);

    const state = READOUTS[readout](accounts);
    const value = el("span", `r-val time tone-${state.tone}`);
    value.textContent = state.text;
    node.append(value);
    const time = el("span", "r-tm");
    time.textContent = state.label;
    node.append(time);
    return node;
  }

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
      caption: "<b>three queued</b> · 6 h, 18 h and 3 d",
      accounts: [at(40, 5 * DAY, true), at(90, 6 * HOUR), at(75, 18 * HOUR), at(80, 3 * DAY)],
    },
    {
      caption: "<b>cancellation</b> · one starving, one wasting",
      accounts: [at(10, 5.6 * DAY, true), at(90, 1.4 * DAY)],
    },
    {
      caption: "burning it down · pinned lasts a day, resets in five",
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
  ];

  const NOTE = "mix · how long the pinned account lasts, and when the group next loses something";

  const FACTS = STATES.map((state) => {
    const held = state.accounts.filter((a) => a.percent > 0);
    const pin = state.accounts.find((a) => a.pinned) ?? held[0];
    return {
      pin: `${span(lasts(pin))} against ${span(pin.leftMs)}`,
      group: `${span(groupLasts(state.accounts))} against ${span(nextLoss(state.accounts))}`,
    };
  });

  window.QUOTA_ROUND29 = { STATES, FACTS, NOTE, READOUTS: Object.keys(READOUTS), row };
})();
