/* Round 32: five Codex accounts, and how loud the doom gets.
 *
 * Codex only from here. Five accounts, three of them resetting at 6 h, 24 h
 * and 48 h, every one holding credit it will not spend in time.
 *
 * The starting point is that the row already states when. Every account of a
 * provider shares a window length, so the pace cut is a clock: six hours of a
 * seven-day window puts the cut at 3.6 % from the left, twenty-four hours at
 * 14 %, forty-eight at 28 %. And the hollow starts at the cut, so its left
 * edge is the deadline and its length is the size of the loss. Both facts are
 * drawn already.
 *
 * What is missing is not information, it is emphasis. Three hollows at 6 h,
 * 24 h and 48 h are the same amber, so the eye has to measure positions to
 * find the urgent one. Each of these gives nearness an intensity, and none of
 * them takes a pixel of space, because every one reuses a mark that is
 * already on the lane.
 *
 *   flat     the control. One amber for every deadline.
 *   fade     the amber dims with distance. Imminent is full strength,
 *            two days out is a whisper.
 *   solid    the hollow fills in as the deadline closes. Far out it is an
 *            outline, close up it is a bar.
 *   weight   the outline thickens, 1 px out to 3 px.
 *   pip      one amber dot at the cut, growing as the deadline nears, with
 *            the hollow left flat.
 *
 * Nearness runs on a three-day horizon with a square-root curve, which pushes
 * the near end apart where the difference matters: 6 h reads 0.71, 24 h 0.42,
 * 48 h 0.18, and anything from three days out is 0. */

(() => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const HORIZON = 3 * DAY;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));
  const unit = (value) => Math.max(0, Math.min(1, value));

  /** 0 at the horizon and beyond, 1 at the deadline, curved to open up the near end. */
  const nearness = (leftMs) => 1 - Math.sqrt(unit(leftMs / HORIZON));

  const at = (percent, leftMs, pinned = false) => ({
    percent: clamp(percent),
    leftMs,
    pinned,
    pace: clamp((leftMs / WEEK) * 100),
    get surplus() { return Math.max(0, this.percent - this.pace); },
    get near() { return nearness(this.leftMs); },
  });

  const AT_RISK = 8;

  /* ------------------------------------------------------- the treatments */

  const DOOM = {
    flat: () => ({}),
    fade: (near) => ({ opacity: (0.28 + 0.72 * near).toFixed(3) }),
    solid: (near) => ({ background: `rgba(224, 158, 62, ${(near * 0.92).toFixed(3)})` }),
    weight: (near) => ({ boxShadow: `inset 0 0 0 ${1 + Math.round(near * 2)}px var(--warn)` }),
    pip: () => ({ pip: true }),
  };

  function hollow(account, mode) {
    const node = el("i", "d-void");
    const from = account.percent - account.surplus;
    node.style.left = `${from}%`;
    node.style.width = `${Math.max(0.8, account.surplus)}%`;
    const style = DOOM[mode](account.near);
    if (style.pip) {
      node.classList.add("bare");
      const dot = el("i", "d-pip");
      const size = 2 + account.near * 3.4;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.left = `${from}%`;
      return [node, dot];
    }
    Object.assign(node.style, style);
    return [node];
  }

  function draw(box, account, mode) {
    box.style.setProperty("--fill", `${account.percent}%`);
    box.style.setProperty("--pace", `${account.pace}%`);
    box.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (account.percent > account.pace) box.append(el("i", "w-fill right"));
    if (account.percent < account.pace && account.percent > 0) box.append(el("i", "w-hatch"));
    if (account.surplus >= AT_RISK) box.append(...hollow(account, mode));
  }

  function row(accounts, mode) {
    const node = el("div", "r-row v-bare");
    node.append(el("span", "r-tag", "CO"));
    const lanes = el("span", "r-lanes");
    const stack = el("span", "d-nest");
    for (const account of [...accounts].sort((a, b) => a.leftMs - b.leftMs)) {
      const line = el("span", `d-line${account.pinned ? " pinned" : ""}`);
      const lane = el("span", "d-lane w-lane hue1 tone-ok");
      draw(lane, account, mode);
      line.append(lane);
      stack.append(line);
    }
    lanes.append(stack);
    node.append(lanes);
    return node;
  }

  /* ------------------------------------------------------------- the cases */

  const STATES = [
    {
      caption: "<b>the case</b> · five accounts, three resetting at 6 h, 24 h and 48 h, all holding credit",
      note: "The three doomed lanes sit at the top, soonest first. Their hollows start at 3.6 %, 14 % and 28 % of the lane.",
      accounts: [at(78, 6 * HOUR), at(64, 24 * HOUR), at(71, 48 * HOUR), at(52, 5 * DAY, true), at(30, 6.4 * DAY)],
    },
    {
      caption: "<b>urgency against amount</b> · a sliver lost in 6 h, a fortune lost in 48 h",
      note: "Length says how much, intensity says how soon. This is the state that shows whether they fight.",
      accounts: [at(14, 6 * HOUR), at(40, 24 * HOUR), at(92, 48 * HOUR), at(52, 5 * DAY, true), at(30, 6.4 * DAY)],
    },
    {
      caption: "all five doomed, staggered · 6 h, 24 h, 48 h, 3 d, 5 d",
      note: "The worst crowding case. Five hollows at once, and only the ramp separates them.",
      accounts: [at(78, 6 * HOUR), at(64, 24 * HOUR), at(71, 48 * HOUR), at(80, 3 * DAY, true), at(88, 5 * DAY)],
    },
    {
      caption: "one loss, far out · 60 points going in 3 d",
      note: "The quiet end of every ramp. If it disappears here, the ramp costs a warning.",
      accounts: [at(60, 3 * DAY, true), at(20, 5 * DAY), at(12, 6 * DAY), at(8, 2 * DAY), at(0, 1 * DAY)],
    },
    {
      caption: "one loss, imminent · 82 points going in 6 h",
      note: "The loud end. One lane has to pull the eye out of five.",
      accounts: [at(82, 6 * HOUR), at(20, 5 * DAY, true), at(12, 6 * DAY), at(8, 2 * DAY), at(0, 1 * DAY)],
    },
    {
      caption: "control · nothing at risk, one pinned account running dry",
      note: "No hollow anywhere. The hatch is the only mark, and it must stay legible beside every treatment.",
      accounts: [at(9, 5 * DAY, true), at(4, 6 * DAY), at(2, 3 * DAY), at(0, 2 * DAY), at(6, 6.5 * DAY)],
    },
  ];

  const MODES = ["flat", "fade", "solid", "weight", "pip"];

  window.QUOTA_ROUND32 = { STATES, MODES, row, nearness };
})();
