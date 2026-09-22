/* Round 47: the shelf answers to height, not only to width.
 *
 * Round 46 measured the shelf against the acceptance device and found it
 * 12 px taller than the whole folded-landscape screen, 711 x 374, before a
 * single pixel of chrome. Drawn to scale, Codex and OpenRouter fell off the
 * bottom, taking the pinned account's 13h runway with them -- the most
 * urgent fact on the shelf, invisible.
 *
 * The cause is structural rather than numeric. Every rung from round 33 on
 * keys off width alone. plan.js has carried a SHORT_HEIGHT constant since
 * round 1 and nothing has read it since. Trimming 12 px would hide the
 * fault rather than fix it: a panel with chrome gives the shelf perhaps
 * 280 px, not 374, so the real shortfall is closer to a hundred.
 *
 * The lever is the account address. It is the only thing on the shelf that
 * costs a whole line per account and answers no question the shelf exists
 * to answer -- it tells you *which* account, which matters when you go to
 * act, not when you are deciding whether to act. Seven accounts, seven
 * lines, about 130 px. Nothing else is remotely as expensive.
 *
 * Which gives one rule, and it separates cleanly along the two axes:
 *
 *   width  buys columns   when, then level, then the meter name.
 *   height buys names     the account address, and the room around it.
 *
 * At 711 x 374 width says yes to the address and height says no, and
 * height wins. What never goes, at any size, is the lane itself, the pace
 * cut, the hatch and the doom bar. Those are the three questions the shelf
 * was built to answer and they are answered by geometry that costs 3 px a
 * line.
 *
 * Implementation note: `container-type: size` needs a definite block size
 * on the container, which a real panel has and a prototype must be given
 * explicitly. `inline-size` cannot see height at all.
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
    const bar = el("span", `l-lane w-lane hue${lane.hue} tone-ok`);
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
      const doom = el("i", "l-doom");
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
    const line = el("span", "l-line");
    line.append(el("span", "l-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "l-lane l-roster");
      strip.append(el("i", `l-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "l-pct"), el("span", "l-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "l-lane l-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `l-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "l-pct"), el("span", "l-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "l-pct", `${Math.round(lane.fill)}`),
      el("span", `l-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  function providerRow(provider, now) {
    const node = el("div", "l-row");
    node.append(el("span", "l-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", `l-stack${needsGrouping(provider.accounts) ? " grouped" : ""}`);
    for (const account of provider.accounts) {
      const block = el("span", `l-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `l-who${account.available ? "" : " is-out"}`, account.email);
      who.title = account.email;
      block.append(who);
      const lanes = el("span", "l-lanes");
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

  const POSTURES = [
    { id: "folded portrait", width: 475, height: 638 },
    { id: "folded landscape", width: 711, height: 374 },
    { id: "unfolded portrait", width: 704, height: 783 },
    { id: "unfolded landscape", width: 932, height: 553 },
  ];

  window.QUOTA_ROUND47 = { shelf, providerRow, POSTURES };
})();
