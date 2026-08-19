
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Error handling for React rendering errors
const handleRenderError = (error: Error) => {
  console.error('React render error:', error);
  // Display a user-friendly error message instead of freezing
  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>Something went wrong</h2>
        <p>The application encountered an error. Please refresh the page to try again.</p>
        <p style="color: #666; font-size: 14px; margin-top: 10px;">
          Error details: ${error.message || 'Unknown error'}
        </p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; cursor: pointer; margin-top: 16px; background-color: #4f46e5; color: white; border: none; border-radius: 4px;">
          Refresh Page
        </button>
      </div>
    `;
  }
};

// Function to safely mount the application
const mountApp = () => {
  try {
    console.log('Mounting React application...');
    // Get root element and verify it exists
    const rootElement = document.getElementById("root");
    if (!rootElement) {
      console.error('Failed to find the root element');
      return;
    }
    
    // Create React root and render App
    const root = createRoot(rootElement);
    
    // Important: Make sure to create only one React instance
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    
    console.log('React application mounted successfully');
  } catch (error) {
    console.error('Error mounting React application:', error);
    handleRenderError(error as Error);
  }
};

// Add global error handling
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // Prevent default browser error handling
  event.preventDefault();
  handleRenderError(event.error);
});

// Add unhandled promise rejection handling
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Don't show the render error UI for promise rejections
  // as these might be API failures that are handled elsewhere
  console.warn('Unhandled promise rejection details:', event.reason);
});

// Initialize everything in a controlled sequence
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  // DOM already loaded, mount immediately
  mountApp();
}

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  });
}
