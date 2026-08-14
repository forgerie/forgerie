import { createPwaDisplayModeMedia, detectPwaDisplayMode } from "./pwaDisplayMode";

interface FullscreenDocument {
  readonly fullscreenElement: unknown;
  readonly documentElement?: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  };
}

export async function enterAppFullscreen(target: FullscreenDocument = document): Promise<void> {
  if (target.fullscreenElement !== null && target.fullscreenElement !== undefined) return;

  try {
    await target.documentElement?.requestFullscreen?.({ navigationUI: "hide" });
  } catch {
    // Browsers can deny fullscreen even after activation. The app must remain usable.
  }
}

interface PwaFullscreenInstallationOptions {
  readonly isPwaDisplayMode?: boolean;
  readonly interactionTarget?: EventTarget;
  readonly requestFullscreen?: () => Promise<void>;
}

export function installPwaFullscreenOnFirstInteraction({
  isPwaDisplayMode = detectPwaDisplayMode(createPwaDisplayModeMedia()),
  interactionTarget = document,
  requestFullscreen = enterAppFullscreen,
}: PwaFullscreenInstallationOptions = {}): () => void {
  if (!isPwaDisplayMode) return () => undefined;

  const listenerOptions = { capture: true } as const;
  let listening = true;
  const uninstall = () => {
    if (!listening) return;
    listening = false;
    interactionTarget.removeEventListener("click", onFirstClick, listenerOptions);
  };
  const onFirstClick = () => {
    uninstall();
    // Observe in capture so stopped events still count, then let synchronous
    // control handlers use transient activation before fullscreen can consume it.
    queueMicrotask(() => {
      void requestFullscreen().catch(() => undefined);
    });
  };

  interactionTarget.addEventListener("click", onFirstClick, listenerOptions);
  return uninstall;
}
