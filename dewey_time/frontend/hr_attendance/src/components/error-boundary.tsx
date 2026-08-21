import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /**
   * What to draw instead of the default English card.
   *
   * Given the error and the reload handler, because a fallback that cannot
   * offer the way out is a dead end. It is rendered WHERE THE CRASHED SUBTREE
   * WAS, so it has no providers above it: it must not read context, and must
   * not import anything that could have been what threw.
   *
   * The Mini App passes one (see MiniCrashScreen) because this card is wrong
   * on a phone in Khmer — and because it prints the raw error message, which
   * is diagnostics addressed to the wrong reader. The HR console passes
   * nothing and keeps the card exactly as it was.
   */
  fallback?: (error: Error, reload: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without it, a render-time throw anywhere in the
 * tree (e.g. an unexpected payload shape) unmounts the whole SPA to a blank
 * screen. This catches it and offers a reload, so one bad row can't
 * white-screen the app.
 *
 * Mirrors frontend/adms/src/components/error-boundary.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for diagnostics; the app keeps a usable fallback on screen.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.handleReload);
      return (
        <div className="flex h-screen items-center justify-center p-4">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              Dewey Time hit an unexpected error and couldn't render this view.
            </p>
            <p className="text-sm break-words text-muted-foreground">
              {this.state.error.message}
            </p>
            <Button onClick={this.handleReload} variant="outline">
              Reload
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
