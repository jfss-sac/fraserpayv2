
/**
 * Utility functions for app performance optimization
 */

// Measure and report performance metrics
export const measurePerformance = () => {
  if (window.performance && 'getEntriesByType' in window.performance) {
    // Report navigation timing
    const navigationEntries = window.performance.getEntriesByType('navigation');
    if (navigationEntries.length > 0) {
      const navEntry = navigationEntries[0] as PerformanceNavigationTiming;
      console.info('App load performance:', {
        pageLoadTime: navEntry.loadEventEnd - navEntry.startTime,
        domContentLoaded: navEntry.domContentLoadedEventEnd - navEntry.startTime,
        firstContentfulPaint: getFCP(),
        timeToInteractive: getTimeToInteractive()
      });
    }
  }
};

// Get First Contentful Paint time
const getFCP = (): number => {
  if (window.performance && 'getEntriesByType' in window.performance) {
    const paintEntries = window.performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
    return fcpEntry ? fcpEntry.startTime : 0;
  }
  return 0;
};

// Approximate Time to Interactive
const getTimeToInteractive = (): number => {
  if (window.performance && 'getEntriesByType' in window.performance) {
    const navEntry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return navEntry.domInteractive;
  }
  return 0;
};

// Clear all browser caches
export const clearAllCaches = async (): Promise<boolean> => {
  try {
    // Clear application cache
    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => window.caches.delete(cacheName))
      );
    }
    
    // Clear local and session storage
    localStorage.clear();
    sessionStorage.clear();
    
    // Clear IndexedDB
    clearIndexedDB();
    
    return true;
  } catch (error) {
    console.error('Error clearing caches:', error);
    return false;
  }
};

// Clear IndexedDB databases
const clearIndexedDB = () => {
  if ('indexedDB' in window) {
    indexedDB.databases().then(databases => {
      databases.forEach(database => {
        if (database.name) {
          indexedDB.deleteDatabase(database.name);
        }
      });
    }).catch(err => {
      console.error('Error clearing IndexedDB:', err);
    });
  }
};

// Register listeners for connectivity changes
export const registerConnectivityListeners = (
  onOnline: () => void = () => {},
  onOffline: () => void = () => {}
) => {
  window.addEventListener('online', () => {
    console.info('App is back online');
    onOnline();
  });
  
  window.addEventListener('offline', () => {
    console.info('App is offline');
    onOffline();
  });
};

// Preload critical resources
export const preloadCriticalResources = (urls: string[]) => {
  if (!('preload' in HTMLLinkElement.prototype)) {
    return; // Preload not supported
  }
  
  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = url;
    
    // Set correct as attribute based on file extension
    const extension = url.split('.').pop()?.toLowerCase();
    if (extension === 'js') {
      link.as = 'script';
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension || '')) {
      link.as = 'image';
    } else if (['css'].includes(extension || '')) {
      link.as = 'style';
    } else if (['woff', 'woff2', 'ttf', 'otf'].includes(extension || '')) {
      link.as = 'font';
      link.crossOrigin = 'anonymous';
    }
    
    document.head.appendChild(link);
  });
};
