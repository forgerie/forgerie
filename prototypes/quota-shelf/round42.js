/* Round 42: expanded, without re-plotting.
 *
 * The obvious way to build an expanded shelf is to draw a second, bigger
 * thing: cards, headers, a lane per row with its name above it. That way
 * costs the one property the collapsed shelf spent twenty-five rounds
 * earning -- you would have to learn the drawing twice, and the marks you
 * trained yourself to read at 360 px would sit somewhere else at 900.
 *
 * So expansion here adds columns and never moves a lane. Same geometry,
 * same hues, same origin, same doom bar, same hatch. Width buys words; it
 * does not buy a new picture.
 *
 * This started out claiming expansion was free of height. It is not, and
 * the render said so: a 10 px number needs a 12 px line box while the
 * collapsed lane pitch is 7 px, so the shelf goes 144 px -> 253 px the
 * moment a word appears. What is true is that it grows once. Every column
 * after the first is free, because all four share that single line box.
 * The first build did not share it and grew twice, 228 px then 260 px, as
 * the taller account column arrived.
 *
 * What the collapsed shelf cannot say, in the order it becomes worth
 * saying:
 *
 *   when     the countdown. The first thing you want that a fraction axis
 *            cannot hold, because hours are not a share of anything.
 *   pct      the exact level, for when "about half" is not enough.
 *   who      the account address. Nothing in the collapsed drawing
 *            identifies an account, and you need the address to go and
 *            switch it.
 *   meter    which window. Last, because hue already separates the three
 *            meters inside an account, and nothing at all separates the
 *            accounts.
 *
 * The countdown carries the tone, by the same rule the collapsed lane
 * draws:
 *
 *   fill < pace   less credit left than clock left, so the lane runs dry
 *                 early. The lane hatches; the countdown is the runway and
 *                 it is red, because work stops.
 *   fill > pace   more credit left than clock left, so credit dies unspent.
 *                 The lane shows the solid doom bar; the countdown is the
 *                 reset and it is amber, because money is lost.
 *   otherwise     the plain reset, in grey.
 *
 * Read against the live payload, so the addresses and the resets are the
 * real ones. */

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

  /* ---------------------------------------------------------- the doom hue */

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

  /* ------------------------------------------------------ payload -> lanes */

  const HUE = {
    five_hour: 0,
    antigravity_claude: 0,
    seven_day: 1,
    antigravity_gpt_oss: 1,
    openrouter_credits: 1,
    weekly_fable: 2,
    seven_day_fable: 2,
  };

  const SHORT = {
    "Five-hour": "5-hour",
    "Seven-day": "7-day",
    Fable: "Fable",
    Gemini: "Gemini",
    Claude: "Claude",
    "GPT-OSS": "GPT-OSS",
    Credits: "Credits",
  };

  /** A lane is a level and, when the provider states a window, a clock. */
  function readLane(window, now) {
    const resetsAtMs = window.resetsAt ? Date.parse(window.resetsAt) : null;
    const windowMs = window.lengthSeconds ? window.lengthSeconds * 1000 : null;
    const leftMs = resetsAtMs === null ? null : resetsAtMs - now;
    return {
      id: window.id,
      name: SHORT[window.name] ?? window.name,
      hue: HUE[window.id] ?? 1,
      fill: clamp(window.remainingPercent),
      /* No stated window length means no pace: a reset instant says when the
         tank refills, never how fast it is draining. */
      pace: windowMs && leftMs !== null ? clamp((leftMs / windowMs) * 100) : null,
      amount: typeof window.remainingAmount === "number" ? window.remainingAmount : null,
      resetsAtMs,
      leftMs,
      windowMs,
    };
  }

  /** Which fact the countdown should name, and what colour that makes it. */
  function next(lane) {
    if (lane.resetsAtMs === null) return { text: "—", tone: "none" };
    if (lane.pace === null) return { text: duration(lane.leftMs), tone: "plain" };
    if (lane.fill <= 0) return { text: duration(lane.leftMs), tone: "dry" };
    if (lane.fill < lane.pace) {
      /* Credit runs out before the clock does. Say when it runs out. */
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

  const money = (amount) => {
    if (amount <= 0) return "$0";
    return amount < 10 ? `$${amount.toFixed(2)}` : `$${Math.round(amount)}`;
  };

  /* ---------------------------------------------------------- the elements */

  function meter(lane) {
    const bar = el("span", `v-lane w-lane hue${lane.hue} tone-ok`);
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
      const doom = el("i", "v-doom");
      doom.style.left = `${lane.pace}%`;
      doom.style.width = `${lane.fill - lane.pace}%`;
      doom.style.background = doomColour(urgency(lane.fill, lane.pace));
      bar.append(doom);
    }
    return bar;
  }

  /** One printed line: [meter] [the lane itself] [pct] [when]. */
  function laneLine(lane, account) {
    const line = el("span", "v-line");
    line.append(el("span", "v-meter", lane.name));

    if (isBoolean(lane)) {
      const strip = el("span", "v-lane v-roster");
      const on = account.available && lane.fill > 0;
      strip.append(el("i", `v-token${on ? "" : " is-out"}`));
      line.append(strip, el("span", "v-pct"), el("span", "v-when tone-plain", next(lane).text));
      return line;
    }

    if (isBalance(lane)) {
      const slot = el("span", "v-lane v-value");
      const tone = lane.amount <= 0 ? "out" : lane.amount <= 2 ? "low" : "ok";
      slot.append(el("span", `v-val tone-${tone}`, money(lane.amount)));
      line.append(slot, el("span", "v-pct"), el("span", "v-when tone-none", "—"));
      return line;
    }

    const when = next(lane);
    line.append(
      meter(lane),
      el("span", "v-pct", `${Math.round(lane.fill)}`),
      el("span", `v-when tone-${when.tone}`, when.text),
    );
    return line;
  }

  /* -------------------------------------------------------------- the rows */

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  /** Grouping only earns its height where an account owns more than one lane. */
  const needsGrouping = (accounts) => accounts.some((acct) => acct.windows.length > 1);

  const shortAddress = (email) => (email.includes("@") ? email : `${email.slice(0, 11)}…`);

  function providerRow(provider, now) {
    const node = el("div", "v-row");
    node.append(el("span", "v-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase()));
    const stack = el("span", `v-stack${needsGrouping(provider.accounts) ? " grouped" : ""}`);

    for (const account of provider.accounts) {
      const block = el("span", `v-acct${account.selected ? " pinned" : ""}`);
      const who = el("span", `v-who${account.available ? "" : " is-out"}`, shortAddress(account.email));
      who.title = account.email;
      block.append(who);

      const lanes = el("span", "v-lanes");
      /* The boolean last, so it sits under the lanes it belongs to. */
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

  const RUNGS = [
    { width: 360, gains: "the collapsed shelf" },
    { width: 430, gains: "+ when" },
    { width: 510, gains: "+ level" },
    { width: 640, gains: "+ account" },
    { width: 820, gains: "+ meter" },
    { width: 980, gains: "room to breathe" },
  ];

  window.QUOTA_ROUND42 = { shelf, providerRow, duration, next, readLane, RUNGS };
})();
