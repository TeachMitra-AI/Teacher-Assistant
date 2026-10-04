import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './auth';
import { trackPageView } from './lib/analytics';
import { OnboardingProvider } from './onboarding';
import { ToastProvider } from './components/Toast';
import { NotificationProvider } from './components/Notifications';
import { HelpSupportProvider } from './components/HelpSupport';
import { ErrorBoundary } from './components/ErrorBoundary';
// The AI Action Router's provider (not react-router's). Innermost, so the AuthProvider → ToastProvider →
// OnboardingProvider order stays as is and removing the feature removes one wrapper.
import { RouterProvider } from './assistant/RouterProvider';
import { usePreferences } from './hooks/usePreferences';
import { ADMIN_ROLES, GOOGLE_CLIENT_ID } from './config';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import ScheduleDemoPage from './pages/ScheduleDemoPage';
import ManageBookingPage from './pages/ManageBookingPage';
import ContentPage from './pages/ContentPage';
import { CONTENT_PAGES } from './seo/pages';
import BottomNav from './components/BottomNav';
import ScrollToTop from './components/ScrollToTop';

// Authenticated-only pages pull in heavy dependencies (recharts, socket.io-client, KaTeX), so they load on demand to
// keep the signed-out bundle (/, /terms, /privacy, /login) light.
const CoachPage = lazy(() => import('./pages/CoachPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ManagePage = lazy(() => import('./pages/ManagePage'));
const AdminSupportPage = lazy(() => import('./pages/AdminSupportPage'));
const AdminDemoBookingsPage = lazy(() => import('./pages/AdminDemoBookingsPage'));
const AdminSupportTicketPage = lazy(() => import('./pages/AdminSupportTicketPage'));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const AdminNotificationsPage = lazy(() => import('./pages/AdminNotificationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const ResourceView = lazy(() => import('./pages/ResourceView'));
const ResourceWorkspace = lazy(() => import('./pages/ResourceWorkspace'));
const ClassroomPage = lazy(() => import('./pages/ClassroomPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const GeneratorPage = lazy(() => import('./pages/GeneratorPage'));

// Shown instead of the signed-out homepage when reconcile() has a stored token it couldn't verify because of a
// network failure, not because the token was actually rejected (auth.tsx's reconcile()). Bouncing straight to the
// public homepage here would look like an unexplained logout; this makes the real cause ("couldn't reach the
// server") visible and offers the one useful action.
function SessionCheckFailed() {
  const { retrySessionCheck } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retrySessionCheck();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="app-crash">
      <div className="app-crash-card">
        <h1>Couldn&apos;t verify your session</h1>
        <p>Check your connection and try again.</p>
        <div className="app-crash-actions">
          <button type="button" className="btn-primary" onClick={handleRetry} disabled={retrying} aria-busy={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user, loading, sessionCheckFailed } = useAuth();
  const preferences = usePreferences();
  const location = useLocation();

  // GA4 page_view per SPA navigation (lib/analytics.ts). The automatic gtag pageview is disabled at init so this covers the
  // first render and every route change, including signed-out to signed-in. No-op if GA wasn't initialized.
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    );
  }

  // A stored token exists but the last check of it failed to even reach the server — distinct from "there's no
  // session"/"the token was rejected", both of which fall through to the signed-out routes below as before.
  if (!user && sessionCheckFailed) {
    return <SessionCheckFailed />;
  }

  // Password reset happens signed out, so both pages live here beside /login; the token travels in the path.
  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage preferences={preferences} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage preferences={preferences} />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage preferences={preferences} />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/schedule-demo" element={<ScheduleDemoPage />} />
        <Route path="/schedule-demo/manage" element={<ManageBookingPage />} />
        {/* Public tool/guide pages — the same registry (seo/pages.ts) the prerender and sitemap read. */}
        {CONTENT_PAGES.map((page) => (
          <Route key={page.path} path={page.path} element={<ContentPage page={page} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  const isAdmin = ADMIN_ROLES.includes(user.role);
  // Support Inbox is super_admin only, stricter than isAdmin (a ticket is product feedback, not a school's data).
  const isSuperAdmin = user.role === 'super_admin';

  return (
    <>
      <Suspense
        fallback={
          <div className="app-loading">
            <div className="spinner" />
          </div>
        }
      >
      <Routes>
      <Route path="/" element={<CoachPage preferences={preferences} />} />
      <Route path="/library" element={<LibraryPage preferences={preferences} />} />
      <Route path="/library/:id" element={<ResourceView preferences={preferences} />} />
      <Route path="/library/:id/edit" element={<ResourceWorkspace preferences={preferences} />} />
      {/* Classroom Management (docs/classroom-feature-plan.md): every role manages its own data, so no role gate.
          Unrelated to the "Classroom Mode" AI chat feature, which has no route. */}
      <Route path="/classroom" element={<ClassroomPage preferences={preferences} />} />
      <Route path="/attendance" element={<AttendancePage preferences={preferences} />} />
      <Route path="/generator" element={<GeneratorPage preferences={preferences} />} />
      <Route path="/settings" element={<SettingsPage preferences={preferences} />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/schedule-demo" element={<ScheduleDemoPage signedIn />} />
      <Route path="/schedule-demo/manage" element={<ManageBookingPage signedIn />} />
      {/* Same public pages for a signed-in visitor (e.g. from a search result), with the call to action pointing at the real feature. */}
      {CONTENT_PAGES.map((page) => (
        <Route key={page.path} path={page.path} element={<ContentPage page={page} signedIn />} />
      ))}
      <Route
        path="/admin"
        element={isAdmin ? <AdminPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/manage"
        element={isAdmin ? <ManagePage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/support"
        element={isSuperAdmin ? <AdminSupportPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/support/:id"
        element={isSuperAdmin ? <AdminSupportTicketPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/demo-bookings"
        element={isSuperAdmin ? <AdminDemoBookingsPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/settings"
        element={isSuperAdmin ? <AdminSettingsPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      {/* Notification send/broadcast: any ADMIN_ROLES member can reach it (unlike Support/Settings) and send within their
          own scope; the backend re-derives and clamps the scope regardless (docs/notification-system-plan.md). */}
      <Route
        path="/admin/notifications"
        element={isAdmin ? <AdminNotificationsPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      <BottomNav />
    </>
  );
}

export default function App() {
  // Mounted once at the root: GoogleOAuthProvider calls google.accounts.id.initialize() on mount, and inside LoginPage it
  // re-ran on every tab switch (GSI warns, and only the last instance stays live). Skipped without a client ID, since
  // LoginPage already hides the Google buttons.
  // HelpSupportProvider and NotificationProvider sit inside Auth+Toast (they need both) and outside ErrorBoundary, so the
  // "Report this" button in the crash fallback still has a live provider. They're spliced in between Toast and
  // Onboarding without reordering the rest.
  const tree = (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <ToastProvider>
          <NotificationProvider>
            <HelpSupportProvider>
              <ErrorBoundary>
                <OnboardingProvider>
                  <RouterProvider>
                    <AppRoutes />
                  </RouterProvider>
                </OnboardingProvider>
              </ErrorBoundary>
            </HelpSupportProvider>
          </NotificationProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );

  return GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{tree}</GoogleOAuthProvider>
  ) : (
    tree
  );
}
