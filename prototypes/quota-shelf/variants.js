/* Four answers to the same two complaints:
     1. the shelf must show how much fuel is left, in a real unit
     2. an unmetered pool must not be drawn as a full tank

   Each variant is one render function over the same fixture and the same
   plan(width, height). Nothing here is styled by device. */

(() => {
  const { duration, clockTime, isUnmetered, laneTone, bindingLane, laneValue, runway } = window.QUOTA_PLAN;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const whoText = (account, plan) =>
    plan.email === "full" || !account.email.includes("@") ? account.email : account.email.split("@")[0];

  const stateOf = (account) =>
    account.state === "cooling" ? { cls: "cooling", text: "cooling" }
      : account.state === "spent" ? { cls: "spent", text: "spent" }
      : account.routed ? { cls: "routed", text: "routed" }
      : { cls: "", text: "standby" };

  /** Reset, stated as the time until it happens. A balance that is topped up
      by hand has no reset and must say so rather than show a blank. */
  const resetText = (lane, now) =>
    lane.resetsAtMs === null ? "top-up" : duration(lane.resetsAtMs - now);

  function track(percent, tone) {
    const node = el("span", `track tone-${tone}`);
    node.append(el("i"));
    node.style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
    return node;
  }

  function sparkline(history, tone) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", `spark tone-${tone}`);
    svg.setAttribute("viewBox", "0 0 100 20");
    svg.setAttribute("preserveAspectRatio", "none");
    const points = history.map((value, i) => `${(i / (history.length - 1)) * 100},${20 - (value / 100) * 19}`);
    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("points", `0,20 ${points.join(" ")} 100,20`);
    area.setAttribute("fill", "currentColor");
    area.setAttribute("opacity", ".16");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.2");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(area, line);
    return svg;
  }

  /** An unmetered lane has no level, only a record of when it refused work.
      That record is the honest picture: ticks on the last 24 hours. */
  function tickStrip(events, now, spanMs) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ticks");
    svg.setAttribute("viewBox", "0 0 100 12");
    svg.setAttribute("preserveAspectRatio", "none");
    const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
    base.setAttribute("x1", "0"); base.setAttribute("x2", "100");
    base.setAttribute("y1", "11"); base.setAttribute("y2", "11");
    base.setAttribute("stroke", "#1e242a"); base.setAttribute("stroke-width", "2");
    svg.append(base);
    for (const at of events ?? []) {
      const x = ((at - (now - spanMs)) / spanMs) * 100;
      if (x < 0 || x > 100) continue;
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", String(x)); tick.setAttribute("x2", String(x));
      tick.setAttribute("y1", "1"); tick.setAttribute("y2", "11");
      tick.setAttribute("stroke", "currentColor"); tick.setAttribute("stroke-width", "1.5");
      tick.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(tick);
    }
    return svg;
  }

  function groups(accounts) {
    const order = [];
    const byProvider = new Map();
    for (const account of accounts) {
      if (!byProvider.has(account.provider)) { byProvider.set(account.provider, []); order.push(account.provider); }
      byProvider.get(account.provider).push(account);
    }
    return order.map((provider) => ({ provider, accounts: byProvider.get(provider) }));
  }

  function shelf(plan, variantClass) {
    const root = el("div", `shelf ${variantClass}${plan.bar ? "" : " no-bar"}`);
    root.style.setProperty("--name-col", plan.width >= 330 ? "4.6em" : "3.7em");
    if (plan.columns > 1) {
      root.style.columnCount = String(plan.columns);
      root.style.columnGap = "0";
      root.style.columnRule = "1px solid var(--line)";
    }
    return root;
  }

  function groupHead(provider) {
    const head = el("div", "group-head");
    head.append(el("span", null, provider), el("span", "rule"));
    return head;
  }

  function accountHead(account, plan) {
    const head = el("div", "acct-head");
    const state = stateOf(account);
    head.append(el("span", `who${account.routed ? "" : " faded"}`, whoText(account, plan)));
    head.append(el("span", `state ${state.cls}`, state.text));
    return head;
  }

  /* ---------------------------------------------------------------- A · ledger
     One line per lane, numbers right-aligned, the unmetered lane printing a
     word where the others print a level. Nearest to today's shelf, so it is
     the cheapest to ship. */
  function ledger(accounts, plan, now) {
    const root = shelf(plan, "a");
    for (const group of groups(accounts)) {
      root.append(groupHead(group.provider));
      for (const account of group.accounts) {
        const card = el("article", "acct");
        card.append(accountHead(account, plan));
        for (const lane of account.lanes) {
          const tone = laneTone(lane, now);
          const row = el("div", "lane");
          row.append(el("span", "lane-name", lane.name));
          if (plan.bar) {
            // No track for a lane that reports no level. A dashed rule keeps
            // the column aligned and says "nothing is measured here".
            row.append(isUnmetered(lane) ? el("span", "hollow") : track(lane.remainingPercent, tone));
          }
          const value = laneValue(lane);
          // The word "unmetered" is a readout about absence. It must not be the
          // loudest thing in the panel, so it never takes a tone colour.
          const cell = el("span", `lane-value num ${isUnmetered(lane) ? "unmetered" : `tone-${tone}`}`);
          cell.append(document.createTextNode(value.text));
          const trailing = isUnmetered(lane)
            ? (lane.blocked ? `cooling ${duration(lane.blockedUntilMs - now)}` : "open")
            : resetText(lane, now);
          if (plan.reset === "under" || value.exact) {
            const sub = el("span", "lane-sub num", [value.exact, plan.reset === "under" ? trailing : null].filter(Boolean).join(" · "));
            cell.append(sub);
          }
          row.append(cell);
          if (plan.reset === "column") row.append(el("span", `lane-reset num${isUnmetered(lane) ? ` tone-${tone}` : ""}`, trailing));
          card.append(row);
        }
        root.append(card);
      }
    }
    return root;
  }

  /* ------------------------------------------------------------------ B · fuel
     One number per account, big: what actually stops the work. The lane that
     binds owns the headline, the rest are thin tanks, and an unmetered pool
     leaves the tank stack entirely for a state chip. */
  function fuel(accounts, plan, now) {
    const root = shelf(plan, "b");
    for (const group of groups(accounts)) {
      root.append(groupHead(group.provider));
      for (const account of group.accounts) {
        const card = el("article", "card");
        card.append(accountHead(account, plan));

        const binding = bindingLane(account);
        const headline = el("div", "fuel");
        if (account.state === "cooling") {
          headline.append(el("div", "fuel-num tone-warn num", duration(account.coolingUntilMs - now)));
          const sub = el("div", "fuel-sub");
          sub.append(el("b", null, "proxy cooldown"), document.createTextNode(" · then retried"));
          headline.append(sub);
        } else if (binding) {
          const value = laneValue(binding);
          const tone = laneTone(binding, now);
          const number = el("div", `fuel-num num tone-${tone}`);
          number.append(document.createTextNode(value.text));
          headline.append(number);
          const sub = el("div", "fuel-sub");
          sub.append(el("b", null, binding.name), document.createTextNode(
            value.exact ? ` ${value.exact} · ${resetText(binding, now)}` : ` · resets ${resetText(binding, now)}`,
          ));
          headline.append(sub);
        }
        card.append(headline);

        for (const lane of account.lanes) {
          // A cooldown owns the headline, so the lane that binds still needs a
          // tank: otherwise its number disappears from the shelf entirely.
          if (isUnmetered(lane) || (lane === binding && account.state !== "cooling")) continue;
          const tone = laneTone(lane, now);
          const row = el("div", "tank");
          row.append(el("span", "tank-name", lane.name));
          if (plan.bar) row.append(track(lane.remainingPercent, tone));
          row.append(el("span", `tank-value num tone-${tone}`, `${laneValue(lane).text} · ${resetText(lane, now)}`));
          card.append(row);
        }

        const unmetered = account.lanes.filter(isUnmetered);
        if (unmetered.length > 0) {
          const chips = el("div", "chip-row");
          for (const lane of unmetered) {
            const tone = laneTone(lane, now);
            const chip = el("span", `chip tone-${tone}`);
            chip.append(el("i", "dot"));
            chip.append(el("span", null, lane.blocked
              ? `${lane.name} cooling ${duration(lane.blockedUntilMs - now)}`
              : `${lane.name} open`));
            chips.append(chip);
          }
          card.append(chips);
        }
        root.append(card);
      }
    }
    return root;
  }

  /* --------------------------------------------------------------- C · runway
     Percentages turned into the only question asked mid-work: how long can I
     keep going, and when does it come back. Two marks on one timeline: the
     instant the lane runs dry, and the instant it refills. */
  function runwayView(accounts, plan, now) {
    const root = shelf(plan, "c");
    const DAY = 86_400_000;
    for (const group of groups(accounts)) {
      root.append(groupHead(group.provider));
      for (const account of group.accounts) {
        const card = el("article", "acct");
        card.append(accountHead(account, plan));

        const binding = bindingLane(account);
        const verdict = el("div", "verdict");
        if (account.state === "cooling") {
          verdict.className = "verdict tone-warn";
          verdict.append(document.createTextNode("Refusing work, retry in "), el("b", null, duration(account.coolingUntilMs - now)));
        } else if (binding && binding.remainingPercent <= 0) {
          verdict.className = "verdict tone-dead";
          verdict.append(document.createTextNode(`${binding.name} spent, back in `), el("b", null, resetText(binding, now)));
        } else if (binding) {
          const r = runway(binding, now);
          const tone = laneTone(binding, now);
          verdict.className = `verdict tone-${tone}`;
          if (r.known && Number.isFinite(r.dryInMs) && !r.lastsToReset) {
            verdict.append(document.createTextNode(`${binding.name} dry in `), el("b", null, duration(r.dryInMs)),
              document.createTextNode(`, ${duration(r.untilReset)} before reset`));
          } else if (r.known && r.lastsToReset) {
            verdict.append(document.createTextNode(`${binding.name} lasts past reset in `), el("b", null, duration(r.untilReset)));
          } else {
            verdict.append(el("b", null, laneValue(binding).text), document.createTextNode(
              binding.resetsAtMs === null
                ? ` of ${binding.name} left, no reset — topped up by hand`
                : ` of ${binding.name} left, resets in ${resetText(binding, now)}`));
          }
        }
        card.append(verdict);

        for (const lane of account.lanes) {
          const tone = laneTone(lane, now);
          const row = el("div", "lane");
          const top = el("div", "lane-top");
          top.append(el("span", "lane-name", lane.name));
          const r = runway(lane, now);
          const text = isUnmetered(lane)
            ? (lane.blocked
              ? `blocked, retry ${duration(lane.blockedUntilMs - now)}`
              : `open · ${(lane.blockEvents ?? []).length} refusals in 24 h`)
            : lane.remainingPercent <= 0
              ? `empty until ${clockTime(lane.resetsAtMs)}`
              : r.known && Number.isFinite(r.dryInMs) && !r.lastsToReset
                ? `${duration(r.dryInMs)} of work left at this pace`
                : r.known && r.lastsToReset
                  ? `covers the ${duration(r.untilReset)} to reset`
                  : lane.resetsAtMs === null
                    ? `${laneValue(lane).text} left, no reset`
                    : `${laneValue(lane).text} left · pace needs history`;
          top.append(el("span", "lane-text", text));
          top.append(el("span", `num tone-${tone}`, isUnmetered(lane) ? "" : laneValue(lane).text));
          // The reset instant rides the text line, not the timeline: a label
          // pinned to the mark lands on top of the bar it is measuring.
          if (!isUnmetered(lane) && lane.resetsAtMs !== null) {
            top.append(el("span", "lane-reset num", `↻ ${duration(lane.resetsAtMs - now)}`));
          }
          row.append(top);

          if (isUnmetered(lane)) {
            const strip = el("div", `tone-${tone}`);
            strip.append(tickStrip(lane.blockEvents, now, DAY));
            row.append(strip);
          } else {
            const untilReset = lane.resetsAtMs === null ? null : lane.resetsAtMs - now;
            const dry = r.known && Number.isFinite(r.dryInMs) ? r.dryInMs : null;
            // With neither a reset nor a pace there is no time axis to draw,
            // and a one-pixel stub would read as debris.
            if (untilReset === null && dry === null) { card.append(row); continue; }
            const horizon = Math.max(untilReset ?? 0, dry ?? 0, 1) * 1.08;
            const line = el("div", `timeline tone-${tone}`);
            line.append(el("i", "axis"));
            // The filled span means "work is possible until here". Only a known
            // pace earns one: filling it to the reset mark when the pace is
            // unknown would claim a runway nobody measured.
            if (dry !== null) {
              const span = el("i", "span");
              span.style.left = "0";
              span.style.width = `${Math.max(1, Math.min(100, (dry / horizon) * 100))}%`;
              line.append(span);
            }
            if (untilReset !== null) {
              const mark = el("i", "mark");
              const at = (untilReset / horizon) * 100;
              mark.style.left = `${at}%`;
              line.append(mark);
            }
            row.append(line);
          }
          card.append(row);
        }
        root.append(card);
      }
    }
    return root;
  }

  /* --------------------------------------------------------------- D · trend
     A level is a snapshot; a line says whether the snapshot is falling. The
     unmetered lane gets the same treatment in its only honest currency: the
     429s the proxy recorded. Needs the router to keep samples, which it does
     not do today. */
  function trend(accounts, plan, now) {
    const root = shelf(plan, "d");
    const DAY = 86_400_000;
    for (const group of groups(accounts)) {
      root.append(groupHead(group.provider));
      for (const account of group.accounts) {
        const card = el("article", "acct");
        card.append(accountHead(account, plan));
        for (const lane of account.lanes) {
          const tone = laneTone(lane, now);
          const row = el("div", "lane");
          row.append(el("span", "lane-name", lane.name));
          if (plan.bar) {
            const holder = el("span", `tone-${tone}`);
            holder.append(isUnmetered(lane) ? tickStrip(lane.blockEvents, now, DAY) : sparkline(lane.history, tone));
            row.append(holder);
          }
          const value = el("span", `lane-value num tone-${tone}`);
          value.append(document.createTextNode(
            isUnmetered(lane) ? `${(lane.blockEvents ?? []).length}×429` : laneValue(lane).text));
          value.append(el("small", null, isUnmetered(lane)
            ? (lane.blocked ? `cooling ${duration(lane.blockedUntilMs - now)}` : "24 h")
            : `${laneValue(lane).exact ? `${laneValue(lane).exact} · ` : ""}${resetText(lane, now)}`));
          row.append(value);
          card.append(row);
        }
        root.append(card);
      }
    }
    return root;
  }

  window.QUOTA_VARIANTS = { a: ledger, b: fuel, c: runwayView, d: trend };
})();
