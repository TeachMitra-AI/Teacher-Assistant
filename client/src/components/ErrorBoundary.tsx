import { Component, type ReactNode } from 'react';
import { useHelpSupport } from './HelpSupport';
import { HELP_SUPPORT_ENABLED } from '../config';

// Before this, an uncaught render error was a blank white screen with no way out or way to report it
// (docs/help-support-architecture.md). A function component so it can call useHelpSupport(); the class boundary below
// renders it as a replacement for its children, so it stays outside whatever threw.
// eslint-disable-next-line react-refresh/only-export-components -- paired with the class boundary below, which fast refresh can't track anyway.
function CrashFallback() {
  const { openBugReport } = useHelpSupport();
  return (
    <div className="app-crash">
      <div className="app-crash-card">
        <h1>Something went wrong</h1>
        <p>The app hit an unexpected error. Reloading usually fixes it.</p>
        <div className="app-crash-actions">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
          {HELP_SUPPORT_ENABLED && (
            <button type="button" className="btn-text" onClick={() => openBugReport({ category: 'crash' })}>
              Report this
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** Replaces the default full-page CrashFallback, for a boundary isolating one card or section (see App.tsx's root usage for the default). */
  fallback?: ReactNode;
  /** When this changes (by reference) after an error was caught, the error clears and children get a fresh mount, so a stale error can't block later valid data. Inert unless passed. */
  resetKey?: unknown;
}
interface State { hasError: boolean }

// Must be mounted inside HelpSupportProvider (App.tsx) so CrashFallback's useHelpSupport() has a provider; the provider's
// state lives outside the replaced subtree, so the report panel still works while the fallback shows.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Metadata only, never anything a teacher typed, like other error-logging call sites.
    console.error('[app] uncaught_render_error', error.message);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? <CrashFallback />;
    return this.props.children;
  }
}
