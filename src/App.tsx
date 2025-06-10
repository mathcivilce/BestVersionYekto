/**
 * Main App Component
 * 
 * This is the root component of the application that sets up:
 * - Context providers for global state management
 * - React Router for client-side navigation
 * - Protected routes for authenticated pages
 * - Global UI components like toasts
 * 
 * Context Hierarchy (outer to inner):
 * 1. ThemeProvider - Manages dark/light theme state
 * 2. AuthProvider - Handles user authentication and session management
 * 3. InboxProvider - Manages email inbox state and operations
 * 
 * The app uses a nested routing structure where most pages are wrapped
 * in a ProtectedRoute component that ensures users are authenticated.
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Context providers for global state management
import { AuthProvider } from './contexts/AuthContext';
import { InboxProvider } from './contexts/InboxContext';
import { ThemeProvider } from './contexts/ThemeContext';

// Authentication and layout components
import ProtectedRoute from './components/auth/ProtectedRoute';
import Layout from './components/layout/Layout';

// Page components
import Dashboard from './pages/Dashboard';
import SystemHealth from './pages/SystemHealth';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import EmailDetails from './pages/EmailDetails';
import Connections from './pages/Connections';
import Integrations from './pages/Integrations';
import ReplyTemplates from './pages/ReplyTemplates';
import TeamManagement from './pages/TeamManagement';
import StorageDashboard from './pages/StorageDashboard';

// Authentication pages (public routes)
import Login from './pages/Login';
import Register from './pages/Register';
import AcceptInvitation from './pages/AcceptInvitation';
import NotFound from './pages/NotFound';

function App() {
  return (
    <div>
      {/* Theme provider - handles dark/light mode theming */}
      <ThemeProvider>
      {/* Auth provider - manages user authentication state */}
      <AuthProvider>
        {/* Router - enables client-side navigation */}
        <Router>
          {/* Inbox provider - manages email inbox state and operations */}
          <InboxProvider>
            <div className="min-h-screen bg-background">
              <Routes>
                {/* Public routes - accessible without authentication */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/accept-invitation" element={<AcceptInvitation />} />
                
                {/* Protected routes - require authentication */}
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  {/* Default redirect to dashboard */}
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  
                  {/* Main application pages */}
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="system-health" element={<SystemHealth />} />
                  
                  {/* Inbox routes - support store-specific and email-specific views */}
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="inbox/:storeId" element={<Inbox />} />
                  <Route path="inbox/email/:emailId" element={<EmailDetails />} />
                  
                  {/* Configuration and management pages */}
                  <Route path="connections" element={<Connections />} />
                  <Route path="integrations" element={<Integrations />} />
                  <Route path="workflows/templates" element={<ReplyTemplates />} />
                  <Route path="team" element={<TeamManagement />} />
                  <Route path="storage" element={<StorageDashboard />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
                
                {/* Fallback route for unmatched URLs */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
            
            {/* Global toast notifications positioned at top-right */}
            <Toaster position="top-right" />
          </InboxProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
    </div>
  );
}

export default App;