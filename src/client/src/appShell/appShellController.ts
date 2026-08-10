import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";
import { createPwaDisplayModeMedia, detectPwaDisplayMode } from "../pwaDisplayMode";
import { shellLayoutMode, type ShellLayoutMode } from "./shellLayoutMode";
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
  isPwaDisplayMode: boolean;

  constructor(private readonly host: ReactiveControllerHost, options: AppShellControllerOptions = {}) {
    host.addController(this);
    this.pwaDisplayModeMedia = options.pwaDisplayModeMedia ?? createPwaDisplayModeMedia();
    this.viewportPositionRepairer = options.viewportPositionRepairer ?? new ViewportPositionRepairer();
    this.measureShellWidth = options.measureShellWidth ?? (() => this.observedShellWidth());
    this.resizeObserver = createResizeObserver(this.onShellResize);
    this.layoutMode = shellLayoutMode(this.measureShellWidth());
    this.isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
  }

  /** The session owns the shell whenever navigation cannot dock beside it. */
  get isMobileNavigationLayout(): boolean {
    return this.layoutMode === "overlay";
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

  private applyMeasuredWidth(): void {
    const mode = shellLayoutMode(this.measureShellWidth());
    if (this.layoutMode === mode) return;
    this.layoutMode = mode;
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

