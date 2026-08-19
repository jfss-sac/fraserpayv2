
import { toast } from 'sonner';
import { auth, clearFirebaseAuth, googleProvider } from '@/integrations/firebase/client';
import { signInWithEmailAndPassword, signInWithPopup, AuthError } from 'firebase/auth';

// Utility to force reset authentication state - useful when stuck
export const resetAuthState = async () => {
  try {
    console.log("Resetting authentication state...");
    await clearFirebaseAuth();
    
    // Force page reload to clear any in-memory state
    window.location.href = '/login';
    
    return true;
  } catch (error) {
    console.error("Error resetting auth state:", error);
    toast.error("Failed to reset authentication. Please try again.");
    return false;
  }
};

// Check if Firebase auth session exists (for debugging)
export const checkSessionExists = async () => {
  try {
    const currentUser = auth.currentUser;
    console.log("Current session:", currentUser ? "Exists" : "None");
    return !!currentUser;
  } catch (error) {
    console.error("Error checking session:", error);
    return false;
  }
};

// Extract student number from email (assumes format: studentnumber@pdsb.net)
export const extractStudentNumberFromEmail = (email: string): string => {
  if (!email) return '';
  
  // Extract everything before the @ symbol
  const match = email.match(/^([^@]+)@/);
  return match ? match[1] : '';
};

// Validate if email is from pdsb.net domain
export const isPdsbEmail = (email: string): boolean => {
  return email.endsWith('@pdsb.net') || email.endsWith('@peelsb.com');
};

// Sign in with Google
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Verify email domain after authentication
    if (!isPdsbEmail(user.email || '')) {
      await auth.signOut();
      toast.error("Only @pdsb.net email addresses are allowed");
      return null;
    }
    
    return user;
  } catch (error) {
    const authError = error as AuthError;
    console.error("Google sign in failed:", authError);
    
    // Handle specific error codes
    if (authError.code === 'auth/popup-closed-by-user') {
      toast.error("Sign-in cancelled. Please try again.");
    } else if (authError.code === 'auth/cancelled-popup-request') {
      // This is normal when multiple popups are attempted, don't show error
    } else {
      toast.error("Google sign-in failed. Please try again.");
    }
    
    return null;
  }
};

// Add a function to manually sign in (useful for troubleshooting)
export const manualSignIn = async (email: string, password: string) => {
  try {
    // First clear any existing auth state
    await clearFirebaseAuth();
    
    // Then attempt to sign in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    console.log("Manual sign in successful:", userCredential.user);
    return true;
  } catch (error) {
    console.error("Manual sign in failed:", error);
    return false;
  }
};
