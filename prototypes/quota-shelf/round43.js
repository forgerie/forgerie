/* Round 43: the address above the lanes it names.
 *
 * Round 42 put the account address in a fixed 132 px column on the left.
 * That column bought perfect alignment and charged two things for it: the
 * address truncated to "sjackson@amazeinsig..." even at 980 px wide, and
 * every lane on the shelf lost 132 px of track to hold a label that only
 * changes once per account.
 *
 * Putting the address above the lanes reverses both. The lanes get the
 * whole width back, the address gets as much room as it needs, and the
 * account's identity sits directly over the account's bars instead of
 * beside them. It also makes the grouping self-evident: a heading is a
 * stronger separator than a five pixel gap, so the gap can go.
 *
 * What it costs is a line of height per account, which is the one thing
 * this shelf has spent forty rounds refusing to spend. Both layouts are
 * built here from the same data so the trade is measured rather than
 * argued: height against track.
 *
 * Everything below the address is unchanged from round 42. The lane
 * geometry, the hues, the origin, the doom bar, the hatch and the
 * countdown rule are all the collapsed shelf's, untouched.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (value) => Math.max(0, Math.min(100, value));
  const unit = (value) => Math.max(0, Math.min(1, value));

  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  /** Exactly one unit, always. "45m", "38h", "3d". Never two. */
  function duration(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms <= 0) return "now";
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
    if (ms < 2 * DAY) return `${Math.round(ms / HOUR)}h`;
    return `${Math.round(ms / DAY)}d`;
  }

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

  const HUE = {
    five_hour: 0,
    antigravity_claude: 0,
    seven_day: 1,
    antigravity_gpt_oss: 1,
    openrouter_credits: 1,
    weekly_fable: 2,
    seven_day_fable: 2,
  };

  const SHORT = { "Five-hour": "5-hour", "Seven-day": "7-day" };

  function readLane(window, now) {
    const resetsAtMs = window.resetsAt ? Date.parse(window.resetsAt) : null;
    const windowMs = window.lengthSeconds ? window.lengthSeconds * 1000 : null;
    const leftMs = resetsAtMs === null ? null : resetsAtMs - now;
    return {
      id: window.id,
      name: SHORT[window.name] ?? window.name,
      hue: HUE[window.id] ?? 1,
      fill: clamp(window.remainingPercent),
      pace: windowMs && leftMs !== null ? clamp((leftMs / windowMs) * 100) : null,
      amount: typeof window.remainingAmount === "number" ? window.remainingAmount : null,
      resetsAtMs,
      leftMs,
      windowMs,
    };
  }

  /** Which fact the countdown names, and what colour that makes it. */
  function next(lane) {
    if (lane.resetsAtMs === null) return { text: "—", tone: "none" };
    if (lane.pace === null) return { text: duration(lane.leftMs), tone: "plain" };
    if (lane.fill <= 0) return { text: duration(lane.leftMs), tone: "dry" };
    if (lane.fill < lane.pace) {
      const spent = 100 - lane.fill;
      const elapsed = lane.windowMs - lane.leftMs;
      const dryInMs = spent > 0 && elapsed > 0 ? elapsed * (lane.fill / spent) : Infinity;
      return { text: duration(dryInMs), tone: "dry" };
    }
    if (lane.fill - lane.pace >= AT_RISK) return { text: duration(lane.leftMs), tone: "loss" };
    return { text: duration(lane.leftMs), tone: "plain" };
  }

  const isBoolean = (lane) => lane.id === "antigravity_gemini";
  const isBalance = (lane) => lane.amount !== null;
  const money = (amount) => (amount <= 0 ? "$0" : amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`);

  function meter(lane) {
    const bar = el("span", `u-lane w-lane hue${lane.hue} tone-ok`);
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
      const doom = el("i", "u-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(urgency(lane.fill, lane.pace));
      bar.append(doom);
    }
    return bar;
  }

  function laneLine(lane, account) {
    const line = el("span", "u-line");
    line.append(el("span", "u-meter", lane.name));

    if (isBoolean(lane)) {
      const strip = el("span", "u-lane u-roster");
      strip.append(el("i", `u-token${account.available && lane.fill > 0 ? "" : " is-out"}`));
      line.append(strip, el("span", "u-pct"), el("span", "u-when tone-plain", next(lane).text));
      return line;
    }
    if (isBalance(lane)) {
      const slot = el("span", "u-lane u-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `u-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "u-pct"), el("span", "u-when tone-none", "—"));
      return line;
    }
    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "u-pct", `${Math.round(lane.fill)}`),
      el("span", `u-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  /**
   * `column` keeps round 42's fixed left column. `above` gives the address
   * its own line over the lanes it names, so the lanes keep the full track
   * and the address keeps its full length.
   */
  function providerRow(provider, now, mode) {
    const node = el("div", "u-row");
    node.append(el("span", "u-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    /* Below the width that reveals the address there is no heading to do the
       separating, so the round 34 rule still holds: hold accounts apart only
       where an account owns more than one lane. */
    const grouped = needsGrouping(provider.accounts);
    const stack = el("span", `u-stack${grouped ? " grouped" : ""}`);

    for (const account of provider.accounts) {
      const block = el("span", `u-acct at-${mode}${account.selected ? " pinned" : ""}`);
      const who = el("span", `u-who${account.available ? "" : " is-out"}`, account.email);
      who.title = account.email;
      block.append(who);

      const lanes = el("span", "u-lanes");
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

  const RUNGS = [
    { width: 360, gains: "the collapsed shelf" },
    { width: 430, gains: "+ when" },
    { width: 510, gains: "+ level" },
    { width: 640, gains: "+ address" },
    { width: 820, gains: "+ meter" },
    { width: 980, gains: "room to breathe" },
  ];

  window.QUOTA_ROUND43 = { shelf, providerRow, duration, next, readLane, RUNGS };
})();
