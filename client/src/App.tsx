import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { usePreferences } from './hooks/usePreferences';
import { ADMIN_ROLES, GOOGLE_CLIENT_ID } from './config';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CoachPage from './pages/CoachPage';
import AdminPage from './pages/AdminPage';
import ManagePage from './pages/ManagePage';
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
  const tree = (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
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
