import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Bell, User, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const getPageTitle = () => {
    const path = location.pathname;
    if (path.includes('/dashboard')) return 'Dashboard';
    if (path.includes('/inbox') && !path.includes('/inbox/')) return 'Inbox';
    if (path.includes('/inbox/')) return 'Email Details';
    if (path.includes('/open-tickets')) return 'Open Tickets';
    if (path.includes('/connections')) return 'Email Integrations';
    if (path.includes('/settings')) return 'Settings';
    return 'Support Hub';
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">{getPageTitle()}</h1>
        
        <div className="flex items-center space-x-4">
          {/* Search */}
          <div className="relative hidden md:block">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search..."
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          {/* Notifications */}
          <button className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 relative">
            <Bell size={20} />
            <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"></span>
          </button>
          
          {/* Settings */}
          <button 
            onClick={() => navigate('/settings')}
            className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100"
          >
            <Settings size={20} />
          </button>
          
          {/* User menu */}
          <div className="relative">
            <button className="flex items-center space-x-2 hover:bg-gray-100 p-1.5 rounded-full">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white">
                <User size={18} />
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;