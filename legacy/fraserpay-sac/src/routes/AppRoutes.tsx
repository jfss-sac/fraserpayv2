
import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { routes, ProtectedRoute, RoleProtectedRoute, LoadingScreen } from './index';
import { toast } from 'sonner';

const AppRoutes: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const routeInitialized = useRef(false);
  
  // Handle loading timeout state
  useEffect(() => {
    if (isLoading) {
      console.log("AppRoutes: Auth is loading, setting up timeout");
      const timer = setTimeout(() => {
        console.log("AppRoutes: Loading timeout reached");
        setLoadingTimeout(true);
      }, 5000); // Show timeout warning after 5 seconds
      
      return () => clearTimeout(timer);
    } else {
      console.log("AppRoutes: Auth is not loading, clearing timeout");
      setLoadingTimeout(false);
    }
  }, [isLoading]);
  
  // Reset loading timeout when path changes
  useEffect(() => {
    setLoadingTimeout(false);
  }, [location.pathname]);
  
  // Handle page refresh and direct URL access - optimize to run once
  useEffect(() => {
    if (routeInitialized.current) return;
    
    const handleRouteInitialization = () => {
      // Only run once per session
      routeInitialized.current = true;
      
      console.log("Initializing routes on path:", location.pathname);
      
      // Handle direct URL access
      if (isAuthenticated && !isLoading) {
        // For root path, redirect to dashboard if authenticated
        if (location.pathname === '/' || location.pathname === '') {
          navigate('/dashboard', { replace: true });
        }
      }
    };
    
    if (!isLoading) {
      handleRouteInitialization();
    }
    
    // Track page refreshes to maintain state
    const handleBeforeUnload = () => {
      sessionStorage.setItem('lastPath', location.pathname);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isAuthenticated, isLoading, location.pathname, navigate]);
  
  // Add a safety timeout to ensure we render routes even if auth state gets stuck
  useEffect(() => {
    if (!isLoading) return; // Only activate when loading
    
    const safetyTimeout = setTimeout(() => {
      console.warn("Auth loading state persisted too long, rendering app anyway");
      // Proceed with rendering routes, auth state will update later
      // We don't update isLoading since that comes from the auth context
    }, 7000); // Wait a bit longer than the 5s timeout in App.tsx
    
    return () => clearTimeout(safetyTimeout);
  }, [isLoading]);
  
  // Show loading screen for initial auth state determination, but with a timeout fallback
  if (isLoading && !loadingTimeout) {
    console.log("App is in loading state, auth status not determined yet");
    return <LoadingScreen timeout={false} />;
  }
  
  // If loading has timed out, show the loading screen with timeout message
  if (isLoading && loadingTimeout) {
    console.log("Auth loading timed out, showing timeout screen");
    return <LoadingScreen timeout={true} />;
  }
  
  console.log("App routes rendering, auth status:", isAuthenticated, "user role:", user?.role);

  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    }>
    <Routes>
      {routes.map((route, index) => {
        if (route.protected) {
          const element = route.requiredRoles ? (
            <RoleProtectedRoute allowedRoles={route.requiredRoles}>
              {route.element}
            </RoleProtectedRoute>
          ) : (
            <ProtectedRoute>
              {route.element}
            </ProtectedRoute>
          );
          return <Route key={index} path={route.path} element={element} />;
        }

        return <Route key={index} path={route.path} element={route.element} />;
      })}
      
      <Route 
        path="/" 
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />
      
      {/* Catch-all route for 404 handling */}
      <Route path="*" element={<Navigate to="/not-found" replace />} />
    </Routes>
    </Suspense>
  );
};

export default AppRoutes;
