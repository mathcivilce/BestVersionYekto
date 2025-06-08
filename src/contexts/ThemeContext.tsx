/**
 * Theme Context Provider
 * 
 * This context manages the application's theme system with support for:
 * - Light theme
 * - Dark theme  
 * - System theme (follows OS preference)
 * - Theme persistence via localStorage
 * - Real-time system theme change detection
 * 
 * The theme is applied by adding/removing the 'dark' class on the document element,
 * which works with Tailwind CSS's dark mode configuration.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';

// Available theme options
type Theme = 'light' | 'dark' | 'system';

// Theme context interface
interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Create the theme context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Custom hook to access theme context
 * Throws error if used outside of ThemeProvider
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/**
 * Theme Provider Component
 * 
 * Provides theme management to all child components and handles:
 * - Initial theme loading from localStorage
 * - Theme application to DOM
 * - System theme change detection
 * - Theme persistence
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize theme state from localStorage or default to 'system'
  const [theme, setThemeState] = useState<Theme>(() => {
    // Get saved theme from localStorage
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    return savedTheme || 'system';
  });

  /**
   * Apply theme to the document element
   * 
   * @param newTheme - Theme to apply ('light', 'dark', or 'system')
   * 
   * For 'system' theme, checks the user's OS preference using
   * the prefers-color-scheme media query
   */
  const applyTheme = (newTheme: Theme) => {
    let isDark: boolean;
    
    if (newTheme === 'system') {
      // Use system preference for 'system' theme
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      // Use explicit theme setting
      isDark = newTheme === 'dark';
    }
    
    // Apply or remove 'dark' class on document element
    // This works with Tailwind CSS's dark mode configuration
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  /**
   * Set theme and persist to localStorage
   * 
   * @param newTheme - Theme to set and apply
   */
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    // Persist theme choice to localStorage
    localStorage.setItem('theme', newTheme);
    // Apply theme immediately
    applyTheme(newTheme);
  };

  // Apply theme on initial render and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system theme changes when using 'system' theme
  useEffect(() => {
    // Create media query to detect dark mode preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    /**
     * Handle system theme changes
     * Only applies changes when theme is set to 'system'
     */
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    
    // Listen for changes in system theme preference
    mediaQuery.addEventListener('change', handleChange);
    
    // Cleanup listener on unmount
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};