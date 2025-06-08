/**
 * StatsCard Component
 * 
 * A reusable dashboard statistics card component that displays key metrics
 * with visual indicators, icons, and optional percentage changes.
 * 
 * Features:
 * - Customizable color themes (blue, green, yellow, red, indigo, purple)
 * - Icon support for visual identification
 * - Change percentage with up/down indicators
 * - Optional description text
 * - Responsive design with consistent spacing
 * - Accessibility-friendly color combinations
 * 
 * Used throughout the dashboard to display:
 * - Email volume metrics
 * - Performance indicators
 * - Business KPIs
 * - Real-time statistics
 */

import React from 'react';

/**
 * Props interface for StatsCard component
 * 
 * Defines all configurable properties for creating consistent
 * and flexible statistics cards across the application.
 */
interface StatsCardProps {
  title: string;              // Card title displayed above the main value
  value: string | number;     // Main statistic value (can be number or formatted string)
  description?: string;       // Optional descriptive text below the value
  icon: React.ReactNode;      // Icon component for visual identification
  change?: number;            // Optional percentage change (positive/negative)
  changeLabel?: string;       // Optional label for the change indicator (e.g., "vs last month")
  color?: string;             // Color theme for the icon background
}

/**
 * StatsCard Functional Component
 * 
 * Renders a statistics card with icon, value, and optional change indicator.
 * Provides consistent styling and behavior across all dashboard metrics.
 */
const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  description,
  icon,
  change,
  changeLabel,
  color = 'blue' // Default to blue theme if no color specified
}) => {
  /**
   * Get Color Classes for Icon Background
   * 
   * Returns Tailwind CSS classes for icon background and text color
   * based on the selected color theme. Uses light background with
   * darker text for good contrast and accessibility.
   * 
   * @returns string - Tailwind CSS classes for background and text color
   */
  const getColorClasses = () => {
    switch (color) {
      case 'blue':
        return 'bg-blue-50 text-blue-600';     // Light blue background, dark blue icon
      case 'green':
        return 'bg-green-50 text-green-600';   // Light green background, dark green icon
      case 'yellow':
        return 'bg-yellow-50 text-yellow-600'; // Light yellow background, dark yellow icon
      case 'red':
        return 'bg-red-50 text-red-600';       // Light red background, dark red icon
      case 'indigo':
        return 'bg-indigo-50 text-indigo-600'; // Light indigo background, dark indigo icon
      case 'purple':
        return 'bg-purple-50 text-purple-600'; // Light purple background, dark purple icon
      default:
        return 'bg-blue-50 text-blue-600';     // Fallback to blue theme
    }
  };

  /**
   * Get Change Indicator Color
   * 
   * Returns appropriate text color for percentage change display.
   * Green for positive changes, red for negative changes.
   * 
   * @returns string - Tailwind CSS text color class
   */
  const getChangeColor = () => {
    if (!change) return '';
    return change >= 0 
      ? 'text-green-600'  // Green for positive change (good)
      : 'text-red-600';   // Red for negative change (attention needed)
  };

  /**
   * Get Change Direction Icon
   * 
   * Returns an up arrow for positive changes and down arrow for negative changes.
   * Provides visual indication of trend direction.
   * 
   * @returns JSX.Element | null - Arrow icon or null if no change
   */
  const getChangeIcon = () => {
    if (!change) return null;
    return change >= 0 
      ? <span className="mr-1">↑</span>  // Up arrow for positive change
      : <span className="mr-1">↓</span>; // Down arrow for negative change
  };

  return (
    // Main card container with white background and subtle shadow
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex items-center">
        {/* Icon container with dynamic color theme */}
        <div className={`p-3 rounded-lg ${getColorClasses()}`}>
          {icon}
        </div>
        
        {/* Content section with title, value, and optional change indicator */}
        <div className="ml-5">
          {/* Card title with subtle gray color */}
          <h3 className="text-sm font-medium text-gray-500">{title}</h3>
          
          {/* Main value and change indicator row */}
          <div className="mt-1 flex items-baseline">
            {/* Primary statistic value with large, bold text */}
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
            
            {/* Optional percentage change with directional indicator */}
            {change !== undefined && (
              <p className={`ml-2 flex items-center text-sm ${getChangeColor()}`}>
                {getChangeIcon()}
                {Math.abs(change)}%
                {/* Optional change label (e.g., "vs last month") */}
                {changeLabel && <span className="text-gray-500 ml-1">{changeLabel}</span>}
              </p>
            )}
          </div>
          
          {/* Optional description text */}
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatsCard;