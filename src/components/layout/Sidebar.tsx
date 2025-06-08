import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, Inbox, Settings, LayoutDashboard, Mail, ShoppingBag, ChevronDown, ChevronRight, FileText, Users, Activity } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useInbox } from '../../contexts/InboxContext';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { stores } = useInbox();
  const [inboxOpen, setInboxOpen] = useState(true);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const closeSidebar = () => {
    setIsOpen(false);
  };

  const emailStores = stores.filter(store => store.connected && store.platform === 'outlook');

  const navItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { path: '/system-health', icon: <Activity size={20} />, label: 'System Health' },
    { 
      path: '/inbox',
      icon: <Inbox size={20} />,
      label: 'Inbox',
      submenu: emailStores.map(store => ({
        path: `/inbox/${store.id}`,
        label: store.name
      }))
    },
    { path: '/connections', icon: <Mail size={20} />, label: 'Email Integration' },
    { path: '/integrations', icon: <ShoppingBag size={20} />, label: 'Shopify Integration' },
    {
      path: '/workflows',
      icon: <FileText size={20} />,
      label: 'Workflows',
      submenu: [
        { path: '/workflows/templates', label: 'Reply Templates' }
      ]
    },
    { 
      path: '/settings', 
      icon: <Settings size={20} />, 
      label: 'Settings',
      submenu: [
        { path: '/team', label: 'Team Management' }
      ]
    },
  ];

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={closeSidebar}
        ></div>
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-30 h-full w-64 bg-sidebar-bg transform transition-transform duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <button
          onClick={closeSidebar}
          className="lg:hidden absolute top-4 right-4 p-1.5 rounded-full hover:bg-sidebar-text/10"
        >
          <X size={20} className="text-sidebar-text-active" />
        </button>

        <div className="px-4 py-6">
          <Link to="/dashboard" className="flex items-center" onClick={closeSidebar}>
            <span className="text-xl font-semibold text-sidebar-text-active">Yekto</span>
          </Link>
        </div>

        <nav className="px-2 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.path}>
                {item.submenu ? (
                  <div className="space-y-1">
                    <button
                      onClick={() => {
                        if (item.path === '/inbox') setInboxOpen(!inboxOpen);
                        if (item.path === '/workflows') setWorkflowsOpen(!workflowsOpen);
                        if (item.path === '/settings') setSettingsOpen(!settingsOpen);
                      }}
                      className={`w-full flex items-center justify-start px-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                        location.pathname.startsWith(item.path)
                          ? 'bg-white/10 text-sidebar-text-active'
                          : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-text-active'
                      }`}
                    >
                      <span className={location.pathname.startsWith(item.path) ? 'text-sidebar-text-active' : 'text-sidebar-text'}>
                        {item.icon}
                      </span>
                      <span className="ml-3 flex-1 text-left">{item.label}</span>
                      {(item.path === '/inbox' ? inboxOpen : (item.path === '/workflows' ? workflowsOpen : settingsOpen)) ? (
                        <ChevronDown size={16} className="text-sidebar-text" />
                      ) : (
                        <ChevronRight size={16} className="text-sidebar-text" />
                      )}
                    </button>
                    {((item.path === '/inbox' && inboxOpen) || (item.path === '/workflows' && workflowsOpen) || (item.path === '/settings' && settingsOpen)) && (
                      <ul className="pl-8 space-y-1">
                        {item.path === '/inbox' && (
                          <li>
                            <Link
                              to={item.path}
                              onClick={closeSidebar}
                              className={`block px-2 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                                isActive(item.path)
                                  ? 'bg-white/10 text-sidebar-text-active'
                                  : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-text-active'
                              }`}
                            >
                              All Inboxes
                            </Link>
                          </li>
                        )}
                        {item.path === '/settings' && (
                          <li>
                            <Link
                              to={item.path}
                              onClick={closeSidebar}
                              className={`block px-2 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                                isActive(item.path)
                                  ? 'bg-white/10 text-sidebar-text-active'
                                  : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-text-active'
                              }`}
                            >
                              Profile Settings
                            </Link>
                          </li>
                        )}
                        {item.submenu.map((subItem) => (
                          <li key={subItem.path}>
                            <Link
                              to={subItem.path}
                              onClick={closeSidebar}
                              className={`block px-2 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                                location.pathname.includes(subItem.path)
                                  ? 'bg-white/10 text-sidebar-text-active'
                                  : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-text-active'
                              }`}
                            >
                              {subItem.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <Link
                    to={item.path}
                    onClick={closeSidebar}
                    className={`flex items-center justify-start px-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                      isActive(item.path)
                        ? 'bg-white/10 text-sidebar-text-active'
                        : 'text-sidebar-text hover:bg-white/5 hover:text-sidebar-text-active'
                    }`}
                  >
                    <span className={isActive(item.path) ? 'text-sidebar-text-active' : 'text-sidebar-text'}>
                      {item.icon}
                    </span>
                    <span className="ml-3 text-left">{item.label}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="absolute bottom-0 w-full border-t border-white/10 p-4">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sidebar-text-active">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-sidebar-text-active">
                {user?.email || 'User'}
              </p>
              <button
                onClick={logout}
                className="text-xs text-sidebar-text hover:text-sidebar-text-active"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;