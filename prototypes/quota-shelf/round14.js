/* Round 14: the row that has no level to draw.
 *
 * An Antigravity account whose only pool is Gemini reports nothing that can
 * fill a bar. Today that row is a tag, a dot, and a hole where the meters
 * would be. Seven answers, in two families:
 *
 *   fill it      rule, hollow, grain   put something at lane width that is
 *                                      not a level
 *   reflow it    value, clock, fold,   let the row change shape, so the lane
 *                dotrail               column is not an empty promise
 *
 * Every treatment also has to survive the mixed case, where the same account
 * has one pool that answers and one metered lane beside it. */

(() => {
  const { isUnmetered, laneTone, bindingLane } = window.QUOTA_PLAN;
  const { span } = window.QUOTA_ROUND4;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const HUES = { Gemini: 2, Claude: 0, "GPT-OSS": 1, "5 h": 0, "7 d": 1, Fable: 2, Credits: 1 };
  const value = (lane) =>
    typeof lane.remainingAmount === "number" ? `$${lane.remainingAmount.toFixed(2)}` : `${Math.round(lane.remainingPercent)}%`;
  const when = (lane, now) => (lane.resetsAtMs === null ? "" : span(lane.resetsAtMs - now));
  const paceOf = (lane, now) =>
    !lane.windowMs || lane.resetsAtMs === null ? null : Math.max(0, Math.min(1, (lane.resetsAtMs - now) / lane.windowMs));

  /** A metered lane, exactly as it ships: hued, split at the pace point. */
  function meterLane(lane, now) {
    const fill = Math.max(0, Math.min(100, lane.remainingPercent));
    const mark = paceOf(lane, now);
    const pace = mark === null ? null : mark * 100;
    const behind = pace !== null && fill < pace;
    const row = el("span", `w-lane hue${HUES[lane.name] ?? 1} tone-${laneTone(lane, now)}${behind ? " behind" : ""}`);
    row.style.setProperty("--fill", `${fill}%`);
    if (pace === null) {
      row.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return row;
    }
    row.style.setProperty("--pace", `${pace}%`);
    row.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (fill > pace) row.append(el("i", "w-fill right"));
    if (behind) row.append(el("i", "w-hatch"));
    return row;
  }

  const mark = (lane, now) => {
    const dot = el("i", `w-bool${lane.blocked ? " off" : ""}`);
    dot.title = `${lane.name}: ${lane.blocked ? `refusing, back ${span(lane.blockedUntilMs - now)}` : "answering"}`;
    return dot;
  };

  /* Each treatment fills, or reflows, the lane column of a row whose pools are
     all unmetered. `body` is the lane column; `row` lets a treatment move the
     value and time columns too. */
  const TREATMENTS = {
    // A dot and nothing else: the row that prompted this round.
    dot: (body) => { body.classList.add("w-hollow"); },

    // A hairline at lane height. Quieter than a dash, still not a track.
    rule: (body) => { body.append(el("i", "w-rule")); },

    // The track with no fill at all, drawn as an outline rather than a solid,
    // so it reads as "nothing measured" instead of "empty tank".
    hollow: (body) => { body.append(el("i", "w-outline")); },

    // Texture at lane width: a grain that cannot be read as a level because it
    // has no end.
    grain: (body) => { body.append(el("i", "w-grain")); },

    // The mark takes the number's place. The lane column is deliberately
    // empty, and the row's right edge stays on the same rails as every other.
    value: (body, row) => {
      body.classList.add("w-hollow");
      row.classList.add("w-mark-as-value");
    },

    // The only fact the account has, set at the size the meters would have
    // had: the countdown moves left and fills the row.
    clock: (body, row) => { row.classList.add("w-clock"); },

    // Treat it like a drained account: half height. The row is not hollow, it
    // is small on purpose.
    fold: (body, row) => { body.classList.add("w-hollow"); row.classList.add("w-fold"); },

    // The mark sits on a rail of its own, so the eye still has the horizontal
    // line every other row carries.
    dotrail: (body) => { body.append(el("i", "w-dotrail")); },
  };

  function accountRow(account, tag, now, treatment) {
    const metered = account.lanes.filter((lane) => !isUnmetered(lane));
    const booleans = account.lanes.filter(isUnmetered);
    // bindingLane reports null for an account with no metered lane, which is
    // exactly the case this round is about.
    const binding = bindingLane(account) ?? undefined;
    const row = el("div", `w-row${account.routed ? " routed" : ""}`);
    row.append(el("span", "w-tag", tag));

    const body = el("span", "w-lanes");
    for (const lane of booleans) body.append(mark(lane, now));
    if (metered.length > 0) {
      const stack = el("span", "w-stack");
      for (const lane of metered) stack.append(meterLane(lane, now));
      body.append(stack);
    } else {
      TREATMENTS[treatment](body, row);
    }
    row.append(body);

    const soonest = Math.min(...account.lanes
      .map((lane) => (lane.blocked ? lane.blockedUntilMs - now : lane.resetsAtMs === null ? Infinity : lane.resetsAtMs - now))
      .filter(Number.isFinite));
    row.append(el("span", `w-val tone-${binding === undefined ? "ok" : laneTone(binding, now)}`,
      binding === undefined ? "" : value(binding)));
    row.append(el("span", "w-tm", binding === undefined ? span(soonest) : when(binding, now)));
    return row;
  }

  function shelf(accounts, now, treatment) {
    const root = el("div", `w t-${treatment}`);
    for (const [index, account] of accounts.entries()) {
      root.append(accountRow(account, index === 0 || account.provider !== accounts[index - 1].provider
        ? ({ Antigravity: "AN", Claude: "CL" })[account.provider] ?? account.provider.slice(0, 2).toUpperCase()
        : "", now, treatment));
    }
    return root;
  }

  window.QUOTA_ROUND14 = { shelf, TREATMENTS: Object.keys(TREATMENTS) };
})();
