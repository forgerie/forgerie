/* Round 36: a lane for a balance that has no maximum.
 *
 * Every other lane on the shelf is a proportion. A window grants an
 * allowance, the allowance runs down, and the lane draws what is left of it.
 * OpenRouter grants nothing. You top it up, you spend it, and the only two
 * facts are a number of dollars and the direction of travel.
 *
 * That breaks the drawing in a specific way: a bar is a ratio, and a ratio
 * needs a denominator. Today's row draws $0.90 as a short bar, which silently
 * invents a maximum the account does not have. The bar is not wrong by a
 * little, it is meaningless -- the same balance would draw at a different
 * length on a different day for no reason the user could name.
 *
 * It also breaks the risk vocabulary, in a way that is good news. Credit
 * bought outright never expires, so an OpenRouter lane can never carry the
 * amber loss mark. There is exactly one thing that can go wrong: it runs out.
 *
 * Five denominators, and the cost of each stated honestly:
 *
 *   flat    today. An invented maximum. Costs nothing, means nothing.
 *   topup   the largest balance seen since it last went up, so the lane
 *           reads "how much of my last top-up is left". Needs the proxy to
 *           remember one number per account.
 *   runway  how long the balance lasts at the rate it is going, against a
 *           fourteen-day horizon. Needs spend history.
 *   week    the same runway against a seven-day horizon, which is the window
 *           every other lane on the shelf already uses. Needs spend history.
 *   dot     no bar at all. One mark on a time track at the point the balance
 *           runs out, so nothing pretends to be a proportion.
 *
 * The thing to notice is that four of the five need the proxy to remember
 * something. An unbounded balance cannot be drawn as a proportion from a
 * single reading. Either the router keeps history, or this row can only ever
 * show an absolute number -- which is the one thing the shelf has banned. */

(() => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const unit = (value) => Math.max(0, Math.min(1, value));

  /* --------------------------------------------------- the five denominators */

  const INVENTED_MAX = 25;
  const HORIZON = { runway: 14 * DAY, week: 7 * DAY };

  /** Days the balance lasts at the observed burn. null when nothing is known. */
  const runwayMs = (state) =>
    state.perDay === null || state.perDay <= 0 ? null : (state.balance / state.perDay) * DAY;

  const SHARE = {
    flat: (state) => unit(state.balance / INVENTED_MAX),
    topup: (state) => (state.lastTopUp === null ? null : unit(state.balance / state.lastTopUp)),
    runway: (state) => {
      const ms = runwayMs(state);
      return ms === null ? null : unit(ms / HORIZON.runway);
    },
    week: (state) => {
      const ms = runwayMs(state);
      return ms === null ? null : unit(ms / HORIZON.week);
    },
    dot: (state) => {
      const ms = runwayMs(state);
      return ms === null ? null : unit(ms / HORIZON.week);
    },
  };

  /* Only one thing can go wrong here, so only one colour is available.
   *
   * The threshold is a duration, not a share. As a share it moved with the
   * horizon: two and a half days of runway read as danger on a fourteen-day
   * axis and as comfortable on a seven-day one, which made the warning a
   * property of the drawing rather than of the account. */
  const DYING_MS = DAY;
  const isDying = (state) => {
    const ms = runwayMs(state);
    return ms === null ? false : ms <= DYING_MS;
  };

  function lane(state, mode) {
    const share = SHARE[mode](state);
    const host = el("span", `n-lane hue1${isDying(state) ? " dying" : ""}`);

    if (share === null) {
      /* Nothing known yet. Draw the absence rather than guess a length. */
      host.classList.add("unknown");
      host.append(el("i", "n-ground"), el("i", "n-unknown"));
      return host;
    }

    host.append(el("i", "n-ground"));
    if (mode === "dot") {
      const mark = el("i", "n-dot");
      mark.style.left = `${share * 100}%`;
      host.append(el("i", "n-wire"), mark);
      return host;
    }
    const fill = el("i", "n-fill");
    fill.style.width = `${share * 100}%`;
    host.append(fill);
    return host;
  }

  /* ------------------------------------------------------------- the row */

  function row(state, mode) {
    const node = el("div", "k-row");
    node.append(el("span", "k-tag", "OP"));
    const stack = el("span", "k-stack");
    const block = el("span", "k-acct");
    const line = el("span", "k-line");
    line.append(lane(state, mode));
    block.append(line);
    stack.append(block);
    node.append(stack);
    return node;
  }

  /* ------------------------------------------------------------ the states */

  const at = (balance, lastTopUp, perDay) => ({ balance, lastTopUp, perDay });

  const STATES = [
    { caption: "<b>fresh top-up</b> · $20 in, nothing spent yet",
      note: "No burn to measure, so every runway answer has nothing to say.",
      state: at(20, 20, 0) },
    { caption: "half of a $20 top-up · $9.40 left, $1.20 a day",
      note: "Eight days of runway. The comfortable middle.",
      state: at(9.4, 20, 1.2) },
    { caption: "<b>your live balance</b> · $0.90 left, $1.20 a day",
      note: "Under a day. This is the state the row exists to warn about.",
      state: at(0.9, 20, 1.2) },
    { caption: "empty · $0.00",
      note: "Nothing routes. Every treatment has to make that unmistakable.",
      state: at(0, 20, 1.2) },
    { caption: "<b>a big top-up</b> · $100 in, $1.20 a day",
      note: "Eighty-three days. Does more runway than you can use still say something?",
      state: at(100, 100, 1.2) },
    { caption: "a big top-up, heavy use · $100 left, $40 a day",
      note: "Two and a half days on a large balance. Size and runway disagree.",
      state: at(100, 100, 40) },
    { caption: "<b>nothing known yet</b> · $6.10, no history",
      note: "First read after a restart. Four of the five cannot draw anything honest.",
      state: at(6.1, null, null) },
  ];

  const MODES = ["flat", "topup", "runway", "week", "dot"];

  window.QUOTA_ROUND36 = { MODES, STATES, row, lane, runwayMs, SHARE };
})();
