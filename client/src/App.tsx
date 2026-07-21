import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { usePreferences } from './hooks/usePreferences';
import { ADMIN_ROLES } from './config';
import LoginPage from './pages/LoginPage';
import CoachPage from './pages/CoachPage';
import AdminPage from './pages/AdminPage';
import ManagePage from './pages/ManagePage';
import SettingsPage from './pages/SettingsPage';
import LibraryPage from './pages/LibraryPage';
import ResourceView from './pages/ResourceView';
import ResourceWorkspace from './pages/ResourceWorkspace';
import GeneratorPage from './pages/GeneratorPage';

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

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage preferences={preferences} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = ADMIN_ROLES.includes(user.role);

  return (
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
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
