import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getVersionedStorageItem, setVersionedStorageItem } from '@/utils/storageManager';

// Create a client with robust error handling that won't freeze the app
// Using more balanced staleTime and gcTime for critical vs non-critical data
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,   // Only refetch when explicitly requested
      refetchOnMount: true,          // Still refetch when component mounts
      refetchOnReconnect: false,     // Only refetch when explicitly requested
      staleTime: 5 * 60 * 1000,      // General data stays fresh for 5 minutes
      gcTime: 30 * 60 * 1000,        // Cache for 30 minutes (renamed from cacheTime)
      meta: {
        onError: (error: unknown) => {
          console.error('Query error:', error);
          // This prevents uncaught promise rejections from freezing the app
        }
      }
    },
    mutations: {
      meta: {
        onError: (error: unknown) => {
          console.error('Mutation error:', error);
          // This prevents uncaught promise rejections from freezing the app
        }
      }
    }
  },
});

// Set up query cache event listeners using the correct listener signature
queryClient.getQueryCache().subscribe(event => {
  // Handle potential errors in queries through query cache events
  if (event.type === 'updated' && event.query.state.status === 'error') {
    console.error('Global query cache error:', event.query.state.error);
  }
});

interface QueryProviderProps {
  children: React.ReactNode;
}

const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
  // Add global unhandled promise rejection handler outside of useEffect
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled Promise Rejection:', event.reason);
    // Prevent the app from freezing on uncaught promise rejections
    event.preventDefault();
  };
  
  // Modify clear query cache to be more selective and efficient
  const clearQueryCache = () => {
    // Critical data that should always be fresh - balance data and revenue
    // These are invalidated more frequently to ensure live updates
    const criticalQueries = ['userBalance', 'boothStats', 'sacRevenue'];
    
    // Check when we last invalidated critical queries
    const lastCriticalInvalidation = getVersionedStorageItem<number>('lastCriticalInvalidation', 0);
    const now = Date.now();
    
    // Invalidate critical queries more frequently (every 5 seconds)
    // This ensures balances and revenue stay fresh
    if (now - lastCriticalInvalidation > 5000) {
      criticalQueries.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      });
      setVersionedStorageItem('lastCriticalInvalidation', now);
    }
    
    // Use storage to record last full invalidation time
    const lastFullInvalidation = getVersionedStorageItem<number>('lastFullInvalidation', 0);
    
    // Only do a full invalidation every hour (unchanged)
    if (now - lastFullInvalidation > 60 * 60 * 1000) {
      queryClient.invalidateQueries();
      setVersionedStorageItem('lastFullInvalidation', now);
    }
  };

  // Only use useEffect in the component body, not conditionally
  useEffect(() => {
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    // Clear query cache initially
    clearQueryCache();
    
    // Set up interval to clear cache
    // Critical queries every 5 seconds
    // Full cache invalidation handled within the function
    const interval = setInterval(clearQueryCache, 5000); // More frequent updates for critical data
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      clearInterval(interval);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

export default QueryProvider;
