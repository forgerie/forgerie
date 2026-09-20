/* Renders one variant across the size ladder by executing plan(width, height)
   at every rung. The picture and the implementation are then the same
   decision made once, which is the only way the states stay in agreement. */

(() => {
  const LADDER = [
    { name: "tiny", w: 236, h: 620 },
    { name: "narrow", w: 292, h: 620 },
    { name: "panel (today)", w: 360, h: 620 },
    { name: "cover pane", w: 475, h: 620 },
    { name: "generous", w: 700, h: 620 },
    { name: "wide + short", w: 900, h: 232 },
    { name: "short column", w: 360, h: 268 },
  ];

  window.renderLadder = (variantKey) => {
    const { NOW, ACCOUNTS } = window.QUOTA_FIXTURE;
    const render = window.QUOTA_VARIANTS[variantKey];
    const ladder = document.querySelector(".ladder");
    for (const rung of LADDER) {
      const cell = document.createElement("div");
      const label = document.createElement("div");
      label.className = "frame-label";
      label.innerHTML = `${rung.w} × ${rung.h} <b>${rung.name}</b>`;
      const frame = document.createElement("div");
      frame.className = "frame";
      frame.style.width = `${rung.w}px`;
      frame.style.height = `${rung.h}px`;
      frame.append(render(ACCOUNTS, window.QUOTA_PLAN.plan(rung.w, rung.h), NOW));
      cell.append(label, frame);
      ladder.append(cell);
    }
  };
})();
