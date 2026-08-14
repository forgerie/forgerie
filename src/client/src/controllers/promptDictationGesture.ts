export type PromptDictationGestureLifecycle =
  | { readonly tag: "idle" }
  | { readonly tag: "pressed" };

export interface PromptDictationGestureCallbacks {
  readonly onPressStart: () => boolean | undefined;
  readonly onRelease: () => void;
  readonly onCancel: () => void;
}

export interface PromptDictationGestureOptions {
  readonly callbacks: PromptDictationGestureCallbacks;
}

const idleState: PromptDictationGestureLifecycle = { tag: "idle" };

export class PromptDictationGesture {
  private stateValue: PromptDictationGestureLifecycle = idleState;
  private disposed = false;

  public constructor(private readonly options: PromptDictationGestureOptions) {}

  public get state(): PromptDictationGestureLifecycle {
    return this.stateValue;
  }

  public press(): boolean {
    if (this.disposed || this.stateValue.tag !== "idle") return false;
    if (this.options.callbacks.onPressStart() === false) return false;
    this.stateValue = { tag: "pressed" };
    return true;
  }

  public release(): boolean {
    if (this.disposed || this.stateValue.tag !== "pressed") return false;
    this.stateValue = idleState;
    this.options.callbacks.onRelease();
    return true;
  }

  public cancel(): boolean {
    if (this.disposed || this.stateValue.tag !== "pressed") return false;
    this.stateValue = idleState;
    this.options.callbacks.onCancel();
    return true;
  }

  public dispose(): void {
    this.disposed = true;
    this.stateValue = idleState;
  }
}
