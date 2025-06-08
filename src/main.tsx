/**
 * Main entry point for the React application
 * 
 * This file is responsible for:
 * - Mounting the React app to the DOM
 * - Enabling React's StrictMode for additional development checks
 * - Loading global CSS styles
 * 
 * The application follows a standard React 18+ setup using createRoot
 * instead of the legacy ReactDOM.render method.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Find the root DOM element where the React app will be mounted
// This corresponds to the div with id="root" in index.html
const rootElement = document.getElementById('root')!;

// Create React root using the modern createRoot API (React 18+)
// StrictMode provides additional checks and warnings in development:
// - Detects unsafe lifecycles
// - Warns about legacy string refs
// - Helps detect side effects during rendering
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
