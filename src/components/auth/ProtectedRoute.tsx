/**
 * ProtectedRoute Component
 * 
 * A higher-order component that protects routes requiring authentication.
 * It prevents unauthenticated users from accessing protected pages and
 * provides loading states during authentication checks.
 * 
 * Authentication Flow:
 * 1. Check if authentication is still loading (async auth state)
 * 2. Show loading spinner while auth state is being determined
 * 3. If no authenticated user, redirect to login page
 * 4. If authenticated user exists, render the protected content
 * 
 * Features:
 * - Route-level authentication protection
 * - Loading state management during auth checks
 * - Automatic redirect to login for unauthenticated users
 * - Seamless rendering of protected content for authenticated users
 * - Integration with React Router for navigation
 * 
 * Usage:
 * Wrap any component or route that requires authentication:
 * ```jsx
 * <ProtectedRoute>
 *   <Dashboard />
 * </ProtectedRoute>
 * ```
 * 
 * Security Considerations:
 * - Client-side route protection (should be paired with server-side auth)
 * - Prevents UI access but doesn't replace API-level security
 * - Uses React Router's replace navigation to prevent back-button issues
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Props interface for ProtectedRoute component
 * 
 * Accepts any React children that should be rendered
 * only for authenticated users.
 */
interface ProtectedRouteProps {
  children: React.ReactNode; // Protected content to render when authenticated
}

/**
 * ProtectedRoute Functional Component
 * 
 * Conditionally renders children based on authentication state.
 * Handles loading states and redirects for unauthenticated users.
 * 
 * @param children - React components to protect behind authentication
 * @returns JSX element (loading, redirect, or protected content)
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  // Access authentication state from global context
  const { user, loading } = useAuth();

  // Show loading spinner while authentication state is being determined
  // This prevents flashing of content during the initial auth check
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        {/* Centered loading spinner with consistent brand colors */}
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Redirect unauthenticated users to login page
  // Using 'replace' to prevent back-button navigation to protected routes
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Render protected content for authenticated users
  // The children can be any components that require authentication
  return <>{children}</>;
};

export default ProtectedRoute;