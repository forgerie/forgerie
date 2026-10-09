import { Component, type ReactNode } from "react";

interface Props {
  /** What to draw instead of children that threw while drawing. */
  fallback: (message: string) => ReactNode;
  onError?: ((error: unknown) => void) | undefined;
  children: ReactNode;
}

/**
 * System atom: keeps a failure in its own place. Children that throw while
 * drawing are replaced by the fallback, and everything around them keeps
 * working. It draws nothing of its own.
 */
export class ErrorBoundary extends Component<Props, { message: string | undefined }> {
  override state: { message: string | undefined } = { message: undefined };
  static getDerivedStateFromError(error: unknown) { return { message: error instanceof Error ? error.message : String(error) }; }
  override componentDidCatch(error: unknown) { this.props.onError?.(error); }
  override render() { return this.state.message === undefined ? this.props.children : this.props.fallback(this.state.message); }
}
