import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';

// The data router's errorElement (App.tsx). It catches render errors thrown above ErrorBoundary (AuthProvider, ToastProvider,
// NotificationProvider, HelpSupportProvider), which would otherwise hit react-router's default screen and print a stack trace.
// Deliberately provider-free: ErrorBoundary's CrashFallback calls useHelpSupport(), which throws if HelpSupportProvider is
// what failed. So there is no "Report this" button here.
export default function RootErrorScreen() {
  const error = useRouteError();

  useEffect(() => {
    // Metadata only, never the stack or anything a teacher typed, like ErrorBoundary.componentDidCatch.
    console.error('[app] uncaught_render_error', error instanceof Error ? error.message : 'unknown');
  }, [error]);

  return (
    <div className="app-crash">
      <div className="app-crash-card">
        <h1>Something went wrong</h1>
        <p>The app hit an unexpected error. Reloading usually fixes it.</p>
        <div className="app-crash-actions">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  );
}
