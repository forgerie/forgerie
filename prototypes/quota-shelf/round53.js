/* Round 53: every account on one axis, and the loss added up.
 *
 * Round 28 said a pooled bar cannot work because its length is a mean, and
 * a mean of two opposite errors is no error at all. That was true of what
 * it tested and wrong as a general law, and this round is where the law
 * gets narrower. What cannot be averaged is *position*. Two things can be
 * put on one line without averaging anything:
 *
 *   a barcode plot   every observation drawn as a thin stripe on one shared
 *                    axis, opacity reduced so overlaps stack. Nothing is
 *                    summarised; every mark is where it is.
 *
 *   a sum            credit that will be lost is a quantity, and quantities
 *                    add. The starving account in round 19's cancellation
 *                    case contributes zero to the group's loss; the wasting
 *                    one contributes all of its surplus. Nothing cancels
 *                    because nothing is divided.
 *
 * So a provider gets one line, and the line carries two facts:
 *
 *   the axis    where every meter of every account stands, as a stripe.
 *               The axis is the doom rate from round 33 -- fill over pace,
 *               how many times the window's natural rate you would have to
 *               sustain to waste nothing. It is unit-free, so a five-hour
 *               lane and a seven-day lane land on the same scale. It is
 *               drawn diverging: on pace in the centre, credit dying to the
 *               right, running dry to the left, on a symmetric log scale so
 *               2x and 1/2x sit the same distance out.
 *
 *   the loss    what share of the group's pooled allowance will go unspent
 *               if nothing changes. Summed across every metered lane the
 *               provider has. This is the number the question was about.
 *
 * What the line gives up is the level. A stripe says how far off pace a
 * meter is, not how full it is. That is deliberate: the question was "to
 * what degree am I at risk", and the level does not answer it.
 */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* The axis runs from 1/CAP to CAP times natural. Past that, "worse" is
     not a different instruction, so the stripe stops at the edge. */
  const CAP = 8;
  /* The margin either side of pace inside which a lane is simply on pace.
     The doom side has always had it. The dry side did not, so a meter three
     points behind an even spend drew red -- and the shipped shelf hatches on
     any fill < pace at all. Same margin both ways. */
  const MARGIN = 8;

  /** How many times natural rate, as a signed log position in [-1, 1]. */
  function position(lane) {
    if (lane.pace === null) return 0;
    if (lane.fill <= 0) return -1;
    if (lane.pace <= 0) return 1;
    const rate = lane.fill / lane.pace;
    return clamp(Math.log(rate) / Math.log(CAP), -1, 1);
  }

  const HUE = { five_hour: 0, antigravity_claude: 0, openrouter_key_limit: 0, seven_day: 1, antigravity_gpt_oss: 1, openrouter_credits: 1 };
  const laneHue = (id) => (id.startsWith("weekly_") ? 2 : (HUE[id] ?? 1));
  const isBoolean = (id) => id === "antigravity_gemini";

  function readLane(w, account, now) {
    const resetsAtMs = w.resetsAt ? Date.parse(w.resetsAt) : null;
    const windowMs = w.lengthSeconds ? w.lengthSeconds * 1000 : null;
    const leftMs = resetsAtMs === null ? null : resetsAtMs - now;
    const fill = clamp(w.remainingPercent, 0, 100);
    const pace = windowMs && leftMs !== null && leftMs > 0 ? clamp((leftMs / windowMs) * 100, 0, 100) : null;
    const lane = {
      id: w.id, name: w.name, hue: laneHue(w.id), account, fill, pace,
      boolean: isBoolean(w.id),
      balance: typeof w.remainingAmount === "number",
    };
    lane.refusing = lane.boolean && (!account.available || fill <= 0);
    lane.metered = !lane.boolean && !lane.balance;
    /* What this lane will lose, in points of its own allowance. */
    lane.surplus = lane.metered && pace !== null && fill - pace >= MARGIN ? fill - pace : 0;
    lane.state = !lane.metered ? "flat"
      : pace === null ? "flat"
      : fill <= 0 ? "dry"
      : pace - fill >= MARGIN ? "dry"
      : lane.surplus > 0 ? "loss"
      : "ok";
    return lane;
  }

  /* --------------------------------------------------------- the group */

  function group(provider, now) {
    const lanes = provider.accounts.flatMap((a) => a.windows.map((w) => readLane(w, a, now)));
    const metered = lanes.filter((l) => l.metered);
    const paced = metered.filter((l) => l.pace !== null);
    /* Summed, over the pooled allowance of every metered lane. A lane with
       no pace is in the denominator -- it is allowance -- and contributes
       zero to the numerator, because we cannot say it will be lost. */
    const loss = metered.length === 0 ? null : metered.reduce((t, l) => t + l.surplus, 0) / metered.length;
    const dry = paced.filter((l) => l.state === "dry").length;
    return { lanes, metered, paced, loss, dry };
  }

  /* ----------------------------------------------------------- drawing */

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  function axis(lanes) {
    const track = el("span", "r2-axis");
    track.append(el("i", "r2-zero"));
    for (const lane of lanes) {
      if (lane.balance) continue;
      const stripe = el("i", `r2-stripe is-${lane.boolean ? (lane.refusing ? "refusing" : "answering") : lane.state} hue${lane.hue}${lane.account.selected ? " routed" : ""}`);
      const x = lane.boolean ? 0 : position(lane);
      stripe.style.left = `${50 + x * 50}%`;
      stripe.title = `${lane.account.email} · ${lane.name}` +
        (lane.metered && lane.pace !== null ? ` · ${(lane.fill / lane.pace).toFixed(1)}× natural` : "") +
        (lane.surplus > 0 ? ` · ${Math.round(lane.surplus)} pts will go unspent` : "");
      track.append(stripe);
    }
    return track;
  }

  function lossCell(g) {
    const cell = el("span", "r2-loss");
    if (g.loss === null) { cell.classList.add("none"); cell.textContent = "—"; return cell; }
    const bar = el("i", "r2-lossbar");
    bar.style.setProperty("--w", `${clamp(g.loss, 0, 100)}%`);
    if (g.loss > 0) bar.classList.add("on");
    const num = el("b", "", g.loss > 0 ? `${Math.round(g.loss)}%` : "0");
    if (g.loss > 0) num.classList.add("on");
    cell.append(bar, num);
    cell.title = g.loss > 0 ? `${Math.round(g.loss)}% of the group's pooled allowance will go unspent` : "nothing will go unspent";
    return cell;
  }

  function row(provider, now) {
    const g = group(provider, now);
    const node = el("div", "r2-row");
    const tag = el("span", "r2-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase());
    if (g.dry > 0) tag.append(el("i", "r2-dry", `↓${g.dry}`));
    node.append(tag, axis(g.lanes), lossCell(g));
    return node;
  }

  function shelf(root, payload, now) {
    for (const p of payload.providers) root.append(row(p, now));
  }

  /* ---------------------------------------------------------- fixtures */

  /* One instant for every fixture, so the render reads the pace the fixture
     was written at. pace is a share of a 604 800 s window: 6 048 000 ms
     per point. */
  const T0 = Date.now();
  const win = (id, fill, pace, name = id) => ({
    id, name, remainingPercent: fill, lengthSeconds: 604800,
    resetsAt: new Date(T0 + pace * 6048e3).toISOString(),
  });

  const CANCEL = { providers: [{ id: "xx", accounts: [
    { email: "starving@x", selected: true, available: true, windows: [win("seven_day", 10, 90)] },
    { email: "wasting@x", available: true, windows: [win("seven_day", 90, 10)] },
  ] }] };

  const QUEUE = { providers: [{ id: "xx", accounts: [
    { email: "first@x", selected: true, available: true, windows: [win("seven_day", 80, 20)] },
    { email: "second@x", available: true, windows: [win("seven_day", 70, 30)] },
  ] }] };

  const CALM = { providers: [{ id: "xx", accounts: [
    { email: "a@x", selected: true, available: true, windows: [win("seven_day", 52, 50)] },
    { email: "b@x", available: true, windows: [win("seven_day", 47, 50)] },
    { email: "c@x", available: true, windows: [win("seven_day", 55, 50)] },
  ] }] };

  const MANY = { providers: [{ id: "xx", accounts: Array.from({ length: 12 }, (_, i) => ({
    email: `a${i}@x`, selected: i === 3, available: true,
    windows: [win("seven_day", [95, 40, 60, 48, 88, 20, 50, 70, 30, 52, 92, 45][i], [30, 60, 55, 50, 20, 70, 50, 40, 45, 50, 15, 55][i])],
  })) }] };

  window.QUOTA_ROUND53 = { shelf, group, readLane, position, CANCEL, QUEUE, CALM, MANY, T0 };
})();
