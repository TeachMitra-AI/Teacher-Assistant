import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './auth';
import { trackPageView } from './lib/analytics';
import { OnboardingProvider } from './onboarding';
import { ToastProvider } from './components/Toast';
import { NotificationProvider } from './components/Notifications';
import { HelpSupportProvider } from './components/HelpSupport';
import { ErrorBoundary } from './components/ErrorBoundary';
// The AI Action Router's provider, not react-router's. Mounted innermost, so
// the existing AuthProvider → ToastProvider → OnboardingProvider order — which
// is load-bearing — is untouched, and deleting this feature removes one wrapper.
import { RouterProvider } from './assistant/RouterProvider';
import { usePreferences } from './hooks/usePreferences';
import { ADMIN_ROLES, GOOGLE_CLIENT_ID } from './config';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import BottomNav from './components/BottomNav';

// Authenticated-only pages are never rendered for a signed-out visitor, and
// pull in most of the app's heavy dependencies (recharts, socket.io-client,
// KaTeX, etc.) transitively — loading them on demand keeps the signed-out
// bundle serving "/", "/terms", "/privacy", and "/login" lightweight.
const CoachPage = lazy(() => import('./pages/CoachPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ManagePage = lazy(() => import('./pages/ManagePage'));
const AdminSupportPage = lazy(() => import('./pages/AdminSupportPage'));
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

function AppRoutes() {
  const { user, loading } = useAuth();
  const preferences = usePreferences();
  const location = useLocation();

  // GA4 page_view per SPA navigation (see lib/analytics.ts) — the automatic
  // gtag.js pageview is disabled at init specifically so this one effect
  // covers the first render and every later route change alike, including
  // transitions between the signed-out and signed-in route trees below.
  // No-op when GA was never initialized.
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

  // Password reset happens while signed OUT, so both of its pages live in this
  // tree alongside /login. The reset token travels in the path, which is what
  // the link in the email points at.
  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage preferences={preferences} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage preferences={preferences} />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage preferences={preferences} />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  const isAdmin = ADMIN_ROLES.includes(user.role);
  // Support Inbox is super_admin only — a stricter gate than isAdmin above,
  // matching AdminTabs.tsx's own reasoning (a ticket is product feedback,
  // not a school's own data).
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
      {/* Classroom Management (docs/classroom-feature-plan.md) — every role
          manages its OWN classroom data, no role gate needed (matches
          Coach/Library/Generator's unrestricted pattern). NOT the unrelated
          "Classroom Mode" AI chat feature, which has no page/route of its
          own. */}
      <Route path="/classroom" element={<ClassroomPage preferences={preferences} />} />
      <Route path="/attendance" element={<AttendancePage preferences={preferences} />} />
      <Route path="/generator" element={<GeneratorPage preferences={preferences} />} />
      <Route path="/settings" element={<SettingsPage preferences={preferences} />} />
      <Route path="/terms" element={<TermsOfServicePage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
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
        path="/admin/settings"
        element={isSuperAdmin ? <AdminSettingsPage preferences={preferences} /> : <Navigate to="/" replace />}
      />
      {/* Notification System send/broadcast — every ADMIN_ROLES member can
          reach this, unlike Support/Settings above (super_admin only): a
          school_admin/resource_person can send within their own scope
          (see docs/notification-system-plan.md §2). The backend
          independently re-derives and clamps that scope regardless of what
          this route lets through. */}
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
  // Mounted once, at the root. GoogleOAuthProvider calls
  // google.accounts.id.initialize() on mount, so keeping it inside LoginPage
  // re-ran that every time the Sign in/Register tab changed — which GSI warns
  // about ("initialize() is called multiple times") and which leaves only the
  // last instance live. Rendered here it initializes exactly once.
  // Without a client ID we skip the provider entirely; LoginPage already hides
  // the Google buttons in that case.
  //
  // HelpSupportProvider sits inside Auth+Toast (its panel needs both) and
  // outside ErrorBoundary — so if anything below the boundary crashes, the
  // "Report this" button in the resulting fallback screen still has a live
  // provider to open. The existing AuthProvider → ToastProvider →
  // OnboardingProvider → RouterProvider relative order is otherwise untouched;
  // these two are spliced in between Toast and Onboarding, not reordered
  // around them.
  //
  // NotificationProvider sits inside Auth+Toast too (it needs useAuth().user
  // to open/close its socket, and useToast() to surface a realtime arrival)
  // and outside ErrorBoundary for the same "survives a crash below it"
  // reasoning as HelpSupportProvider — spliced in right next to it rather
  // than nested inside, since neither depends on the other.
  const tree = (
    <BrowserRouter>
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
