/* Round 45: the quiet address, given room instead of weight.
 *
 * Round 44 answered "the address feels like an afterthought" by making the
 * address louder: bigger, brighter, stepped in, with the domain dropped
 * behind the local part. That works, and it is the wrong kind of answer for
 * this shelf. Everything else here earns attention by being the only thing
 * that moved, and a heading that shouts joins the competition rather than
 * standing outside it.
 *
 * So the type goes back to round 43 exactly -- 10 px, the same grey as the
 * meter labels, no step, no split -- and the fix is space. An element reads
 * as deliberate when the space around it is deliberate. The address did not
 * need to be louder; it needed to not be crushed between the riser on its
 * left and the first lane below it.
 *
 * Two gaps move, and a third has to move with them:
 *
 *   riser to label   the 2 px pinned riser sits at the account block's left
 *                    edge and every label in the block starts 5 px from it.
 *                    Five pixels is the gap you get when nobody chooses
 *                    one.
 *   below the id     3 px, against 4 px between lanes. The address is
 *                    nearer its first lane than the lanes are to each
 *                    other.
 *   between accounts this is not free to leave alone. Open the space below
 *                    the address without opening the space above it and the
 *                    address drifts to the midpoint between two accounts,
 *                    which is exactly the round 43 fault in a new place. It
 *                    has to stay clearly the larger of the two.
 *
 * Four steps, from the round 43 values to genuinely airy, so the choice is
 * made by looking rather than by arguing about pixels.
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
    const bar = el("span", `j-lane w-lane hue${lane.hue} tone-ok`);
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
      const doom = el("i", "j-doom");
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
    const line = el("span", "j-line");
    line.append(el("span", "j-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "j-lane j-roster");
      strip.append(el("i", `j-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "j-pct"), el("span", "j-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "j-lane j-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `j-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "j-pct"), el("span", "j-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "j-pct", `${Math.round(lane.fill)}`),
      el("span", `j-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  function providerRow(provider, now) {
    const node = el("div", "j-row");
    node.append(el("span", "j-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", "j-stack");
    for (const account of provider.accounts) {
      const block = el("span", `j-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `j-who${account.available ? "" : " is-out"}`, account.email);
      who.title = account.email;
      block.append(who);
      const lanes = el("span", "j-lanes");
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

  /* riser -> label, below the address, between accounts. */
  const STEPS = [
    { id: "snug", pad: 5, below: 3, between: 11, caption: "round 43, unchanged" },
    { id: "easy", pad: 10, below: 5, between: 13 },
    { id: "open", pad: 14, below: 7, between: 17 },
    { id: "airy", pad: 18, below: 9, between: 21 },
  ];

  window.QUOTA_ROUND45 = { shelf, providerRow, STEPS };
})();
