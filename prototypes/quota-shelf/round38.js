/* Round 38: a mark for a thing that is not a quantity.
 *
 * Round 37 made OpenRouter a roster entry, which was right, and then drew it
 * as a full-width one-pixel line, which was not. A hairline is still a bar.
 * It spans the same track as the meters above it, starts where they start
 * and ends where they end, and so it still reads as "something measured,
 * drawn thin". The row shape belongs on the shelf; the mark does not.
 *
 * What OpenRouter is: money that is there or is not, with no cycle, no
 * window and no maximum. The honest mark for that has no length. It sits at
 * the lane origin, where every other lane begins, and says one of three
 * things: fine, low, out.
 *
 * Three ways to say it, against round 37's line as the control:
 *
 *   rail    a 5 px token at the origin, and a hairline running away from
 *           it. The line is a rail, not a bar, and the token is the state.
 *   orb     the token alone. Nothing else on the lane.
 *   lamp    the token with a soft halo when lit, dark when out. Reads as a
 *           pilot light.
 *   line    round 37's notch. Kept to show what changes.
 *
 * Every one uses the same three states in the same three colours -- grey,
 * amber, red -- and the same 5 px token, so the choice is only about what,
 * if anything, sits beside it. Gemini's roster is drawn the same way in the
 * whole-shelf comp so the two unmeasured lanes agree. */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const LOW = 2;
  const stateOf = (balance) => (balance === null ? "unknown" : balance <= 0 ? "out" : balance <= LOW ? "low" : "ok");

  /* ------------------------------------------------------------ the marks */

  const MODES = ["line", "rail", "orb", "lamp"];

  function mark(state, mode) {
    const host = el("span", `q-lane q-${mode} is-${state}`);
    if (state === "unknown") {
      host.append(el("i", "q-unknown"));
      return host;
    }
    if (mode === "line") {
      host.append(el("i", "q-seg"));
      return host;
    }
    if (mode === "rail") host.append(el("i", "q-wire"));
    host.append(el("i", "q-token"));
    return host;
  }

  function row(balance, mode, tag = "OP") {
    const node = el("div", "k-row");
    node.append(el("span", "k-tag", tag));
    const stack = el("span", "k-stack");
    const block = el("span", "k-acct");
    const line = el("span", "k-line");
    line.append(mark(stateOf(balance), mode));
    block.append(line);
    stack.append(block);
    node.append(stack);
    return node;
  }

  /* --------------------------------------------- Gemini, drawn the same way */

  function roster(states, mode) {
    const host = el("span", `q-lane q-roster q-${mode}`);
    if (mode === "line") {
      if (states.length > 40) host.classList.add("dense");
      for (const on of states) host.append(el("i", `q-seg${on ? "" : " is-out"}`));
      return host;
    }
    if (mode === "rail") host.append(el("i", "q-wire"));
    const tokens = el("span", "q-tokens");
    for (const on of states) tokens.append(el("i", `q-token is-${on ? "ok" : "out"}`));
    host.append(tokens);
    return host;
  }

  /* ------------------------------------------------------- the whole shelf */

  const meter = (hue, percent, pace) => {
    const bar = el("span", `q-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    if (pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (percent > pace) {
      bar.append(el("i", "w-fill right"));
      const doom = el("i", "q-doom");
      doom.style.left = `${pace}%`;
      doom.style.width = `${percent - pace}%`;
      bar.append(doom);
    }
    if (percent < pace && percent > 0) bar.append(el("i", "w-hatch"));
    return bar;
  };

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
    line(anRoster, roster([true, false], mode));
    anStack.append(anRoster);
    an.append(anStack);
    root.append(an);

    root.append(row(opBalance, mode));
  }

  const STATES = [
    { caption: "<b>funded</b> · $20", balance: 20 },
    { caption: "low · $0.90", balance: 0.9 },
    { caption: "<b>empty</b> · $0", balance: 0 },
    { caption: "no reading yet", balance: null },
  ];

  window.QUOTA_ROUND38 = { MODES, STATES, row, roster, shelf, stateOf };
})();
