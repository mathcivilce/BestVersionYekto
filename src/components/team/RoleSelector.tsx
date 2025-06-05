import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Crown, Shield, Eye } from 'lucide-react';
import { UserRole } from '../../types/team';

interface RoleSelectorProps {
  currentRole: UserRole;
  onRoleChange: (newRole: UserRole) => void;
  disabled?: boolean;
}

const RoleSelector: React.FC<RoleSelectorProps> = ({
  currentRole,
  onRoleChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Crown size={14} className="text-yellow-500" />;
      case 'agent':
        return <Shield size={14} className="text-blue-500" />;
      case 'observer':
        return <Eye size={14} className="text-gray-500" />;
      default:
        return null;
    }
  };

  const getRoleBadgeClasses = (role: UserRole) => {
    const baseClasses = "px-2 py-1 text-xs font-medium rounded-full";
    switch (role) {
      case 'admin':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'agent':
        return `${baseClasses} bg-blue-100 text-blue-800`;
      case 'observer':
        return `${baseClasses} bg-gray-100 text-gray-800`;
      default:
        return baseClasses;
    }
  };

  const handleRoleSelect = (role: UserRole) => {
    if (role !== currentRole) {
      onRoleChange(role);
    }
    setIsOpen(false);
  };

  const roles: { value: UserRole; label: string; description: string }[] = [
    {
      value: 'admin',
      label: 'Admin',
      description: 'Full access to manage team and settings'
    },
    {
      value: 'agent',
      label: 'Agent',
      description: 'Can handle emails and manage assignments'
    },
    {
      value: 'observer',
      label: 'Observer',
      description: 'Read-only access to view emails'
    }
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`inline-flex items-center ${getRoleBadgeClasses(currentRole)} ${
          disabled 
            ? 'cursor-not-allowed opacity-50' 
            : 'cursor-pointer hover:bg-opacity-80'
        }`}
      >
        <span className="flex items-center">
          {getRoleIcon(currentRole)}
          <span className="ml-1 capitalize">{currentRole}</span>
        </span>
        {!disabled && (
          <ChevronDown size={12} className="ml-1" />
        )}
      </button>

      {isOpen && !disabled && (
        <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
          <div className="py-1" role="menu">
            {roles.map((role) => (
              <button
                key={role.value}
                onClick={() => handleRoleSelect(role.value)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-start ${
                  currentRole === role.value ? 'bg-blue-50' : ''
                }`}
                role="menuitem"
              >
                <div className="flex items-center mt-0.5">
                  {getRoleIcon(role.value)}
                </div>
                <div className="ml-3">
                  <div className="font-medium text-gray-900">{role.label}</div>
                  <div className="text-xs text-gray-500 mt-1">{role.description}</div>
                </div>
                {currentRole === role.value && (
                  <div className="ml-auto">
                    <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleSelector; 