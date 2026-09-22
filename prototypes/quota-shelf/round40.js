/* Round 40: put the boolean back with its account.
 *
 * Round 34 pulled every Gemini boolean out of its account and collected them
 * into one strip at the foot of the Antigravity row. That fixed the
 * alignment problem it was built for and created a worse one: the row now
 * shows two account blocks, and then two tokens belonging to nobody. The
 * first token is account one's and the second is account two's, and nothing
 * in the drawing says so. You have to know the order.
 *
 * A boolean belongs to an account, so it should be drawn inside that
 * account's block. Which gives one rule that covers both shapes the shelf
 * has to hold:
 *
 *   an account with meters   the token sits in that account's block, beside
 *                            its lanes.
 *   an account with only a   the account is nothing but a token, so many
 *   boolean                  such accounts share one line as a roster.
 *
 * The second case is what the hundred-account test was really about. A
 * hundred boolean-only accounts are a hundred tokens on one line. A hundred
 * metered accounts are a hundred blocks, and no boolean treatment can help
 * with that.
 *
 * Four placements, with round 34's detached strip kept as the control:
 *
 *   apart   round 34. All tokens in a strip below the accounts.
 *   below   the token on its own line at the foot of its account's block.
 *   gutter  the token in the block's left gutter, centred on the account.
 *   tail    the token at the right edge of the block, centred on the
 *           account, in the same gutter the OpenRouter value now uses.
 *
 * `tail` is the one with an argument behind it rather than just a position.
 * OpenRouter's balance went to the trailing edge last round, and a boolean
 * is the same kind of fact: something true about the account that is not a
 * quantity and cannot be plotted. Putting both at the right edge gives the
 * shelf a second column with a meaning -- lanes grow from the left, and
 * whatever cannot be drawn as a lane sits at the right.
 *
 * The cost of a right gutter is that it must be reserved on every row, not
 * just the rows that use it, or the lanes stop ending at the same x. That is
 * 11 px of track on rows that have nothing to put there. `below` costs a
 * line of height per account instead and no width at all. */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const money = (balance) => {
    if (balance === null) return "—";
    if (balance <= 0) return "$0";
    if (balance < 10) return `$${balance.toFixed(2)}`;
    return `$${Math.round(balance)}`;
  };
  const toneOf = (balance) =>
    balance === null ? "unknown" : balance <= 0 ? "out" : balance <= 2 ? "low" : "ok";

  const MODES = ["apart", "below", "gutter", "tail"];

  /* ------------------------------------------------------------- the parts */

  const meter = (hue, percent, pace) => {
    const bar = el("span", `y-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    if (pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (percent > pace) {
      bar.append(el("i", "w-fill right"));
      const doom = el("i", "y-doom");
      doom.style.left = `${pace}%`;
      doom.style.width = `${percent - pace}%`;
      bar.append(doom);
    }
    if (percent < pace && percent > 0) bar.append(el("i", "w-hatch"));
    return bar;
  };

  const token = (on) => el("i", `y-token${on ? "" : " is-out"}`);

  const laneLine = (node) => {
    const wrap = el("span", "y-line");
    wrap.append(node);
    return wrap;
  };

  /**
   * One account: its metered lanes, and its boolean placed by `mode`.
   *
   * `gutter` and `tail` hang the token off the block rather than adding a
   * line, so the account keeps its height and gains a marker on one side.
   */
  function account(acct, mode) {
    const block = el("span", `y-acct${acct.pinned ? " pinned" : ""}`);
    if (acct.boolean !== undefined && (mode === "gutter" || mode === "tail")) {
      block.classList.add(`has-${mode}`);
      const slot = el("span", `y-slot at-${mode}`);
      slot.append(token(acct.boolean));
      block.append(slot);
    }
    const lanes = el("span", "y-lanes");
    for (const [hue, percent, pace] of acct.lanes) lanes.append(laneLine(meter(hue, percent, pace)));
    if (acct.boolean !== undefined && mode === "below") {
      const strip = el("span", "y-lane y-roster");
      strip.append(token(acct.boolean));
      lanes.append(laneLine(strip));
    }
    block.append(lanes);
    return block;
  }

  function group(spec, mode) {
    const node = el("div", "y-row");
    node.append(el("span", "y-tag", spec.tag));
    const stack = el("span", `y-stack${spec.grouped ? " grouped" : ""}`);
    for (const acct of spec.accounts) stack.append(account(acct, mode));

    /* The control: every token pulled out into one strip of its own. */
    if (mode === "apart" && spec.accounts.some((acct) => acct.boolean !== undefined)) {
      const block = el("span", "y-acct apart");
      const lanes = el("span", "y-lanes");
      const strip = el("span", "y-lane y-roster");
      for (const acct of spec.accounts) {
        if (acct.boolean !== undefined) strip.append(token(acct.boolean));
      }
      lanes.append(laneLine(strip));
      block.append(lanes);
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  /** OpenRouter: the value at the trailing edge, as chosen in round 39. */
  function openRouter(balance) {
    const node = el("div", "y-row");
    node.append(el("span", "y-tag", "OP"));
    const stack = el("span", "y-stack");
    const block = el("span", "y-acct");
    const lanes = el("span", "y-lanes");
    const line = el("span", "y-line to-end");
    line.append(el("span", `y-val tone-${toneOf(balance)}`, money(balance)));
    lanes.append(line);
    block.append(lanes);
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
    grouped: true,
    accounts: [
      { lanes: [[0, 85, 20], [1, 60, 28.6], [2, 40, 71.4]], pinned: true },
      { lanes: [[0, 20, 80], [1, 90, 7.1], [2, 72, 21.4]] },
    ],
  };

  const ANTIGRAVITY = {
    tag: "AN",
    grouped: true,
    accounts: [
      { lanes: [[0, 78, null], [1, 44, null]], boolean: true, pinned: true },
      { lanes: [[0, 12, null], [1, 92, null]], boolean: false },
    ],
  };

  /** Many accounts that are only a boolean: one token each, one line. */
  const roster = (count, blocked) => {
    const node = el("div", "y-row");
    node.append(el("span", "y-tag", "XX"));
    const stack = el("span", "y-stack");
    const block = el("span", "y-acct");
    const lanes = el("span", "y-lanes");
    const strip = el("span", "y-lane y-roster");
    if (count > 40) strip.classList.add("dense");
    for (let index = 0; index < count; index += 1) strip.append(token(!blocked.includes(index)));
    lanes.append(laneLine(strip));
    block.append(lanes);
    stack.append(block);
    node.append(stack);
    return node;
  };

  function shelf(root, mode, { opBalance = 47.31 } = {}) {
    root.append(group(CODEX, mode));
    root.append(group(CLAUDE, mode));
    root.append(group(ANTIGRAVITY, mode));
    root.append(openRouter(opBalance));
  }

  window.QUOTA_ROUND40 = { MODES, group, shelf, roster, ANTIGRAVITY, CODEX, CLAUDE };
})();
