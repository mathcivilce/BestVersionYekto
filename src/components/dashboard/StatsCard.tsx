import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  change?: number;
  changeLabel?: string;
  color?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  description,
  icon,
  change,
  changeLabel,
  color = 'blue'
}) => {
  const getColorClasses = () => {
    switch (color) {
      case 'blue':
        return 'bg-blue-50 text-blue-600';
      case 'green':
        return 'bg-green-50 text-green-600';
      case 'yellow':
        return 'bg-yellow-50 text-yellow-600';
      case 'red':
        return 'bg-red-50 text-red-600';
      case 'indigo':
        return 'bg-indigo-50 text-indigo-600';
      case 'purple':
        return 'bg-purple-50 text-purple-600';
      default:
        return 'bg-blue-50 text-blue-600';
    }
  };

  const getChangeColor = () => {
    if (!change) return '';
    return change >= 0 
      ? 'text-green-600' 
      : 'text-red-600';
  };

  const getChangeIcon = () => {
    if (!change) return null;
    return change >= 0 
      ? <span className="mr-1">↑</span> 
      : <span className="mr-1">↓</span>;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex items-center">
        <div className={`p-3 rounded-lg ${getColorClasses()}`}>
          {icon}
        </div>
        <div className="ml-5">
          <h3 className="text-sm font-medium text-gray-500">{title}</h3>
          <div className="mt-1 flex items-baseline">
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
            {change !== undefined && (
              <p className={`ml-2 flex items-center text-sm ${getChangeColor()}`}>
                {getChangeIcon()}
                {Math.abs(change)}%
                {changeLabel && <span className="text-gray-500 ml-1">{changeLabel}</span>}
              </p>
            )}
          </div>
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatsCard;