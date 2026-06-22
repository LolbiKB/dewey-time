import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level error boundary. Without it, a render-time throw anywhere in the tree
 * (e.g. an unexpected payload shape) unmounts the whole app to a blank screen.
 * This catches it and offers a reload, so one bad row can't white-screen the
 * entire dashboard.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for diagnostics; the app keeps a usable fallback on screen.
    console.error('Unhandled render error:', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center p-4">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              The dashboard hit an unexpected error and couldn't render this view.
            </p>
            <p className="text-sm text-muted-foreground break-words">
              {this.state.error.message}
            </p>
            <Button onClick={this.handleReload} variant="outline">
              Reload
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
