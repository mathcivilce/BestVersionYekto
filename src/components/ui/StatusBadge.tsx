import React from 'react';

interface StatusBadgeProps {
  status: 'open' | 'resolved' | 'pending';
  size?: 'sm' | 'md';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const getStatusStyles = () => {
    const baseClasses = size === 'sm' 
      ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
      : 'inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium';

    switch (status) {
      case 'open':
        return `${baseClasses} bg-red-100 text-red-800`;
      case 'resolved':
        return `${baseClasses} bg-green-100 text-green-800`;
      case 'pending':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      default:
        return `${baseClasses} bg-gray-100 text-gray-800`;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'open':
        return 'Open';
      case 'resolved':
        return 'Resolved';
      case 'pending':
        return 'Pending';
      default:
        return status;
    }
  };

  return (
    <span className={getStatusStyles()}>
      {getStatusText()}
    </span>
  );
};

export default StatusBadge; 