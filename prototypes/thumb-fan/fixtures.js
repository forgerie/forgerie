/**
 * Enough transcript to make the gesture compete with real conditions:
 * text that wants to be selected, a block that wants to scroll sideways, and
 * enough height to scroll vertically. A fan that works over an empty page
 * proves nothing.
 */

/**
 * The eight-slot map, read from the app rather than invented.
 *
 * Inbox lives in the navigation panel (`AppNavigationPanel.ts`). The other ten
 * candidates are registered workspace panels: five from
 * `plugins/core/panels.ts` and five from `pi-web-plugins/*`. Earlier drafts of
 * this file guessed at the names and got two wrong — there is no "Diff" panel
 * (it is Git) and no "Runs" panel (it is Processes).
 *
 * Slot order is fixed by the panels' own `order` values, which are the
 * closest thing to a considered judgement that exists: Files 10, Git 20,
 * Terminal 30, Notifications 40, Tasks 40, Processes 50, Agents 60. Agents is
 * behind More because `panels.ts:55` calls it "the least-reached-for tool".
 *
 * For Radial this order is a **permanent commitment**. It fixes the direction
 * of every wedge, and changing it re-teaches all of them. See README.
 *
 * `available: false` marks a slot that is reserved but has nothing in it right
 * now. Two real panels are conditionally visible — Notifications only when
 * `notificationCount > 0`, Agents only while something is delegated — so a
 * wheel with fixed directions has to be able to show a dark slot. The
 * alternative is re-packing, and re-packing rotates every direction.
 */
export const TARGETS = [
  { id: "inbox", label: "Inbox", glyph: "\u2630", badge: "4", slot: "W" },
  { id: "workspace.files", label: "Files", glyph: "\u{1F5C0}", slot: "NW" },
  { id: "workspace.git", label: "Git", glyph: "\u00B1", slot: "N" },
  { id: "workspace.terminal", label: "Terminal", glyph: "\u232B", slot: "NE" },
  { id: "workspace.processes", label: "Processes", glyph: "\u25B6", badge: "2", slot: "E" },
  { id: "workspace.tasks", label: "Tasks", glyph: "\u2713", slot: "SE" },
  // Conditional in the real app. Shown dark here so the reserved-slot state is
  // visible in captures rather than only described.
  { id: "notifications", label: "Alerts", glyph: "\u2691", slot: "S", available: false },
  { id: "more", label: "More", glyph: "\u22EF", slot: "SW" },
];

/** Panels reached through the More sheet rather than a wedge. */
export const OVERFLOW = ["Agents", "Relays", "Info", "Updates"];

export const TURNS = [
  {
    role: "user",
    text: "The workspace panel tab strip sits at the top. On the tablet I cannot reach it one-handed. What are the options?",
  },
  {
    role: "agent",
    text: "Three, and only one of them survives contact with a 14.6-inch panel held in one hand. A rail on the outer edge, anchored to the bottom, is the reachable one. A fan under the thumb is faster once learned but invisible until pressed. Keeping the top strip and only merging the panels moves the problem without solving it.",
  },
  {
    role: "agent",
    text: "The peek gesture already steps aside for a resting press, so the hold is available without taking anything back from the shell:",
    code: "const PEEK_STILL_MS = ROW_PRESS.holdMs;                       // 500\nthis.stillTimer = setTimeout(() => { this.disarm(); }, PEEK_STILL_MS);\nif (Math.abs(dx) >= this.config.capturePx) { this.travelled = true; }  // 10px",
  },
  {
    role: "user",
    text: "And the fan appears wherever my thumb lands, not in a fixed corner.",
  },
  {
    role: "agent",
    text: "Then the arc has to rotate to stay on screen, and rotating it destroys angular muscle memory. The trade is ordinal memory instead: target one is always the end nearest the bottom of the screen, whichever way the arc has turned. Whether that is good enough is the thing this prototype is for.",
  },
  {
    role: "agent",
    text: "The unresolved cost is text selection. The transcript is a copy surface, and a long press on selectable text raises the platform callout. Try both press zones below and decide which loss you prefer.",
  },
  {
    role: "user",
    text: "Give me the numbers as sliders. I am not going to accept a guessed radius for a thumb I have and you do not.",
  },
  {
    role: "agent",
    text: "Radius, spacing, hold, and dead zone are all live. Change one, press, feel it, change it again. The readout at the bottom records travel and elapsed time for each press so a preference can be checked against what your hand actually did rather than what it felt like.",
  },
];
