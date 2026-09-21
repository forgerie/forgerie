/* Round 26: making the risk legible on one line.
 *
 * The pooled bar works arithmetically and reads poorly, and the reason is the
 * same in both directions: its length is a mean. 0, 86 and 0 make 28.7, which
 * describes no account and cannot be spent. Drawing the risk as a sub-region
 * of that length asks the eye to read a fraction of an abstraction, and then
 * divides it by the account count on top.
 *
 * So this round stops defending that one bar and tries five places to put the
 * risk, all of them still a single line per provider:
 *
 *   now     the pooled bar with the hollow. The baseline that is unclear.
 *   front   the same bar, but the at-risk share is solid amber at the near
 *           end rather than hollow at the far one: the part to spend first.
 *   slots   the bar partitioned into one slot per account, soonest reset
 *           first, so position means time. A slot goes amber when its own
 *           surplus is material. Weight on the left is the risk, read from
 *           the shape rather than from a sub-region.
 *   fuse    the bar is left alone and the risk moves into the readout: the
 *           number becomes the points one account is about to lose and the
 *           countdown becomes that account's deadline.
 *   when    the lane's axis stops being capacity and becomes time. Zero is
 *           the reset, full width is a fresh window, and each account is a
 *           block leaning against its own deadline, sized by what it holds.
 *           A block pinned to the left wall is credit about to evaporate.
 *
 * `when` is the only one that changes what the axis means, which is a real
 * cost: on every other row of the shelf a bar's length is a level. */

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
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

  /** An account reduced to the three numbers every treatment needs. */
  const at = (percent, leftMs, pinned = false) => ({
    percent: clamp(percent),
    leftMs,
    pinned,
    pace: clamp((leftMs / WEEK) * 100),
    get surplus() { return Math.max(0, this.percent - this.pace); },
    get shortfall() { return Math.max(0, this.pace - this.percent); },
  });

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  const toneOf = (share) => (share <= 0 ? "dead" : share < 10 ? "danger" : share < 30 ? "warn" : "ok");

  /** The account whose unspent balance is closest to evaporating. */
  const worstWaste = (accounts) => accounts
    .filter((a) => a.surplus > 0)
    .reduce((worst, a) => (worst === null || a.surplus > worst.surplus ? a : worst), null);

  /** Ground, fill and the split cut, into whatever box is handed over. */
  function body(box, fill, pace, { hatch = true } = {}) {
    box.style.setProperty("--fill", `${fill}%`);
    box.style.setProperty("--pace", `${pace}%`);
    const behind = hatch && fill < pace && fill > 0;
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) box.append(el("i", "w-fill right"));
    if (behind) box.append(el("i", "w-hatch"));
    return behind;
  }

  const run = (cls, from, to) => {
    const node = el("i", cls);
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0, to - from)}%`;
    return node;
  };

  const BARS = {
    now(lane, accounts) {
      const fill = mean(accounts.map((a) => a.percent));
      const risk = mean(accounts.map((a) => a.surplus));
      body(lane, fill, mean(accounts.map((a) => a.pace)));
      if (risk >= 0.5) lane.append(run("b-void", Math.max(0, fill - risk), fill));
    },

    front(lane, accounts) {
      const fill = mean(accounts.map((a) => a.percent));
      const risk = Math.min(fill, mean(accounts.map((a) => a.surplus)));
      body(lane, fill, mean(accounts.map((a) => a.pace)));
      if (risk >= 0.5) lane.append(run("b-burn", 0, risk));
    },

    slots(lane, accounts) {
      const ordered = [...accounts].sort((a, b) => a.leftMs - b.leftMs);
      const width = 100 / ordered.length;
      for (const [index, account] of ordered.entries()) {
        const slot = el("span", "b-slot");
        slot.style.left = `${index * width}%`;
        slot.style.width = `${width}%`;
        // A slot whose own surplus is material burns amber, so the risk is a
        // colour on a located segment rather than a fraction of a mean.
        if (account.surplus >= 15) slot.classList.add("burning");
        body(slot, account.percent, account.pace);
        lane.append(slot);
        if (index > 0) {
          const seam = el("i", "b-riser");
          seam.style.left = `${index * width}%`;
          lane.append(seam);
        }
      }
    },

    fuse(lane, accounts) {
      BARS.now(lane, accounts);
    },

    /* Time, not capacity. Zero is the reset, full width is a fresh window,
       and a block's right edge sits on its own deadline. */
    when(lane, accounts) {
      lane.append(el("i", "w-ground full"));
      for (const account of accounts) {
        if (account.percent <= 0) continue;
        const width = account.percent / accounts.length;
        const right = account.pace;
        const block = run(`b-block${account.surplus >= 15 ? " burning" : ""}`,
          Math.max(0, right - width), right);
        lane.append(block);
      }
    },
  };

  /** The number and the countdown, which `fuse` takes over. */
  function readout(accounts, treatment) {
    const held = accounts.filter((a) => a.percent > 0);
    const clock = (held.length > 0 ? held : accounts).map((a) => a.leftMs);
    const ms = clock.length === 0 ? Infinity : Math.min(...clock);
    const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];

    if (treatment === "fuse") {
      const worst = worstWaste(accounts);
      // The pinned account running dry outranks a spare wasting: one stops
      // the work, the other only costs money. Ten points is a guess and
      // stays a guess until it is watched on real figures.
      const starving = pin.percent < 10;
      if (!starving && worst !== null && worst.surplus >= 10) {
        return { text: `${Math.round(worst.surplus)}%`, tone: "warn", ms: worst.leftMs, burn: true };
      }
    }
    return { text: `${Math.round(pin.percent)}%`, tone: toneOf(pin.percent), ms };
  }

  function row(accounts, treatment) {
    const node = el("div", "r-row");
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);

    const lanes = el("span", "r-lanes");
    const lane = el("span", `b-lane w-lane hue1 tone-ok t-${treatment}`);
    BARS[treatment](lane, accounts);
    lanes.append(lane);
    node.append(lanes);

    const state = readout(accounts, treatment);
    const value = el("span", `r-val tone-${state.tone}`);
    value.textContent = state.text;
    node.append(value);
    const time = el("span", `r-tm${state.burn ? " burn" : ""}`);
    time.textContent = span(state.ms);
    node.append(time);
    return node;
  }

  const STATES = [
    {
      caption: "your live Codex group · 86 % pinned with 5.7 d, two spent",
      accounts: [at(0, 4.19 * DAY), at(86, 5.72 * DAY, true), at(0, 2.11 * DAY)],
    },
    {
      caption: "a spare holding 88 % that resets in 5 h · <b>79 points about to go</b>",
      accounts: [at(30, 5 * DAY, true), at(88, 5 * HOUR), at(0, 3 * DAY)],
    },
    {
      caption: "two spares holding 90 % and 70 %, resetting in 8 h and 30 h",
      accounts: [at(25, 5 * DAY, true), at(90, 8 * HOUR), at(70, 30 * HOUR)],
    },
    {
      caption: "the pinned account nearly dry, spares full · <b>burning too fast</b>",
      accounts: [at(6, 5 * DAY, true), at(90, 6 * DAY), at(80, 5.5 * DAY)],
    },
    {
      caption: "six accounts, one about to lose 80",
      accounts: [at(40, 6 * DAY, true), at(85, 6 * HOUR), at(50, 3.5 * DAY), at(30, 2 * DAY), at(0, 1 * DAY), at(60, 4 * DAY)],
    },
    {
      caption: "<b>both at once</b> · pinned at 5 % and a spare losing 84 in 4 h",
      accounts: [at(5, 5 * DAY, true), at(85, 4 * HOUR), at(0, 2 * DAY)],
    },
    {
      caption: "control · everything on pace, nothing at risk",
      accounts: [at(90, 6.5 * DAY, true), at(85, 6 * DAY), at(80, 5.5 * DAY)],
    },
  ];

  const TREATMENTS = ["now", "front", "slots", "fuse", "when"];

  /** Stated per state so the drawing can be checked against the arithmetic. */
  const FACTS = STATES.map((state) => {
    const worst = worstWaste(state.accounts);
    return {
      each: state.accounts.map((a) => Math.round(a.surplus)).join(" · "),
      worst: worst === null ? 0 : Math.round(worst.surplus),
      deadline: worst === null ? "" : span(worst.leftMs),
      pooled: Math.round(mean(state.accounts.map((a) => a.surplus))),
    };
  });

  window.QUOTA_ROUND26 = { STATES, TREATMENTS, FACTS, row };
})();
