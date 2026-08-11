import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";
import { createPwaDisplayModeMedia, detectPwaDisplayMode } from "../pwaDisplayMode";
import { chromeDisclosure, shellLayoutMode, type ChromeDisclosure, type ShellLayoutMode } from "./shellLayoutMode";
import { ViewportPositionRepairer } from "./viewportPositionRepair";

export interface AppShellControllerOptions {
  pwaDisplayModeMedia?: MediaQueryList[] | undefined;
  viewportPositionRepairer?: ViewportPositionRepairer | undefined;
  measureShellWidth?: (() => number) | undefined;
}

export class AppShellController implements ReactiveController {
  private readonly pwaDisplayModeMedia: MediaQueryList[];
  private readonly viewportPositionRepairer: ViewportPositionRepairer;
  private readonly measureShellWidth: () => number;
  private readonly resizeObserver: ResizeObserver | undefined;
  layoutMode: ShellLayoutMode;
  disclosure: ChromeDisclosure;
  isPwaDisplayMode: boolean;

  constructor(private readonly host: ReactiveControllerHost, options: AppShellControllerOptions = {}) {
    host.addController(this);
    this.pwaDisplayModeMedia = options.pwaDisplayModeMedia ?? createPwaDisplayModeMedia();
    this.viewportPositionRepairer = options.viewportPositionRepairer ?? new ViewportPositionRepairer();
    this.measureShellWidth = options.measureShellWidth ?? (() => this.observedShellWidth());
    this.resizeObserver = createResizeObserver(this.onShellResize);
    this.layoutMode = shellLayoutMode(this.measureShellWidth());
    this.disclosure = chromeDisclosure(this.measureShellWidth());
    this.isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
  }

  /** The session owns the shell whenever navigation cannot dock beside it. */
  get isMobileNavigationLayout(): boolean {
    return this.layoutMode === "overlay";
  }

  /**
   * Whether the chat surface hands its chrome to an on-request sheet instead of
   * keeping it resident above the transcript.
   *
   * A wider bar than navigation docking: a shell can dock its panel and still be
   * phone-shaped, where every band spends screen the conversation needed. Chrome
   * only stays resident on a true multi-pane workspace — navigation, session,
   * and workspace panel side by side. Every folded and unfolded posture of a
   * phone sits below that, so all of them get the conversation whole.
   */
  get isChromeSummoned(): boolean {
    return this.disclosure === "summoned";
  }

  hostConnected(): void {
    this.observeShellElement();
    for (const media of this.pwaDisplayModeMedia) media.addEventListener("change", this.onPwaDisplayModeChange);
  }

  hostDisconnected(): void {
    this.resizeObserver?.disconnect();
    for (const media of this.pwaDisplayModeMedia) media.removeEventListener("change", this.onPwaDisplayModeChange);
    this.viewportPositionRepairer.clear();
  }

  /** Re-measures after the host renders, so the first paint settles on the right mode. */
  hostUpdated(): void {
    this.observeShellElement();
    this.applyMeasuredWidth();
  }

  shouldShowAppRefreshInHeader(): boolean {
    return this.isPwaDisplayMode && !this.isMobileNavigationLayout;
  }

  shouldShowAppRefreshInContextBar(): boolean {
    return this.isPwaDisplayMode && this.isMobileNavigationLayout;
  }

  /** The session is always the landing surface; navigation is summoned over it. */
  defaultRouteView(): AppState["mainView"] {
    return "chat";
  }

  repairViewportPosition(): void {
    this.viewportPositionRepairer.repair(this.shouldRepairViewportPosition());
  }

  private shouldRepairViewportPosition(): boolean {
    return this.isMobileNavigationLayout || this.isPwaDisplayMode;
  }

  private observeShellElement(): void {
    const element = hostElement(this.host);
    if (this.resizeObserver === undefined || element === undefined || this.observedElement === element) return;
    if (this.observedElement !== undefined) this.resizeObserver.unobserve(this.observedElement);
    this.resizeObserver.observe(element);
    this.observedElement = element;
  }

  /**
   * Both bars are read from one measurement. Docking and disclosure sit at
   * different widths, so a resize can cross either alone — and both drive shell
   * classes, so either crossing has to reach the host.
   */
  private applyMeasuredWidth(): void {
    const width = this.measureShellWidth();
    const mode = shellLayoutMode(width);
    const disclosure = chromeDisclosure(width);
    if (this.layoutMode === mode && this.disclosure === disclosure) return;
    this.layoutMode = mode;
    this.disclosure = disclosure;
    this.host.requestUpdate();
  }

  private observedElement: Element | undefined;

  /** Prefers the shell's own box, falling back to the viewport before first paint. */
  private observedShellWidth(): number {
    const measured = this.observedElement?.clientWidth ?? 0;
    if (measured > 0) return measured;
    return typeof window === "undefined" ? 0 : window.innerWidth;
  }

  private readonly onShellResize = () => {
    this.applyMeasuredWidth();
  };

  private readonly onPwaDisplayModeChange = () => {
    const isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
    if (this.isPwaDisplayMode === isPwaDisplayMode) return;
    this.isPwaDisplayMode = isPwaDisplayMode;
    this.host.requestUpdate();
  };
}

function createResizeObserver(callback: () => void): ResizeObserver | undefined {
  if (typeof ResizeObserver === "undefined") return undefined;
  return new ResizeObserver(callback);
}

function hostElement(host: ReactiveControllerHost): Element | undefined {
  return host instanceof Element ? host : undefined;
}

