/**
 * Main Layout Component
 * 
 * This component provides the overall layout structure for authenticated pages.
 * It implements a responsive design with:
 * - Sidebar navigation (collapsible on mobile)
 * - Header with user actions
 * - Main content area using React Router's Outlet
 * - Mobile-first responsive design
 * 
 * Layout Structure:
 * - Desktop: Fixed sidebar + header + main content
 * - Mobile: Collapsible sidebar with floating toggle button
 */

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { Menu } from 'lucide-react';

const Layout: React.FC = () => {
  // State to control sidebar visibility on mobile devices
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /**
   * Toggle sidebar visibility
   * Used primarily for mobile navigation
   */
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile sidebar toggle button */}
      {/* Fixed position button in bottom-right corner, only visible on mobile */}
      <div className="lg:hidden fixed z-20 bottom-4 right-4">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* Sidebar Navigation */}
      {/* Passes open state and setter to handle mobile responsiveness */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with user actions and breadcrumbs */}
        <Header />
        
        {/* Main content wrapper */}
        {/* Uses Outlet to render the current route's component */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;