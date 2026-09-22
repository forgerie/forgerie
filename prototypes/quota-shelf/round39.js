/* Round 39: show the balance.
 *
 * Rounds 36 to 38 all made the same mistake in different clothes. Having
 * proved there is no scale to plot a balance on, each one went looking for a
 * quieter mark to plot it with anyway: a shorter bar, a hairline, a dot, a
 * dot with a wire behind it. All of them are the same error. A mark can only
 * say "more" or "less", and there is no "more than what" here.
 *
 * The numbers were banned in round 30, and the reason was specific: the
 * geometry already carried the fact, so a number repeated it. On a metered
 * lane that holds. A fill against a pace cut says everything a percentage
 * would, which is why round 30 could delete the column and gain a third of
 * the track back.
 *
 * It does not hold here. There is no fill, no cut and no window, so nothing
 * is carrying the fact. The value is not a repeat of the drawing; it is the
 * only content the lane has. $0.90 is the information.
 *
 * So the question is not what mark, it is where the value sits and how it
 * behaves, so the row still belongs beside the meters:
 *
 *   origin  at the lane origin, where every bar on the shelf begins.
 *   trail   at the far end of the track, right-aligned.
 *   inline  hard against the tag, before the track starts.
 *   big     at the origin, in the row's largest type.
 *
 * All four use the same three colours the shelf already has, and the same
 * rounding rule: cents below ten dollars, whole dollars above, because
 * "$47.31" is four characters of noise when the fact is "about fifty". */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const LOW = 2;
  const toneOf = (balance) =>
    balance === null ? "unknown" : balance <= 0 ? "out" : balance <= LOW ? "low" : "ok";

  /** Cents below ten, whole dollars above. Never more precision than matters. */
  function money(balance) {
    if (balance === null) return "—";
    if (balance <= 0) return "$0";
    if (balance < 10) return `$${balance.toFixed(2)}`;
    return `$${Math.round(balance)}`;
  }

  const MODES = ["origin", "trail", "inline", "big"];

  function row(balance, mode, tag = "OP") {
    const tone = toneOf(balance);
    const node = el("div", `k-row v-${mode}`);
    node.append(el("span", "k-tag", tag));

    const value = el("span", `v-val tone-${tone}`, money(balance));

    if (mode === "inline") {
      const stack = el("span", "k-stack");
      const block = el("span", "k-acct");
      const line = el("span", "k-line");
      line.append(value);
      block.append(line);
      stack.append(block);
      node.append(stack);
      return node;
    }

    const stack = el("span", "k-stack");
    const block = el("span", "k-acct");
    const line = el("span", `k-line v-line ${mode === "trail" ? "to-end" : "to-start"}`);
    line.append(value);
    block.append(line);
    stack.append(block);
    node.append(stack);
    return node;
  }

  /* ------------------------------------------------------- the whole shelf */

  const meter = (hue, percent, pace) => {
    const bar = el("span", `v-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    if (pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (percent > pace) {
      bar.append(el("i", "w-fill right"));
      const doom = el("i", "v-doom");
      doom.style.left = `${pace}%`;
      doom.style.width = `${percent - pace}%`;
      bar.append(doom);
    }
    if (percent < pace && percent > 0) bar.append(el("i", "w-hatch"));
    return bar;
  };

  /** Gemini stays a roster: it really is a boolean, and a boolean has no value. */
  function roster(states) {
    const host = el("span", "v-lane v-roster");
    for (const on of states) host.append(el("i", `v-token${on ? "" : " is-out"}`));
    return host;
  }

  function shelf(root, { opBalance, mode }) {
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

    root.append(row(opBalance, mode));
  }

  const STATES = [
    { caption: "<b>funded</b> · $47.31", balance: 47.31 },
    { caption: "funded · $20", balance: 20 },
    { caption: "low · $1.80", balance: 1.8 },
    { caption: "<b>nearly out</b> · $0.90", balance: 0.9 },
    { caption: "<b>empty</b> · $0", balance: 0 },
    { caption: "no reading yet", balance: null },
  ];

  window.QUOTA_ROUND39 = { MODES, STATES, row, shelf, money, toneOf };
})();
