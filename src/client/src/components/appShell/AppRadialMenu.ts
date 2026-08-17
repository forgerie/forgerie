import { LitElement, css, html, svg, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  radialGlyphPoint,
  radialSectorPath,
  type RadialLayout,
  type RadialWedge,
} from "../../appShell/radialMenu";

export interface RadialMenuEntry {
  readonly slot: number;
  readonly label: string;
  readonly icon: unknown;
  readonly badge?: string | undefined;
  /**
   * Whether the slot has something to open right now.
   *
   * A slot with nothing behind it is drawn dark and named with a qualifier
   * rather than hidden. Hiding it would leave a gap, and a gap invites the
   * wheel to close up — which moves every direction behind it and undoes the
   * one promise this menu makes.
   */
  readonly enabled: boolean;
}

/**
 * The wheel itself.
 *
 * Draws only. Where the wedges are and which one is under the finger are
 * decided in `appShell/radialMenu.ts`, so the shape on screen and the hit test
 * come from one set of numbers and cannot drift apart.
 *
 * There is no centre label. The icons carry the meaning, and a name in the hub
 * put a second thing to read in the middle of a gesture whose whole point is
 * that it is aimed rather than read. Each wedge carries its name as an SVG
 * title instead, which costs no pixels.
 *
 * Every slot is drawn on every press, including the ones whose icons ran off
 * the edge of the screen. A wedge that cannot show its icon still occupies its
 * direction, and selection reads bearing rather than position, so it remains
 * reachable by flicking toward where it has always been.
 */
@customElement("app-radial-menu")
export class AppRadialMenu extends LitElement {
  @property({ attribute: false }) layout?: RadialLayout;
  @property({ attribute: false }) entries: readonly RadialMenuEntry[] = [];
  @property({ attribute: false }) hovered?: number;
  /** Length of the closing ring while the press is arming. */
  @property({ type: Number }) holdMs = 500;
  /** Where the press landed, while the wheel has not yet opened. */
  @property({ attribute: false }) arming?: { readonly x: number; readonly y: number };

  override render() {
    if (this.arming !== undefined) return this.renderArmRing(this.arming);
    const layout = this.layout;
    if (layout === undefined) return null;

    return html`
      <div class="scrim" aria-hidden="true"></div>
      ${this.renderWheel(layout)}
    `;
  }

  /**
   * The hold, made visible.
   *
   * Without it the half-second before the wheel appears is silent, and a press
   * that is arming looks exactly like a press that is being ignored. Anyone who
   * releases early learns the gesture is unreliable.
   */
  private renderArmRing(at: { readonly x: number; readonly y: number }): TemplateResult {
    return html`
      <div
        class="arm-ring"
        aria-hidden="true"
        style=${`left: ${String(at.x)}px; top: ${String(at.y)}px; animation-duration: ${String(this.holdMs)}ms`}
      ></div>
    `;
  }

  private renderWheel(layout: RadialLayout): TemplateResult {
    return html`
      <svg class="wheel" aria-hidden="true" focusable="false">
        ${layout.wedges.map((wedge) => this.renderWedge(layout, wedge))}
      </svg>
    `;
  }

  private renderWedge(layout: RadialLayout, wedge: RadialWedge) {
    const entry = this.entries.find((candidate) => candidate.slot === wedge.slot);
    // State classes are kept apart from the element's own class so the glyph
    // group does not also answer to `.wedge`. It did, and every count of the
    // wedges came back doubled.
    const state = [
      wedge.slot === this.hovered ? "on" : "",
      entry?.enabled === false ? "off" : "",
    ].filter((name) => name !== "").join(" ");

    const point = radialGlyphPoint(layout, wedge);
    return svg`
      <path class=${`wedge ${state}`} d=${radialSectorPath(layout, wedge)}>
        ${entry === undefined ? null : svg`<title>${entry.enabled ? entry.label : `${entry.label} (empty)`}</title>`}
      </path>
      ${point === undefined || entry === undefined ? null : svg`
        <g class=${`glyph ${state}`} transform=${`translate(${String(point.x)} ${String(point.y)})`}>
          <foreignObject x="-11" y="-11" width="22" height="22">
            <span class="glyph-slot">${entry.icon}</span>
          </foreignObject>
          ${entry.badge === undefined ? null : svg`
            <circle class="badge-dot" cx="11" cy="-9" r="7"></circle>
            <text class="badge-text" x="11" y="-9" text-anchor="middle" dominant-baseline="central">${entry.badge}</text>
          `}
        </g>
      `}
    `;
  }


  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 40; pointer-events: none; }

    /*
     * The same backdrop the modals use. An earlier version mixed with the page
     * background token, which is cream in the shipped light theme, so the
     * scrim lightened the page and the wedges washed out into it. The overlay
     * token is the one that actually dims, in every theme.
     *
     * Note for future edits: no backticks in comments inside this template.
     * They close it, and the file stops parsing.
     */
    .scrim { position: absolute; inset: 0; background: var(--pi-overlay); animation: radial-fade var(--pi-motion-fast) cubic-bezier(.2,0,0,1) both; }

    .wheel { position: absolute; inset: 0; width: 100%; height: 100%; }

    /* Opaque, so it separates from the dimmed page behind it whatever the theme. */
    .wedge { fill: var(--pi-surface); stroke: var(--pi-border); stroke-width: 1; transition: fill var(--pi-motion-fast) cubic-bezier(.2,0,0,1), stroke var(--pi-motion-fast) cubic-bezier(.2,0,0,1); }
    .wedge.on { fill: var(--pi-accent); stroke: var(--pi-accent); }
    /*
     * Reserved: its direction is permanent, its content is not here yet. It
     * recedes toward the scrim but keeps its outline, because the outline is
     * what teaches the bearing while the slot is empty.
     */
    .wedge.off { fill: color-mix(in srgb, var(--pi-surface) 42%, transparent); stroke: var(--pi-border-muted); }
    .wedge.off.on { fill: var(--pi-surface-hover); stroke: var(--pi-border); }

    .glyph-slot { display: grid; place-items: center; width: 22px; height: 22px; color: var(--pi-text); }
    .glyph-slot svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .glyph.on .glyph-slot { color: var(--pi-bg, #111214); }
    .glyph.off .glyph-slot { color: var(--pi-dim); }

    .badge-dot { fill: var(--pi-purple, #a89ede); }
    .badge-text { fill: var(--pi-bg); font: 600 9px system-ui, sans-serif; }

    .arm-ring {
      position: absolute;
      translate: -50% -50%;
      width: 52px;
      height: 52px;
      border: 2px solid var(--pi-accent);
      border-radius: 50%;
      animation: radial-arm 500ms cubic-bezier(.2,0,0,1) both;
    }

    @keyframes radial-arm {
      from { scale: 2.2; opacity: 0; }
      60% { opacity: .5; }
      to { scale: .8; opacity: .9; }
    }
    @keyframes radial-fade { from { opacity: 0; } to { opacity: 1; } }

    /*
     * Motion here only confirms a transition; it never carries information.
     * Removing it changes nothing about what the wheel says.
     */
    @media (prefers-reduced-motion: reduce) {
      .scrim, .arm-ring { animation: none; }
      .wedge { transition: none; }
      .arm-ring { opacity: .9; scale: .8; }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-radial-menu": AppRadialMenu;
  }
}
