/* Round 35: what a boolean should look like.
 *
 * The strip from round 34 sits on the same rail as a meter, at the same
 * height, in the same grey. On most rows that is survivable, because a meter
 * carries a pace cut and a boolean does not. On Antigravity it is not:
 * Antigravity reports no window length, so its metered lanes have no cut
 * either and are drawn as plain bars. A flat bar above a flat strip, and
 * nothing says which is a quantity and which is a roster.
 *
 * So the strip has to be legible as a different kind of thing, not just a
 * different colour. Five ways, each held to the same four questions:
 *
 *   - with nothing blocked, is the row calm?
 *   - with one of a hundred blocked, can you find it?
 *   - with everything blocked, is it obvious?
 *   - could you mistake it for a meter at a glance?
 *
 *   bar    round 34. Full-height segments, grey available, red blocked.
 *   ghost  available segments drop to rail brightness, so the strip is an
 *          empty track and only trouble is drawn.
 *   notch  available segments are 1 px, blocked rise to the full 3 px.
 *   tick   a 1 px hairline for the whole roster, with blocked accounts as
 *          3 px marks standing on it.
 *   count  no segments at all: one proportion, available grey then blocked
 *          red. Scales without limit but names nobody.
 *
 * `ghost`, `notch` and `tick` all share one property worth stating plainly:
 * when nothing is blocked they are nearly invisible, which is the correct
 * reading. A roster with no problems is not news. `bar` and `count` always
 * draw something, and that something competes with the meters above it. */

(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* ------------------------------------------------------- the five ways */

  const MODES = ["bar", "ghost", "notch", "tick", "count"];

  function strip(states, mode) {
    const host = el("span", `m-lane m-${mode}`);

    if (mode === "count") {
      const blocked = states.filter((on) => !on).length;
      const share = (blocked / states.length) * 100;
      const ok = el("i", "m-run ok");
      ok.style.left = "0";
      ok.style.width = `${100 - share}%`;
      const bad = el("i", "m-run bad");
      bad.style.left = `${100 - share}%`;
      bad.style.width = `${share}%`;
      host.append(ok, bad);
      return host;
    }

    if (states.length > 40) host.classList.add("dense");
    if (mode === "tick") host.append(el("i", "m-wire"));
    for (const on of states) host.append(el("i", `m-seg${on ? "" : " off"}`));
    return host;
  }

  /* -------------------------------------------------- a row to judge it in */

  const meter = (hue, percent) => {
    const bar = el("span", `m-lane w-lane hue${hue} tone-ok`);
    bar.style.setProperty("--fill", `${percent}%`);
    bar.append(el("i", "w-ground full"), el("i", "w-fill flat"));
    return bar;
  };

  /** Antigravity's shape: flat metered lanes, then the roster. */
  function row(states, mode) {
    const node = el("div", "k-row");
    node.append(el("span", "k-tag", "AN"));
    const stack = el("span", "k-stack grouped");

    for (const [a, b] of [[78, 44], [12, 92]]) {
      const block = el("span", "k-acct");
      for (const [hue, percent] of [[0, a], [1, b]]) {
        const line = el("span", "k-line");
        line.append(meter(hue, percent));
        block.append(line);
      }
      stack.append(block);
    }

    const roster = el("span", "k-acct apart");
    const line = el("span", "k-line");
    line.append(strip(states, mode));
    roster.append(line);
    stack.append(roster);

    node.append(stack);
    return node;
  }

  /* ---------------------------------------------------------- the questions */

  const make = (count, blocked) => {
    const states = Array.from({ length: count }, () => true);
    for (const index of blocked) states[index] = false;
    return states;
  };

  const CASES = [
    { id: "calm", caption: "<b>nothing blocked</b> · two accounts, both up", note: "The common case. A roster with no problems is not news, so the quietest answer is the best one.", states: make(2, []) },
    { id: "one", caption: "one of two blocked", note: "The smallest count. Each segment is half the track, so nothing can hide.", states: make(2, [1]) },
    { id: "both", caption: "<b>both blocked</b> · no Gemini anywhere", note: "The emergency. Nothing routes, and the row has to say so without a word.", states: make(2, [0, 1]) },
    { id: "needle", caption: "<b>one of a hundred blocked</b>", note: "The needle. One account in a hundred is 2.5 px of track.", states: make(100, [63]) },
    { id: "some", caption: "nine of a hundred blocked, three adjacent", note: "A run should read as heavier than the same count scattered.", states: make(100, [4, 5, 17, 40, 41, 42, 63, 88, 99]) },
    { id: "most", caption: "<b>eighty of a hundred blocked</b>", note: "Failing at scale. Proportion has to survive the segmentation.", states: make(100, Array.from({ length: 80 }, (_, i) => i * 1 + 10)) },
  ];

  const COUNTS = [2, 8, 27, 100];

  window.QUOTA_ROUND35 = { MODES, CASES, COUNTS, strip, row, make };
})();
