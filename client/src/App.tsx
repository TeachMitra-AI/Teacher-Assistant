import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './auth';
import { OnboardingProvider } from './onboarding';
import { ToastProvider } from './components/Toast';
import { HelpSupportProvider } from './components/HelpSupport';
import { ErrorBoundary } from './components/ErrorBoundary';
// The AI Action Router's provider, not react-router's. Mounted innermost, so
// the existing AuthProvider → ToastProvider → OnboardingProvider order — which
// is load-bearing — is untouched, and deleting this feature removes one wrapper.
import { RouterProvider } from './assistant/RouterProvider';
import { usePreferences } from './hooks/usePreferences';
import { ADMIN_ROLES, GOOGLE_CLIENT_ID } from './config';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CoachPage from './pages/CoachPage';
import AdminPage from './pages/AdminPage';
import ManagePage from './pages/ManagePage';
import AdminSupportPage from './pages/AdminSupportPage';
import SettingsPage from './pages/SettingsPage';
import LibraryPage from './pages/LibraryPage';
import ResourceView from './pages/ResourceView';
import ResourceWorkspace from './pages/ResourceWorkspace';
import GeneratorPage from './pages/GeneratorPage';
import BottomNav from './components/BottomNav';

function AppRoutes() {
  const { user, loading } = useAuth();
  const preferences = usePreferences();

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
        <Route path="/login" element={<LoginPage preferences={preferences} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage preferences={preferences} />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage preferences={preferences} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
      <Routes>
      <Route path="/" element={<CoachPage preferences={preferences} />} />
      <Route path="/library" element={<LibraryPage preferences={preferences} />} />
      <Route path="/library/:id" element={<ResourceView preferences={preferences} />} />
      <Route path="/library/:id/edit" element={<ResourceWorkspace preferences={preferences} />} />
      <Route path="/generator" element={<GeneratorPage preferences={preferences} />} />
      <Route path="/settings" element={<SettingsPage preferences={preferences} />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
  const tree = (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <HelpSupportProvider>
            <ErrorBoundary>
              <OnboardingProvider>
                <RouterProvider>
                  <AppRoutes />
                </RouterProvider>
              </OnboardingProvider>
            </ErrorBoundary>
          </HelpSupportProvider>
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
