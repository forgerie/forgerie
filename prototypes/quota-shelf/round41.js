/* Round 41: the shelf with every decision in it.
 *
 * Two changes from round 40, and between them they delete a compromise.
 *
 * The boolean goes on its own line at the foot of its account's block, so
 * each token sits under the lanes it belongs to and nothing has to be read
 * in order. The balance goes to the lane origin, where every bar begins.
 *
 * Round 40 put both at the trailing edge, which meant reserving eleven
 * pixels of gutter on every row -- including the rows with nothing to put
 * there -- or the lanes would stop ending at the same x. With both marks
 * back on the left that gutter is gone and the full track returns to every
 * lane on the shelf.
 *
 * Everything else is as settled in rounds 32 to 39:
 *
 *   the doom bar   solid at every distance, hue from amber to red by
 *                  fill / pace, which is how many times the window's own
 *                  natural rate you would have to sustain to waste nothing.
 *   grouping       accounts are held apart only in a row where an account
 *                  owns more than one lane. Codex has one meter per account,
 *                  so there is nothing to group.
 *   the balance    a number, because a balance has no scale to plot it on.
 *                  Cents below ten dollars, whole dollars above.
 *   booleans       a token, because a boolean has no value to show.
 *   colour         grey is fine, amber is money about to be wasted, red is
 *                  work about to stop. Nothing else is saturated.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const unit = (value) => Math.max(0, Math.min(1, value));

  /* ---------------------------------------------------------- the doom hue */

  const WARN = [210, 153, 34];
  const DANGER = [248, 81, 73];
  const CAP = 8;

  /** Times the window's natural rate needed to waste nothing, as 0..1. */
  const urgency = (percent, pace) => {
    if (pace <= 0) return 1;
    const excess = percent / pace;
    return excess <= 1 ? 0 : unit(Math.log(excess) / Math.log(CAP));
  };

  const doomColour = (near) =>
    `rgb(${WARN.map((from, i) => Math.round(from + (DANGER[i] - from) * near)).join(", ")})`;

  /* --------------------------------------------------------------- a meter */

  const AT_RISK = 8;

  function meter(hue, percent, pace) {
    const bar = el("span", `z-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    if (pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (percent > pace) bar.append(el("i", "w-fill right"));
    if (percent < pace && percent > 0) bar.append(el("i", "w-hatch"));
    if (percent - pace >= AT_RISK) {
      const doom = el("i", "z-doom");
      doom.style.left = `${pace}%`;
      doom.style.width = `${percent - pace}%`;
      doom.style.background = doomColour(urgency(percent, pace));
      bar.append(doom);
    }
    return bar;
  }

  const token = (on) => el("i", `z-token${on ? "" : " is-out"}`);

  const line = (node, cls) => {
    const wrap = el("span", `z-line${cls ? ` ${cls}` : ""}`);
    wrap.append(node);
    return wrap;
  };

  /* --------------------------------------------------------- the row shapes */

  /** Grouping only earns its height when an account owns more than one lane. */
  const needsGrouping = (accounts) =>
    accounts.some((acct) => acct.lanes.length + (acct.boolean === undefined ? 0 : 1) > 1);

  function group(spec) {
    const node = el("div", "z-row");
    node.append(el("span", "z-tag", spec.tag));
    const stack = el("span", `z-stack${needsGrouping(spec.accounts) ? " grouped" : ""}`);

    for (const acct of spec.accounts) {
      const block = el("span", `z-acct${acct.pinned ? " pinned" : ""}`);
      for (const [hue, percent, pace] of acct.lanes) block.append(line(meter(hue, percent, pace)));
      /* The boolean sits under the lanes it belongs to. */
      if (acct.boolean !== undefined) {
        const strip = el("span", "z-lane z-roster");
        strip.append(token(acct.boolean));
        block.append(line(strip));
      }
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  const money = (balance) => {
    if (balance === null) return "—";
    if (balance <= 0) return "$0";
    if (balance < 10) return `$${balance.toFixed(2)}`;
    return `$${Math.round(balance)}`;
  };
  const toneOf = (balance) =>
    balance === null ? "unknown" : balance <= 0 ? "out" : balance <= 2 ? "low" : "ok";

  /** A balance has no scale, so it is a number, and it starts where lanes do. */
  function credits(tag, balance) {
    const node = el("div", "z-row");
    node.append(el("span", "z-tag", tag));
    const stack = el("span", "z-stack");
    const block = el("span", "z-acct");
    block.append(line(el("span", `z-val tone-${toneOf(balance)}`, money(balance))));
    stack.append(block);
    node.append(stack);
    return node;
  }

  /** Many accounts that are only a boolean: one token each, one line. */
  function roster(tag, states) {
    const node = el("div", "z-row");
    node.append(el("span", "z-tag", tag));
    const stack = el("span", "z-stack");
    const block = el("span", "z-acct");
    const strip = el("span", "z-lane z-roster");
    if (states.length > 40) strip.classList.add("dense");
    for (const on of states) strip.append(token(on));
    block.append(line(strip));
    stack.append(block);
    node.append(stack);
    return node;
  }

  /* -------------------------------------------------------------- the data */

  const CODEX = {
    tag: "CO",
    accounts: [
      { lanes: [[1, 78, 3.6]] },
      { lanes: [[1, 64, 14.3]] },
      { lanes: [[1, 71, 28.6]] },
      { lanes: [[1, 52, 71.4]], pinned: true },
      { lanes: [[1, 30, 91.4]] },
    ],
  };

  const CLAUDE = {
    tag: "CL",
    accounts: [
      { lanes: [[0, 85, 20], [1, 60, 28.6], [2, 40, 71.4]], pinned: true },
      { lanes: [[0, 20, 80], [1, 90, 7.1], [2, 72, 21.4]] },
    ],
  };

  const ANTIGRAVITY = {
    tag: "AN",
    accounts: [
      { lanes: [[0, 78, null], [1, 44, null]], boolean: true, pinned: true },
      { lanes: [[0, 12, null], [1, 92, null]], boolean: false },
    ],
  };

  function shelf(root, { balance = 47.31 } = {}) {
    root.append(group(CODEX));
    root.append(group(CLAUDE));
    root.append(group(ANTIGRAVITY));
    root.append(credits("OP", balance));
  }

  const BALANCES = [
    { caption: "funded · $47.31", balance: 47.31 },
    { caption: "low · $1.80", balance: 1.8 },
    { caption: "empty · $0", balance: 0 },
    { caption: "no reading yet", balance: null },
  ];

  window.QUOTA_ROUND41 = { shelf, group, credits, roster, BALANCES, CODEX, CLAUDE, ANTIGRAVITY };
})();
