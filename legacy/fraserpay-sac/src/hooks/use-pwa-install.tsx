
import { useState, useEffect } from 'react';
import { isIOS, isPWA, canInstallPWA, showInstallBanner } from '@/utils/pwa';
import { useIsMobile } from './use-mobile';

export function usePwaInstall() {
  const [showPWAPrompt, setShowPWAPrompt] = useState(false);
  const isMobile = useIsMobile();
  
  useEffect(() => {
    // Don't show the prompt if already in PWA mode
    if (isPWA()) {
      console.log('Already running as PWA, not showing install prompt');
      return;
    }
    
    // Only show on mobile devices that can install PWAs
    if (isMobile && canInstallPWA()) {
      console.log('Setting up delayed PWA install banner');
      
      // Show the banner after a delay - shorter delay for iOS
      const delay = isIOS() ? 2000 : 3000;
      
      const timer = setTimeout(() => {
        console.log('Showing PWA install banner now');
        setShowPWAPrompt(true);
      }, delay);
      
      return () => clearTimeout(timer);
    }
  }, [isMobile]);
  
  const closePWAPrompt = () => {
    console.log('Closing PWA install prompt');
    setShowPWAPrompt(false);
  };
  
  return { showPWAPrompt, closePWAPrompt };
}
