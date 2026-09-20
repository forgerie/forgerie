/* Round 20: a single bar that does not cancel.
 *
 * Round 19 killed `pool` on one fact: it averages a signed quantity. Account
 * A is 70 points behind pace, account B is 70 ahead, the mean overshoot is
 * zero, and the lane draws as perfectly on pace while B is about to lose
 * nearly everything.
 *
 * That is a fault in the arithmetic, not in the idea of one bar. Waste never
 * cancels in reality — one account being short does not un-waste another — so
 * the shelf should not let it cancel either:
 *
 *     at risk  =  mean of max(0, fill - pace)      never negative, never nets
 *
 * Four single-bar treatments, all one lane per group:
 *
 *   pool    round 15 unchanged, the baseline that cancels
 *   risk    the pooled fill, with the at-risk share hollowed at its far end
 *   front   the same share hollowed at the near end: spend this first
 *   share   the bar partitioned into one contiguous slot per account, in
 *           reset order, each slot carrying its own cut and its own surplus
 *
 * `share` is the only one that still names which account. The other three
 * trade that away for one smooth level, which is the reading the whole idea
 * was for. */

(() => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const NOW = window.QUOTA_FIXTURE.NOW;
  const WEEK = 7 * DAY;

  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  /** One Codex account: a level, and the moment its window turns over. */
  const at = (percent, leftMs) => ({ percent, leftMs, pace: (leftMs / WEEK) * 100 });

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const clamp = (value) => Math.max(0, Math.min(100, value));

  /** What the group throws away if nothing changes. Positive terms only. */
  const atRisk = (accounts) => mean(accounts.map((a) => Math.max(0, clamp(a.percent) - a.pace)));

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  /* --- the lane bodies ------------------------------------------------- */

  /** Ground, fill and the split cut, drawn into whatever box is given. */
  function body(box, fill, pace) {
    box.style.setProperty("--fill", `${fill}%`);
    if (pace === null) {
      box.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return box;
    }
    box.style.setProperty("--pace", `${pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) box.append(el("i", "w-fill right"));
    if (fill < pace && fill > 0) box.append(el("i", "w-hatch"));
    return box;
  }

  /** The hollow run that says "this much of the fill expires unspent". */
  function voidRun(from, to) {
    const run = el("i", "b-void");
    run.style.left = `${from}%`;
    run.style.width = `${Math.max(0, to - from)}%`;
    return run;
  }

  const BARS = {
    // Round 15 unchanged: the mean fill, the mean cut, nothing else.
    pool(lane, accounts) {
      body(lane, mean(accounts.map((a) => clamp(a.percent))), mean(accounts.map((a) => a.pace)));
      for (let seam = 1; seam < accounts.length; seam += 1) {
        const tick = el("i", "b-seam");
        tick.style.left = `${(seam / accounts.length) * 100}%`;
        lane.append(tick);
      }
    },

    // The same bar, with the at-risk share hollowed at the fill's far end.
    // It reads as "you hold this much, and this much of it is rotting".
    risk(lane, accounts) {
      const fill = mean(accounts.map((a) => clamp(a.percent)));
      body(lane, fill, mean(accounts.map((a) => a.pace)));
      const risk = Math.min(fill, atRisk(accounts));
      if (risk > 0.5) lane.append(voidRun(fill - risk, fill));
    },

    // The same share, hollowed at the near end instead: the perishable part
    // of the tank is the part to spend first.
    front(lane, accounts) {
      const fill = mean(accounts.map((a) => clamp(a.percent)));
      body(lane, fill, mean(accounts.map((a) => a.pace)));
      const risk = Math.min(fill, atRisk(accounts));
      if (risk > 0.5) lane.append(voidRun(0, risk));
    },

    // One contiguous slot per account, soonest reset first. Each slot keeps
    // its own cut and its own surplus, so nothing is averaged and nothing
    // cancels. The boundaries are risers above the bar rather than gaps in
    // it, so the lane stays one bar.
    share(lane, accounts) {
      const ordered = [...accounts].sort((a, b) => a.leftMs - b.leftMs);
      const width = 100 / ordered.length;
      for (const [index, account] of ordered.entries()) {
        const slot = el("span", "b-slot");
        slot.style.left = `${index * width}%`;
        slot.style.width = `${width}%`;
        const fill = clamp(account.percent);
        body(slot, fill, account.pace);
        if (fill > account.pace) slot.append(voidRun(account.pace, fill));
        lane.append(slot);
        if (index > 0) {
          const seam = el("i", "b-riser");
          seam.style.left = `${index * width}%`;
          lane.append(seam);
        }
      }
    },
  };

  const TREATMENTS = ["pool", "risk", "front", "share"];

  function row(accounts, treatment) {
    const fill = mean(accounts.map((a) => clamp(a.percent)));
    const tone = fill <= 0 ? "dead" : fill < 10 ? "danger" : fill < 30 ? "warn" : "ok";
    const node = el("div", "r-row");
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);
    const lanes = el("span", "r-lanes");
    const lane = el("span", `b-lane w-lane hue1 tone-${tone}`);
    BARS[treatment](lane, accounts);
    lanes.append(lane);
    node.append(lanes);
    const value = el("span", `r-val tone-${tone}`);
    value.textContent = `${Math.round(fill)}%`;
    node.append(value);
    const time = el("span", "r-tm");
    time.textContent = span(Math.min(...accounts.map((a) => a.leftMs)));
    node.append(time);
    return node;
  }

  /* Seven groups. Two pairs are the ties round 17 found: 100/0 beside 50/50,
     and the cancellation pair round 19 found. The last is a control where
     nothing is at risk, so a treatment that marks it is crying wolf. */
  const STATES = [
    { caption: "cancellation · 10 % with most of its window left, 90 % with little", accounts: [at(10, 0.8 * WEEK), at(90, 0.2 * WEEK)] },
    { caption: "the live Codex group · 95, 0, 0", accounts: [at(95, 6 * DAY), at(0, 4 * DAY), at(0, 2.7 * DAY)] },
    { caption: "two · 100 and 0", accounts: [at(100, 4.5 * DAY), at(0, 4.5 * DAY)] },
    { caption: "two · 50 and 50", accounts: [at(50, 4.5 * DAY), at(50, 4.5 * DAY)] },
    { caption: "the bench left alone · 15 at 2d, 100 at 1d, 60 at 2h", accounts: [at(15, 2 * DAY), at(100, 1 * DAY), at(60, 2 * HOUR)] },
    { caption: "six accounts", accounts: [at(95, 6.5 * DAY), at(85, 5.5 * DAY), at(70, 4.5 * DAY), at(55, 3.5 * DAY), at(40, 2.5 * DAY), at(25, 1.5 * DAY)] },
    { caption: "control · everything on pace, nothing at risk", accounts: [at(90, 6.5 * DAY), at(85, 6 * DAY), at(80, 5.5 * DAY)] },
  ];

  const RISKS = STATES.map((state) => Math.round(atRisk(state.accounts)));

  window.QUOTA_ROUND20 = { STATES, RISKS, TREATMENTS, row };
})();
