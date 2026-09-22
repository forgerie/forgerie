/* Round 44: making the address stop looking like a broken row.
 *
 * In round 43 the address is 10 px, in the same grey as the meter labels,
 * left-aligned in the same slot they occupy, 2 px above the first of them.
 * It shares every attribute with the rows beneath it, so it reads as one of
 * them -- specifically as a lane row whose bar failed to draw. That is the
 * whole of the afterthought feeling, and it is not a matter of polish: a
 * heading that uses none of a heading's tools is not a heading.
 *
 * A heading has exactly three tools. Size and weight, colour, and position.
 * The round 43 address uses none of them, so this round adds them one at a
 * time and looks at each.
 *
 *   quiet   round 43, unchanged. The control.
 *   lift    size and colour. 11 px, brighter than the labels it governs,
 *           medium weight.
 *   indent  position only, at round 43's type. The address sits at the
 *           block's left edge and the lanes step in 12 px beneath it, so
 *           the hierarchy is legible from the shape of the left margin
 *           alone.
 *   step    both. Lift and indent together.
 *   split   step, with the domain dimmed behind the local part. Five of the
 *           six live accounts repeat two domains between them, so the
 *           characters that actually tell them apart are a third of the
 *           string and currently have the same weight as the rest.
 *
 * The spacing is a separate fault and is fixed for every candidate here.
 * Round 43 leaves 2 px under the address and 4 px between lanes, so the
 * address sits closer to its first lane than the lanes sit to each other.
 * That is the right direction -- a heading should bind to what it labels --
 * but at 2 px it reads as crushed rather than bound, and the group is
 * separated from the one above by 8 px, which is only twice the internal
 * gap. The rhythm here is 3 px under the address, 4 px between lanes, and
 * 11 px between accounts: bound, even, separated, in a ratio you can see
 * without measuring.
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
    const bar = el("span", `x-lane w-lane hue${lane.hue} tone-ok`);
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
      const doom = el("i", "x-doom");
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
    const line = el("span", "x-line");
    line.append(el("span", "x-meter", lane.name));
    if (isBoolean(lane)) {
      const strip = el("span", "x-lane x-roster");
      strip.append(el("i", `x-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "x-pct"), el("span", "x-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "x-lane x-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `x-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "x-pct"), el("span", "x-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "x-pct", `${Math.round(lane.fill)}`),
      el("span", `x-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  /**
   * The address itself. `split` dims the domain so the characters that tell
   * the accounts apart carry the weight; every other mode prints it whole.
   */
  function address(account, mode) {
    const who = el("span", `x-who${account.available ? "" : " is-out"}`);
    who.title = account.email;
    const at = account.email.lastIndexOf("@");
    if (mode === "split" && at > 0) {
      who.append(el("b", "x-local", account.email.slice(0, at)));
      who.append(el("span", "x-domain", account.email.slice(at)));
    } else {
      who.textContent = account.email;
    }
    return who;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  function providerRow(provider, now, mode) {
    const node = el("div", "x-row");
    node.append(el("span", "x-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", "x-stack");
    for (const account of provider.accounts) {
      const block = el("span", `x-acct is-${mode}${account.selected ? " pinned" : ""}`);
      block.append(address(account, mode));
      const lanes = el("span", "x-lanes");
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

  function shelf(root, payload, now, mode) {
    for (const provider of payload.providers) root.append(providerRow(provider, now, mode));
  }

  const MODES = [
    { id: "quiet", caption: "round 43 · no heading tools at all" },
    { id: "lift", caption: "size and colour" },
    { id: "indent", caption: "position only" },
    { id: "step", caption: "size, colour and position" },
    { id: "split", caption: "step, with the domain dimmed" },
  ];

  window.QUOTA_ROUND44 = { shelf, providerRow, MODES };
})();
