import { svg, type TemplateResult } from "lit";
import type { ThinkingGauge } from "../../../shared/thinkingLevels";

// Hand-rolled inline icons matching the project's stroke style
// (viewBox 0 0 24 24, fill none, stroke currentColor, round caps/joins).
// See tabIcons.ts for the established convention.

export function renderAttachIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 11.5 12.5 19a4 4 0 0 1-5.66-5.66l7.07-7.07a2.5 2.5 0 0 1 3.54 3.54l-7.07 7.07a1 1 0 0 1-1.42-1.42l6.37-6.36"></path>
    </svg>
  `;
}

export function renderArchiveIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7.5h16v12H4z"></path>
      <path d="M3 4.5h18v3H3z"></path>
      <path d="M9 12h6"></path>
    </svg>
  `;
}

export function renderSendIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 3 13.5 21l-2-8.5L3 10.5Z"></path>
      <path d="M21 3 11.5 12.5"></path>
    </svg>
  `;
}

export function renderQueueIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h11"></path>
      <path d="M4 12h7"></path>
      <path d="M4 17h7"></path>
      <path d="m15 14 5 3-5 3z"></path>
    </svg>
  `;
}

export function renderStopIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon prompt-action-icon-filled" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2"></rect>
    </svg>
  `;
}

export function renderMicrophoneIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.5a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3Z"></path>
      <path d="M6.5 10.5v1a5.5 5.5 0 0 0 11 0v-1"></path>
      <path d="M12 17v3"></path>
      <path d="M9 20h6"></path>
    </svg>
  `;
}

/** The command mark itself, miniaturized — a slash in its chip. */
export function renderSlashIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="14" rx="3"></rect>
      <path d="M13.5 8.5 10.5 15.5"></path>
    </svg>
  `;
}

/** The session tree — a root line with children hanging off one rail. */
export function renderTreeIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5h12"></path>
      <path d="M14 12h7"></path>
      <path d="M14 19h7"></path>
      <path d="M4 5v5a2 2 0 0 0 2 2h4"></path>
      <path d="M4 10v7a2 2 0 0 0 2 2h4"></path>
    </svg>
  `;
}

/** Changes the destination named by a composer context chip. */
export function renderChangeIcon(): TemplateResult {
  return svg`
    <svg class="prompt-context-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m4.5 19.5 4.25-1 9.5-9.5-3.25-3.25-9.5 9.5-1 4.25Z"></path>
      <path d="m13.75 7 3.25 3.25"></path>
    </svg>
  `;
}

/** Marks a place that is not the project's main worktree. */
export function renderBranchIcon(): TemplateResult {
  return svg`
    <svg class="prompt-branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="7" cy="6" r="2.2"></circle>
      <circle cx="7" cy="18" r="2.2"></circle>
      <circle cx="17" cy="9" r="2.2"></circle>
      <path d="M7 8.2v7.6M9.2 18h1.8a6 6 0 0 0 6-6v-.8"></path>
    </svg>
  `;
}

/** The way out of a composer that has one — drawn beside the way in. */
export function renderDismissIcon(): TemplateResult {
  return svg`
    <svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 7l10 10M17 7L7 17"></path>
    </svg>
  `;
}

/**
 * A gauge whose bar count comes from the available thinking levels (the non-"off"
 * levels) and whose fill reflects the current level's rank. Bars are laid out to
 * fill the 24x24 box regardless of count, so it adapts if pi changes the set.
 */
export function renderThinkingGauge(gauge: ThinkingGauge): TemplateResult {
  const total = Math.max(gauge.total, 1);
  const gap = total > 1 ? 1.2 : 0;
  const left = 3;
  const right = 21;
  const span = right - left;
  const barWidth = (span - gap * (total - 1)) / total;
  const bars = Array.from({ length: total }, (_unused, i) => {
    const x = left + i * (barWidth + gap);
    const height = 4 + ((i + 1) / total) * 12;
    const y = 20 - height;
    const active = i < gauge.filled;
    return svg`<rect class=${active ? "gauge-bar gauge-bar-active" : "gauge-bar"} x=${x} y=${y} width=${barWidth} height=${height} rx="1"></rect>`;
  });
  return svg`
    <svg class="prompt-thinking-gauge" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${bars}
    </svg>
  `;
}
