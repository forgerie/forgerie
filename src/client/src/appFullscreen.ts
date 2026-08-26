import type { AppAction } from "./actions";

export interface AppFullscreenDocument {
  readonly fullscreenElement: unknown;
  readonly documentElement: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  };
  readonly exitFullscreen?: () => Promise<void>;
}

/** Build the explicit browser full-screen command shown in the app action menu. */
export function appFullscreenAction(target: AppFullscreenDocument = document): AppAction {
  const active = target.fullscreenElement !== null && target.fullscreenElement !== undefined;
  const enabled = active
    ? typeof target.exitFullscreen === "function"
    : typeof target.documentElement.requestFullscreen === "function";

  return {
    id: "app.view.toggle-fullscreen",
    title: active ? "Exit Full Screen" : "Enter Full Screen",
    description: active
      ? "Return to the browser window and restore its controls"
      : "Hide browser controls until you leave full-screen mode",
    group: "View",
    enabled,
    ...(enabled ? {} : { disabledReason: "This browser does not support full-screen mode." }),
    run: active ? () => exitAppFullscreen(target) : () => enterAppFullscreen(target),
  };
}

export async function enterAppFullscreen(target: AppFullscreenDocument = document): Promise<void> {
  const requestFullscreen = target.documentElement.requestFullscreen;
  if (requestFullscreen === undefined) throw new Error("The browser does not support full-screen mode.");
  await requestFullscreen.call(target.documentElement, { navigationUI: "hide" });
}

export async function exitAppFullscreen(target: AppFullscreenDocument = document): Promise<void> {
  if (target.exitFullscreen === undefined) throw new Error("The browser cannot exit full-screen mode.");
  await target.exitFullscreen();
}
