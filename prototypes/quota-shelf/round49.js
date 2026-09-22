/* Round 49: the two colour problems.
 *
 * The shelf carries its most important distinction in hue alone, and it
 * chose the worst possible hue pair for it.
 *
 *   amber  #d29922   credit is going to die unspent. Money lost.
 *   red    #f85149   the lane runs dry early. Work stops.
 *
 * Those are opposite instructions -- spend faster, spend slower -- and red
 * against amber is exactly the axis that red-green colour blindness
 * compresses. Deuteranomaly and protanomaly together are roughly 8% of men.
 * Under simulation the doom ramp's two ends become two browns a few units
 * apart, so a shelf telling you to spend and a shelf telling you to stop
 * look the same.
 *
 * The hatch survives, because it is texture rather than colour. That is the
 * clue to the fix: the two states already differ in geometry, and the
 * drawing has simply never leaned on it.
 *
 *   runs dry   fill < pace   the hatch, drawn between fill and pace
 *   dies       fill > pace   the solid doom bar, drawn between pace and fill
 *
 * They are on opposite sides of the cut and one is striped where the other
 * is solid. That is already a complete signal with the colour removed. What
 * is missing is that the *countdown* -- the one word of text that says
 * which kind of trouble this is -- carries the distinction in colour only.
 *
 * Three candidates, each keeping the hues for those who can see them and
 * adding a second channel for those who cannot:
 *
 *   hue     today. Colour only. The control.
 *   mark    the countdown gains a leading glyph, up for dying credit and
 *           down for a lane draining out.
 *   weight  the dry countdown is drawn at full strength and the loss
 *           countdown at the same weight as ordinary text, so urgency is
 *           carried by contrast, which every form of colour blindness
 *           preserves.
 *
 * And the second problem: every prototype for forty-nine rounds has been
 * dark only, while AGENTS.md requires both schemes validated on device. The
 * shelf is built on a dark rail with hues lifted off it. On white, a 3 px
 * #5f6b76 rail on #ffffff is heavier than the data drawn on it, and the
 * fills have to darken rather than lighten to stay legible.
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
  const CAP = 8;
  const AT_RISK = 8;

  /* Ramps are per-scheme: on white the light end of the ramp has to be
     darker than the paper, not lighter than the rail. */
  const RAMP = {
    dark: { warn: [210, 153, 34], danger: [248, 81, 73] },
    light: { warn: [154, 106, 0], danger: [200, 32, 26] },
  };

  const doomColour = (near, scheme) => {
    const { warn, danger } = RAMP[scheme] ?? RAMP.dark;
    return `rgb(${warn.map((from, i) => Math.round(from + (danger[i] - from) * near)).join(", ")})`;
  };
  const urgency = (fill, pace) => {
    if (pace <= 0) return 1;
    const excess = fill / pace;
    return excess <= 1 ? 0 : unit(Math.log(excess) / Math.log(CAP));
  };

  const readStrict = (window, now) => {
    const lane = readLane(window, now);
    return lane.leftMs !== null && lane.leftMs <= 0 ? { ...lane, pace: null } : lane;
  };

  function meter(lane, scheme) {
    const bar = el("span", `n2-lane w-lane hue${lane.hue} tone-ok`);
    bar.style.setProperty("--fill", `${lane.fill}%`);
    if (lane.pace === null) {
      bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
      return bar;
    }
    bar.style.setProperty("--pace", `${lane.pace}%`);
    bar.append(el("i", "w-ground left"), el("i", "w-ground right"), el("i", "w-fill left"));
    if (lane.fill > lane.pace) bar.append(el("i", "w-fill right"));
    if (lane.fill < lane.pace && lane.fill > 0) bar.append(el("i", "w-hatch"));
    if (lane.fill - lane.pace >= AT_RISK) {
      const doom = el("i", "n2-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(urgency(lane.fill, lane.pace), scheme);
      bar.append(doom);
    }
    return bar;
  }

  const isBoolean = (lane) => lane.id === "antigravity_gemini";
  const isBalance = (lane) => lane.amount !== null;
  const money = (amount) => (amount <= 0 ? "$0" : amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`);

  /** The second channel. `hue` adds none; the others add one that survives. */
  const GLYPH = { loss: "\u2191", dry: "\u2193" };

  function countdown(lane, channel) {
    const when = next(lane);
    const node = el("span", `n2-when tone-${when.tone} ch-${channel}`);
    if (channel === "mark" && GLYPH[when.tone]) {
      node.append(el("i", "n2-glyph", GLYPH[when.tone]));
    }
    node.append(el("span", "n2-num", when.text));
    return node;
  }

  function laneLine(lane, account, { scheme, channel }) {
    const line = el("span", "n2-line");
    line.append(el("span", "n2-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "n2-lane n2-roster");
      strip.append(el("i", `n2-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "n2-pct"), countdown(lane, channel));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "n2-lane n2-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `n2-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "n2-pct"), el("span", "n2-when tone-none", "—"));
      return line;
    }
    line.append(meter(lane, scheme), el("span", "n2-pct", `${Math.round(lane.fill)}`), countdown(lane, channel));
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  function providerRow(provider, now, options) {
    const node = el("div", "n2-row");
    node.append(el("span", "n2-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", `n2-stack${needsGrouping(provider.accounts) ? " grouped" : ""}`);
    for (const account of provider.accounts) {
      const block = el("span", `n2-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `n2-who${account.available ? "" : " is-out"}`, account.email);
      block.append(who);
      const lanes = el("span", "n2-lanes");
      const windows = [...account.windows].sort(
        (a, b) => Number(isBoolean(readStrict(a, now))) - Number(isBoolean(readStrict(b, now))),
      );
      for (const window of windows) lanes.append(laneLine(readStrict(window, now), account, options));
      block.append(lanes);
      stack.append(block);
    }
    node.append(stack);
    return node;
  }

  function shelf(root, payload, now, options = { scheme: "dark", channel: "hue" }) {
    for (const provider of payload.providers) root.append(providerRow(provider, now, options));
  }

  const CHANNELS = [
    { id: "hue", caption: "today · colour only" },
    { id: "mark", caption: "a glyph: up for dying credit, down for draining" },
    { id: "weight", caption: "contrast: dry at full strength, loss at text weight" },
  ];

  /* Brettel/Viénot-style matrices, applied as an SVG colour filter so the
     real rendered pixels are transformed rather than a swatch chart. */
  const VISION = {
    deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
    protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
    tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
  };

  window.QUOTA_ROUND49 = { shelf, providerRow, CHANNELS, VISION };
})();
