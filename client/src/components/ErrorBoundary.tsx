import { Component, type ReactNode } from 'react';
import { useHelpSupport } from './HelpSupport';
import { HELP_SUPPORT_ENABLED } from '../config';

// The gap found while designing Help & Support: before this, an uncaught
// render error was a blank white screen with no way out and no way to tell
// anyone (see docs/help-support-architecture.md §6). A function component so
// it can call useHelpSupport() — the class boundary below only ever renders
// this as a REPLACEMENT for its children, so it stays outside whatever threw.
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

interface Props { children: ReactNode }
interface State { hasError: boolean }

// Must be mounted INSIDE HelpSupportProvider (see App.tsx) so CrashFallback's
// useHelpSupport() call above has a provider to read — the provider's own
// state lives outside whatever subtree this boundary replaces, so opening the
// report panel still works even while the rest of the app is showing this
// fallback.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Metadata-only — never anything a teacher typed, matching every other
    // error-logging call site in this app.
    console.error('[app] uncaught_render_error', error.message);
  }

  render() {
    if (this.state.hasError) return <CrashFallback />;
    return this.props.children;
  }
}
