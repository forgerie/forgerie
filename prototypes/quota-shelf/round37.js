/* Round 37: OpenRouter is not a meter.
 *
 * Round 36 tried five denominators for a balance that has none, and the best
 * of them still drew a position on a scale. A scale is a claim, and from one
 * reading of a prepaid balance there is no claim to make. Ninety cents is not
 * far along anything. It is a number with no axis.
 *
 * So stop drawing a quantity. From a single reading the only honest facts
 * are that there is money or there is not, which is a boolean -- and round 35
 * already settled what a boolean looks like. OpenRouter is a roster entry,
 * drawn exactly like Antigravity's Gemini: a dash at rest, a red mark when it
 * cannot serve.
 *
 * That gives the shelf a cleaner spine than it had. There are two kinds of
 * lane, not four kinds of special case:
 *
 *   measured    a window grants an allowance, so a proportion exists and the
 *               lane draws it, with a pace cut and the loss marks.
 *   unmeasured  no allowance and no window, so nothing is a proportion. The
 *               lane is a roster: dash when it can serve, red when it cannot.
 *
 * Antigravity's Gemini is unmeasured because it reports a boolean.
 * OpenRouter is unmeasured because a balance has no maximum. Antigravity's
 * Claude and GPT-OSS lanes are unmeasured today for a third reason -- they
 * report a percentage but no window length -- which is worth noticing,
 * because it means two thirds of that row is already pretending.
 *
 * The cost is stated rather than hidden: a boolean cannot warn you early.
 * You find out at zero, not before. The only fix is for the router to keep a
 * short spend history, and then the lane stops being unmeasured at all.
 *
 *   dot      round 36's answer, kept as the control.
 *   notch    the roster treatment from round 35, one segment.
 *   three    a roster with a low state at an invented threshold.
 *   absent   the row is drawn only when it cannot serve.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* The one invented number, and it is a threshold rather than a scale. A
   * threshold only has to be roughly right; a scale has to be right at every
   * point on it. */
  const LOW = 2;

  const funded = (state) => state.balance !== null && state.balance > 0;
  const low = (state) => funded(state) && state.balance <= LOW;

  /* ------------------------------------------------------------ the lanes */

  const MODES = ["dot", "notch", "three", "absent"];

  function lane(state, mode) {
    if (state.balance === null) {
      const host = el("span", "p-lane unknown");
      host.append(el("i", "p-unknown"));
      return host;
    }

    if (mode === "dot") {
      /* Round 36: a mark on a time track. Needs a burn rate to place it. */
      const host = el("span", `p-lane${funded(state) ? "" : " out"}`);
      host.append(el("i", "p-wire"));
      const mark = el("i", "p-dot");
      mark.style.left = state.perDay ? `${Math.min(100, (state.balance / state.perDay / 7) * 100)}%` : "0%";
      host.append(mark);
      return host;
    }

    /* A roster of one. Same element as Gemini's roster, same rule. */
    const host = el("span", "p-lane p-roster");
    const seg = el("i", "p-seg");
    if (!funded(state)) seg.classList.add("out");
    else if (mode === "three" && low(state)) seg.classList.add("low");
    host.append(seg);
    return host;
  }

  /* ------------------------------------------------------------- the row */

  function row(state, mode) {
    if (mode === "absent" && funded(state) && state.balance !== null) {
      const node = el("div", "p-row-gone");
      node.append(el("span", "p-gone"));
      return node;
    }
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

  /* ----------------------------------------------- the whole shelf, unified */

  const meter = (hue, percent, pace) => {
    const bar = el("span", `p-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    if (pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (percent > pace) {
      bar.append(el("i", "w-fill right"));
      const doom = el("i", "p-doom");
      doom.style.left = `${pace}%`;
      doom.style.width = `${percent - pace}%`;
      bar.append(doom);
    }
    if (percent < pace && percent > 0) bar.append(el("i", "w-hatch"));
    return bar;
  };

  function roster(states) {
    const host = el("span", "p-lane p-roster");
    if (states.length > 40) host.classList.add("dense");
    for (const on of states) host.append(el("i", `p-seg${on ? "" : " out"}`));
    return host;
  }

  /** Codex, Claude, Antigravity and OpenRouter under one rule. */
  function shelf(root, { opState }) {
    const line = (parent, node) => {
      const wrap = el("span", "k-line");
      wrap.append(node);
      parent.append(wrap);
    };

    const co = el("div", "k-row");
    co.append(el("span", "k-tag", "CO"));
    const coStack = el("span", "k-stack");
    for (const [percent, pace] of [[78, 3.6], [64, 14.3], [71, 28.6], [52, 71.4], [30, 91.4]]) {
      const block = el("span", "k-acct");
      line(block, meter(1, percent, pace));
      coStack.append(block);
    }
    co.append(coStack);
    root.append(co);

    const cl = el("div", "k-row");
    cl.append(el("span", "k-tag", "CL"));
    const clStack = el("span", "k-stack grouped");
    for (const lanes of [[[0, 85, 20], [1, 60, 28.6], [2, 40, 71.4]], [[0, 20, 80], [1, 90, 7.1], [2, 72, 21.4]]]) {
      const block = el("span", "k-acct");
      for (const [hue, percent, pace] of lanes) line(block, meter(hue, percent, pace));
      clStack.append(block);
    }
    cl.append(clStack);
    root.append(cl);

    const an = el("div", "k-row");
    an.append(el("span", "k-tag", "AN"));
    const anStack = el("span", "k-stack grouped");
    for (const lanes of [[[0, 78], [1, 44]], [[0, 12], [1, 92]]]) {
      const block = el("span", "k-acct");
      for (const [hue, percent] of lanes) line(block, meter(hue, percent, null));
      anStack.append(block);
    }
    const anRoster = el("span", "k-acct apart");
    line(anRoster, roster([true, false]));
    anStack.append(anRoster);
    an.append(anStack);
    root.append(an);

    const op = el("div", "k-row");
    op.append(el("span", "k-tag", "OP"));
    const opStack = el("span", "k-stack");
    const opBlock = el("span", "k-acct");
    line(opBlock, roster([funded(opState)]));
    opStack.append(opBlock);
    op.append(opStack);
    root.append(op);
  }

  /* ------------------------------------------------------------ the states */

  const at = (balance, perDay = 1.2) => ({ balance, perDay });

  const STATES = [
    { caption: "<b>funded</b> · $20.00", note: "The ordinary state. Nothing to report, so nothing should shout.", state: at(20) },
    { caption: "nearly out · $0.90", note: "A boolean cannot see this coming. Only <b>three</b> tries, and only by inventing a threshold.", state: at(0.9) },
    { caption: "<b>empty</b> · $0.00", note: "Nothing routes. This is the state the row exists for.", state: at(0) },
    { caption: "no reading yet", note: "After a restart, before the first fetch. Absence, not zero.", state: { balance: null, perDay: null } },
  ];

  window.QUOTA_ROUND37 = { MODES, STATES, row, shelf, funded, LOW };
})();
