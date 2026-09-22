/* Round 54: the same idea, drawn in the shelf's own hand.
 *
 * Round 53 got the idea right and the drawing wrong. It broke three rules
 * the shipped shelf lives by:
 *
 *   one bar per line      it drew two: the axis and a loss bar.
 *   hairlines only        the axis was a 12 px slab.
 *   colour on marks only  the axis itself was tinted toward each failure.
 *
 * Nothing about the idea needs any of that. The axis is a rail -- the same
 * 3 px ground every lane already sits on -- with a 1 px tick at centre for
 * on-pace. Every meter is a short stripe standing on the rail at its rate.
 * The loss is a number in the countdown column, with the same arrow the
 * countdown already uses: up for credit dying, down for running dry. The
 * row is 12 px, the pitch is 4 px, the tag column is 22 px. It is a line
 * from the shipped shelf that happens to hold every account.
 *
 * Direction no longer needs colour on the axis. A stripe right of the tick
 * is amber, a stripe left of it is red, and the tick is where they part.
 */

(() => {
  const { group, position } = window.QUOTA_ROUND53;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const TAG = { antigravity: "AN", claude: "CL", codex: "CO", openrouter: "OP" };

  function rail(lanes) {
    const track = el("span", "h2-rail");
    track.append(el("i", "h2-ground"), el("i", "h2-zero"));
    /* Marks with no rate cannot stand on the axis. They sit under the rail,
       fanned out from centre so each stays a separate mark. */
    let unplaced = 0;
    for (const lane of lanes) {
      if (lane.balance) continue;
      const placed = !lane.boolean && lane.pace !== null;
      const cls = lane.boolean
        ? `h2-dot${lane.refusing ? " off" : ""}`
        : `h2-stripe is-${lane.state} hue${lane.hue}${lane.account.selected ? " routed" : ""}`;
      const mark = el("i", cls);
      if (placed) {
        mark.style.left = `${50 + position(lane) * 50}%`;
      } else {
        /* 0, +1, -1, +2, -2 ... steps of 6 px either side of centre. */
        const step = Math.ceil(unplaced / 2) * (unplaced % 2 === 1 ? 1 : -1);
        mark.style.left = `calc(50% + ${step * 6}px)`;
        unplaced += 1;
      }
      mark.title = `${lane.account.email} · ${lane.name}` +
        (lane.metered && lane.pace !== null ? ` · ${(lane.fill / lane.pace).toFixed(1)}× natural` : "") +
        (lane.surplus > 0 ? ` · ${Math.round(lane.surplus)} pts will go unspent` : "");
      track.append(mark);
    }
    return track;
  }

  /**
   * The countdown column, doing what it does on every other line: one
   * number, one arrow, coloured only when it is a problem.
   */
  function readout(g) {
    const cell = el("span", "h2-tm");
    if (g.loss === null) { cell.classList.add("none"); cell.textContent = "—"; return cell; }
    if (g.loss > 0) {
      cell.classList.add("loss");
      cell.append(el("i", "h2-glyph", "↑"), el("span", "", `${Math.round(g.loss)}%`));
      return cell;
    }
    cell.textContent = "0";
    return cell;
  }

  function row(provider, now) {
    const g = group(provider, now);
    const node = el("div", "h2-row");
    const tag = el("span", "h2-tag", TAG[provider.id] ?? provider.id.slice(0, 2).toUpperCase());
    node.append(tag, rail(g.lanes));
    const tm = readout(g);
    if (g.dry > 0) {
      /* Running dry is the other kind of trouble and gets the other arrow,
         on the same column, in the same place the countdown puts it. */
      const dry = el("span", "h2-tm dry");
      dry.append(el("i", "h2-glyph", "↓"), el("span", "", `${g.dry}`));
      const both = el("span", "h2-tms");
      both.append(dry, tm);
      node.append(both);
    } else {
      node.append(tm);
    }
    return node;
  }

  function shelf(root, payload, now) {
    for (const p of payload.providers) root.append(row(p, now));
  }

  window.QUOTA_ROUND54 = { shelf };
})();
