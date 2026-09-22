/* Round 46: one shelf, assembled, and held against the real device.
 *
 * Thirty-one rounds of decisions have been living in thirty-one files. This
 * is all of them in one component, with nothing new invented:
 *
 *   r33  doom measured by rate, fill / pace, not by deadline
 *   r34  solid doom, amber to red, and grouping only where it means something
 *   r35  a boolean is a token, because it has no value to show
 *   r39  a balance is a number, because it has no scale to plot it on
 *   r41  both of those at the lane origin, so no row needs a trailing gutter
 *   r42  width buys columns and never moves a lane
 *   r43  the address above the lanes it names
 *   r45  the quiet address, fixed with space rather than weight, at `easy`
 *
 * And then the thing forty-five rounds never did: measure it at the widths
 * the acceptance device actually gives a panel. The Fold's folded landscape
 * posture is 711 x 374 CSS px. A shelf that is 394 px tall does not fit on
 * that screen at all, before any chrome around it. That is not a detail to
 * discover after shipping.
 */

(() => {
  const { readLane, next } = window.QUOTA_ROUND43;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const unit = (value) => Math.max(0, Math.min(1, value));
  const WARN = [210, 153, 34];
  const DANGER = [248, 81, 73];
  const CAP = 8;
  const AT_RISK = 8;

  const doomColour = (near) =>
    `rgb(${WARN.map((from, i) => Math.round(from + (DANGER[i] - from) * near)).join(", ")})`;
  const urgency = (fill, pace) => {
    if (pace <= 0) return 1;
    const excess = fill / pace;
    return excess <= 1 ? 0 : unit(Math.log(excess) / Math.log(CAP));
  };

  function meter(lane) {
    const bar = el("span", `o-lane w-lane hue${lane.hue} tone-ok`);
    bar.style.setProperty("--fill", `${lane.fill}%`);
    if (lane.pace === null) {
      /* No stated window length means no pace, so no cut, no hatch and no
         doom. Antigravity reports a level and a reset but never a length. */
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${lane.pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (lane.fill > lane.pace) bar.append(el("i", "w-fill right"));
    if (lane.fill < lane.pace && lane.fill > 0) bar.append(el("i", "w-hatch"));
    if (lane.fill - lane.pace >= AT_RISK) {
      const doom = el("i", "o-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(urgency(lane.fill, lane.pace));
      bar.append(doom);
    }
    return bar;
  }

  const isBoolean = (lane) => lane.id === "antigravity_gemini";
  const isBalance = (lane) => lane.amount !== null;
  const money = (amount) => (amount <= 0 ? "$0" : amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`);

  function laneLine(lane, account) {
    const line = el("span", "o-line");
    line.append(el("span", "o-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "o-lane o-roster");
      strip.append(el("i", `o-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "o-pct"), el("span", "o-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "o-lane o-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `o-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "o-pct"), el("span", "o-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "o-pct", `${Math.round(lane.fill)}`),
      el("span", `o-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  /* Below the width that shows an address there is no heading to separate
     accounts, so round 34's rule still applies: hold them apart only where
     an account owns more than one lane. */
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  function providerRow(provider, now) {
    const node = el("div", "o-row");
    node.append(el("span", "o-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", `o-stack${needsGrouping(provider.accounts) ? " grouped" : ""}`);
    for (const account of provider.accounts) {
      const block = el("span", `o-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `o-who${account.available ? "" : " is-out"}`, account.email);
      who.title = account.email;
      block.append(who);
      const lanes = el("span", "o-lanes");
      const windows = [...account.windows].sort(
        (a, b) => Number(isBoolean(readLane(a, now))) - Number(isBoolean(readLane(b, now))),
      );
      for (const window of windows) lanes.append(laneLine(readLane(window, now), account));
      block.append(lanes);
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  function shelf(root, payload, now) {
    for (const provider of payload.providers) root.append(providerRow(provider, now));
  }

  /* CSS-pixel viewports measured on the physical Z Fold, from AGENTS.md. A
     panel is never the whole viewport, so these are the ceiling, not the
     actual width the shelf gets. */
  const POSTURES = [
    { id: "folded portrait", width: 475, height: 638 },
    { id: "folded landscape", width: 711, height: 374 },
    { id: "unfolded portrait", width: 704, height: 783 },
    { id: "unfolded landscape", width: 932, height: 553 },
  ];

  /* Every posture width must appear here, or the posture table cannot be
     filled from measured values. */
  const RUNGS = [360, 430, 475, 510, 640, 704, 711, 820, 932];

  window.QUOTA_ROUND46 = { shelf, providerRow, POSTURES, RUNGS };
})();
