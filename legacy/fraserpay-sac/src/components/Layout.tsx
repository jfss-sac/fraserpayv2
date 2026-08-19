
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { LogOut, ChevronLeft, PlusCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { resetAuthState } from '@/utils/auth';
import { toast } from 'sonner';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  showLogout?: boolean;
  showAddButton?: boolean;
  hideHeader?: boolean; // Added new prop
  onAddClick?: () => void;
  onBackClick?: () => void;
  logo?: React.ReactNode;
  footer?: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  title,
  subtitle,
  showBack = false,
  showLogout = false,
  showAddButton = false,
  hideHeader = false, // Added new prop with default value false
  onAddClick,
  onBackClick,
  logo,
  footer
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, isLoading, user } = useAuth();

  const handleBack = () => {
    // Use custom back handler if provided, otherwise use default behavior
    if (onBackClick) {
      onBackClick();
      return;
    }
    
    if (location.pathname === '/dashboard') {
      // Don't allow going back from dashboard
      return;
    }
    
    // Special case for SAC dashboard - go to home
    if (location.pathname === '/sac/dashboard') {
      navigate('/');
      return;
    }

    // Booth management pages should always return to the booth dashboard tab,
    // and the booth dashboard itself should exit back to the main dashboard.
    const boothMatch = location.pathname.match(/^\/booth\/([^/]+)(?:\/(sell|transactions|settings))?$/);
    if (boothMatch && location.pathname !== '/booth/join') {
      const boothId = boothMatch[1];
      const boothSection = boothMatch[2];

      if (boothSection) {
        navigate(`/booth/${boothId}`);
      } else {
        navigate('/dashboard');
      }
      return;
    }

    // Use navigate instead of window.location to prevent full page reload
    navigate(-1);
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Logout failed. Resetting authentication...");
      await resetAuthState();
    }
  };

  const defaultLogo = (
    <div className="flex items-center gap-2">
      <img 
        src="/lovable-uploads/ed1f3f9a-22a0-42de-a8cb-354fb8c82dae.png" 
        alt="Fraser Pay" 
        className="h-8 w-auto" 
      />
    </div>
  );

  const defaultFooter = (
    <div className="text-center text-xs text-muted-foreground py-2">
      Made by John Fraser SAC
      {/* <br/>Additional contributors: Sohum Padhye and Yang Xue */}
    </div>
  );

  // Simplified loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/30">
        {!hideHeader && (
          <header className="py-4 px-6 flex justify-between items-center border-b border-border/40 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {defaultLogo}
            </div>
          </header>
        )}
        
        <main className="flex-1 px-6 py-4 w-full flex flex-col items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </main>
        
        <footer className="px-6 mt-auto">
          {footer || defaultFooter}
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/30">
      {!hideHeader && (
        <header className="py-4 px-6 flex justify-between items-center border-b border-border/40 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2">
            {showBack && (
              <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            
            <div className="flex items-center gap-2">
              {logo || defaultLogo}
              
              {title && (
                <h1 className="text-lg font-semibold">{title}</h1>
              )}
              
              {subtitle && (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {showAddButton && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onAddClick}
                className="rounded-full bg-primary/10 text-primary hover:bg-primary/20"
              >
                <PlusCircle className="h-5 w-5" />
              </Button>
            )}
            
            {showLogout && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleLogout}
                className="rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            )}
          </div>
        </header>
      )}
      
      <main className="flex-1 px-6 py-4 w-full max-w-7xl mx-auto">
        {children}
      </main>
      
      <footer className="px-6 mt-auto">
        {footer || defaultFooter}
      </footer>
    </div>
  );
}

export default Layout;
