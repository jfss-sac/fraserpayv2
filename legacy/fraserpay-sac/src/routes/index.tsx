
import { useAuth } from '@/contexts/auth';
import { Navigate, useLocation } from "react-router-dom";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

// Auth Pages
import Login from "@/pages/Auth/Login";
import Register from "@/pages/Auth/Register";

// Student Pages
import Dashboard from "@/pages/Student/Dashboard";
import QRCode from "@/pages/Student/QRCode";
import Settings from "@/pages/Student/Settings";

// Initiative Pages
import BoothJoin from "@/pages/Booth/Join";
import BoothDashboard from "@/pages/Booth/Dashboard";
import BoothSell from "@/pages/Booth/Sell";
import BoothTransactions from "@/pages/Booth/Transactions";
import BoothSettings from "@/pages/Booth/Settings";

import { lazy } from 'react';

// SAC Pages
const SACDashboard = lazy(() => import("@/pages/SAC/Dashboard"));

// Shared Pages
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
import NotFound from "@/pages/NotFound";

// Teacher Pages
const RequestBooth = lazy(() => import("@/pages/RequestBooth"));

// Route configuration for the application
export const routes = [
  // Auth Routes
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  
  // All authenticated users can access these routes
  { 
    path: "/dashboard", 
    element: <Dashboard />,
    protected: true 
  },
  { 
    path: "/qr-code", 
    element: <QRCode />,
    protected: true 
  },
  { 
    path: "/settings", 
    element: <Settings />,
    protected: true 
  },
  
  // Initiative Routes - no role restrictions
  { 
    path: "/booth/join", 
    element: <BoothJoin />,
    protected: true
  },
  { 
    path: "/booth/:boothId", 
    element: <BoothDashboard />,
    protected: true 
  },
  { 
    path: "/booth/:boothId/sell", 
    element: <BoothSell />,
    protected: true 
  },
  { 
    path: "/booth/:boothId/transactions", 
    element: <BoothTransactions />,
    protected: true 
  },
  { 
    path: "/booth/:boothId/settings", 
    element: <BoothSettings />,
    protected: true 
  },
  
  // SAC Dashboard - requires 'sac' role
  {
    path: "/sac/dashboard",
    element: <SACDashboard />,
    protected: true,
    requiredRoles: ['sac']
  },
  
  // Shared Routes
  { 
    path: "/leaderboard", 
    element: <Leaderboard />,
    protected: true 
  },
  { 
    path: "/transactions", 
    element: <Navigate to="/dashboard" replace />,
    protected: true 
  },

  // Teacher Routes
  {
    path: "/request-booth",
    element: <RequestBooth />,
    protected: true,
  },
  
  // Explicit 404 route
  { path: "/not-found", element: <NotFound /> },
];

// Enhanced Loading screen with timeout detection and more detailed feedback
export const LoadingScreen = ({ timeout = false }: { timeout?: boolean }) => (
  <div className="flex flex-col items-center justify-center h-screen p-4">
    <p className="text-sm mb-2">Loading Fraser Pay...</p>
    <p className="text-xs text-muted-foreground">This should only take a moment</p>
    
    <Alert variant="destructive" className="mb-4 mt-4 max-w-md">
      <AlertCircle className="h-4 w-4 mr-2" />
      <AlertDescription>FraserPay may load slower than usual during heavy internet traffic. Try to switch between PDSB WiFi/Media and mobile data where possible. Thank you for your patience.</AlertDescription>
    </Alert>
    
    {timeout && (
      <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded p-3 max-w-md">
        <p className="text-sm text-yellow-700">
          Loading is taking longer than expected. The app will continue loading shortly.
        </p>
        <ul className="list-disc text-xs text-yellow-600 pl-5 mt-1">
          <li className="mt-1">Check your internet connection</li>
          <li className="mt-1">
            <button 
              onClick={() => window.location.reload()} 
              className="text-blue-500 underline"
            >
              Refresh the page
            </button>
          </li>
          <li className="mt-1">
            <button 
              onClick={() => {
                sessionStorage.clear();
                localStorage.clear();
                window.location.href = '/login';
              }} 
              className="text-blue-500 underline"
            >
              Clear cache and restart
            </button>
          </li>
        </ul>
      </div>
    )}
  </div>
);

// Simplified Protected Route - no role checks
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  
  if (!isAuthenticated) {
    console.log("User not authenticated, redirecting to login");
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  
  return <>{children}</>;
};

export const RoleProtectedRoute = ({
  children,
  allowedRoles = []
}: {
  children: React.ReactNode;
  allowedRoles?: string[]
}) => {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles.length > 0 && (!user || !allowedRoles.includes(user.role))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
