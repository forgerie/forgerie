/* Round 27: more than one account at risk at once.
 *
 * `fuse` reports the worst single account, so a group with two losses queued
 * behind each other tells you about the first and hides the second. Two
 * accounts expiring in 12 h and 24 h read as one problem in 12 h; the second
 * only appears after the first has already gone, by which time there are 12 h
 * left to spend it rather than 24. The row hands you a sequence of surprises
 * instead of a picture.
 *
 * `slots` is out: partitioning the bar by account count does not scale.
 *
 * Five answers, all one row:
 *
 *   fuse    the baseline. Worst single account, its deadline. The flaw.
 *   sum     the number becomes everything the group is about to lose, so two
 *           accounts losing 78 and 71 read 149 %. Over 100 says plainly that
 *           it is more than one account's worth. The countdown stays on the
 *           nearest deadline.
 *   list    the worst amount, and the countdown prints every deadline, the
 *           way the shipped drained row already prints `4d · 2d`.
 *   when    the readout is `fuse`, and the bar's axis becomes time: each
 *           account is a block leaning on its own deadline, so the queue is
 *           the picture. The axis is square-rooted, because on a linear
 *           seven-day scale 12 h and 24 h are 7 % apart and unreadable.
 *   queue   the readout is `fuse`, the bar is left alone, and a pip rides
 *           under it for each account about to lose something, placed on the
 *           same compressed time axis.
 *
 * `when` and `queue` both spend something. `when` changes what a bar's length
 * means, which no other row on the shelf does. `queue` adds a second rail
 * under the first, so the row's graphic goes from three pixels to six. */

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
  const total = (values) => values.reduce((sum, value) => sum + value, 0);

  const at = (percent, leftMs, pinned = false) => ({
    percent: clamp(percent),
    leftMs,
    pinned,
    pace: clamp((leftMs / WEEK) * 100),
    get surplus() { return Math.max(0, this.percent - this.pace); },
  });

  const span = (ms) => {
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    const hours = ms / HOUR;
    return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  };

  const toneOf = (share) => (share <= 0 ? "dead" : share < 10 ? "danger" : share < 30 ? "warn" : "ok");

  /* An account counts as at risk once its unspent balance is material. Ten
     points is the same guess round 26 made and is still a guess. */
  const AT_RISK = 10;
  const risky = (accounts) => accounts.filter((a) => a.surplus >= AT_RISK).sort((a, b) => a.leftMs - b.leftMs);

  /* Twelve hours and twenty-four hours sit 7 % apart on a linear seven-day
     axis, which is not a gap anyone can read. The square root pulls the near
     future open and pushes the far future together, which is the right way
     round for a deadline. */
  const place = (leftMs) => Math.sqrt(Math.max(0, Math.min(1, leftMs / WEEK))) * 100;

  const run = (cls, from, to) => {
    const node = el("i", cls);
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0.6, to - from)}%`;
    return node;
  };

  /** The pooled bar every treatment but `when` keeps. */
  function pooled(lane, accounts) {
    const fill = mean(accounts.map((a) => a.percent));
    const pace = mean(accounts.map((a) => a.pace));
    const risk = mean(accounts.map((a) => a.surplus));
    lane.style.setProperty("--fill", `${fill}%`);
    lane.style.setProperty("--pace", `${pace}%`);
    lane.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) lane.append(el("i", "w-fill right"));
    if (fill < pace && fill > 0) lane.append(el("i", "w-hatch"));
    if (risk >= 0.5) lane.append(run("b-void", Math.max(0, fill - risk), fill));
  }

  const BARS = {
    fuse: pooled,
    sum: pooled,
    list: pooled,
    queue: pooled,
    both: pooled,

    when(lane, accounts) {
      lane.append(el("i", "w-ground full"));
      for (const account of accounts) {
        if (account.percent <= 0) continue;
        const right = place(account.leftMs);
        const width = account.percent / accounts.length;
        lane.append(run(`b-block${account.surplus >= AT_RISK ? " burning" : ""}`,
          Math.max(0, right - width), right));
      }
    },
  };

  /** One pip per account about to lose something, on the same time axis. */
  function queueRail(accounts) {
    const rail = el("span", "b-queue");
    for (const account of risky(accounts)) {
      const pip = el("i", "b-pip");
      pip.style.left = `${place(account.leftMs)}%`;
      rail.append(pip);
    }
    return rail.childElementCount > 0 ? rail : null;
  }

  function readout(accounts, treatment) {
    const held = accounts.filter((a) => a.percent > 0);
    const clock = (held.length > 0 ? held : accounts).map((a) => a.leftMs);
    const ms = clock.length === 0 ? Infinity : Math.min(...clock);
    const pin = accounts.find((a) => a.pinned) ?? held[0] ?? accounts[0];
    const queue = risky(accounts);
    // The pinned account running dry stops the work; a spare wasting only
    // costs money. The first outranks the second.
    if (pin.percent < 10 || queue.length === 0) {
      return { text: `${Math.round(pin.percent)}%`, tone: toneOf(pin.percent), ms };
    }
    if (treatment === "sum") {
      return { text: `${Math.round(total(queue.map((a) => a.surplus)))}%`, tone: "warn", ms: queue[0].leftMs, burn: true };
    }
    if (treatment === "list") {
      return {
        text: `${Math.round(queue[0].surplus)}%`,
        tone: "warn",
        label: queue.slice(0, 3).map((a) => span(a.leftMs)).join("·"),
        ms: queue[0].leftMs,
        burn: true,
      };
    }
    // The two slots answering two questions: how much in total, and on what
    // schedule. Over 100 % already says it is more than one account, so a
    // third deadline can be dropped without hiding that fact.
    if (treatment === "both") {
      return {
        text: `${Math.round(total(queue.map((a) => a.surplus)))}%`,
        tone: "warn",
        label: queue.slice(0, 2).map((a) => span(a.leftMs)).join("·"),
        ms: queue[0].leftMs,
        burn: true,
      };
    }
    return { text: `${Math.round(queue[0].surplus)}%`, tone: "warn", ms: queue[0].leftMs, burn: true };
  }

  function row(accounts, treatment) {
    const node = el("div", "r-row");
    const tag = el("span", "r-tag");
    tag.textContent = "CO";
    node.append(tag);

    const lanes = el("span", "r-lanes");
    const stack = el("span", "b-stack");
    const lane = el("span", `b-lane w-lane hue1 tone-ok t-${treatment}`);
    BARS[treatment](lane, accounts);
    stack.append(lane);
    if (treatment === "queue") {
      const rail = queueRail(accounts);
      if (rail !== null) stack.append(rail);
    }
    lanes.append(stack);
    node.append(lanes);

    const state = readout(accounts, treatment);
    const value = el("span", `r-val tone-${state.tone}`);
    value.textContent = state.text;
    node.append(value);
    const time = el("span", `r-tm${state.burn ? " burn" : ""}`);
    time.textContent = state.label ?? span(state.ms);
    node.append(time);
    return node;
  }

  const STATES = [
    {
      caption: "<b>two queued</b> · 78 expiring in 12 h, 71 in 24 h",
      accounts: [at(40, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)],
    },
    {
      caption: "<b>three queued</b> · 6 h, 18 h and 3 d",
      accounts: [at(40, 5 * DAY, true), at(90, 6 * HOUR), at(75, 18 * HOUR), at(80, 3 * DAY)],
    },
    {
      caption: "one at risk only · 79 in 5 h",
      accounts: [at(30, 5 * DAY, true), at(88, 5 * HOUR), at(0, 3 * DAY)],
    },
    {
      caption: "six accounts, three queued · 8 h, 30 h, 4 d",
      accounts: [at(40, 6 * DAY, true), at(85, 8 * HOUR), at(70, 30 * HOUR), at(78, 4 * DAY), at(0, 1 * DAY), at(20, 2 * DAY)],
    },
    {
      caption: "pinned nearly dry while two are queued",
      accounts: [at(5, 5 * DAY, true), at(85, 12 * HOUR), at(80, 24 * HOUR)],
    },
    {
      caption: "control · nothing at risk",
      accounts: [at(90, 6.5 * DAY, true), at(85, 6 * DAY), at(80, 5.5 * DAY)],
    },
  ];

  const TREATMENTS = ["fuse", "sum", "list", "when", "queue", "both"];

  const FACTS = STATES.map((state) => {
    const queue = risky(state.accounts);
    return {
      queue: queue.map((a) => `${Math.round(a.surplus)} in ${span(a.leftMs)}`).join(" · ") || "none",
      total: Math.round(total(queue.map((a) => a.surplus))),
    };
  });

  window.QUOTA_ROUND27 = { STATES, TREATMENTS, FACTS, row };
})();
