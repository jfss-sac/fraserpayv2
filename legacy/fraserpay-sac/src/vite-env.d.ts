
/// <reference types="vite/client" />

// Add BeforeInstallPromptEvent interface for PWA support
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}

// Extend Window interface to include the BeforeInstallPromptEvent
interface Window {
  BeforeInstallPromptEvent?: BeforeInstallPromptEvent;
}
