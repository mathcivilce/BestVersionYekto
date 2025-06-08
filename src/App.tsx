import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { InboxProvider } from './contexts/InboxContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import SystemHealth from './pages/SystemHealth';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import EmailDetails from './pages/EmailDetails';
import Connections from './pages/Connections';
import Integrations from './pages/Integrations';
import ReplyTemplates from './pages/ReplyTemplates';
import TeamManagement from './pages/TeamManagement';
import Login from './pages/Login';
import Register from './pages/Register';
import AcceptInvitation from './pages/AcceptInvitation';
import NotFound from './pages/NotFound';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <InboxProvider>
            <div className="min-h-screen bg-background">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/accept-invitation" element={<AcceptInvitation />} />
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="system-health" element={<SystemHealth />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="inbox/:storeId" element={<Inbox />} />
                  <Route path="inbox/email/:emailId" element={<EmailDetails />} />
                  <Route path="connections" element={<Connections />} />
                  <Route path="integrations" element={<Integrations />} />
                  <Route path="workflows/templates" element={<ReplyTemplates />} />
                  <Route path="team" element={<TeamManagement />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
            <Toaster position="top-right" />
          </InboxProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;